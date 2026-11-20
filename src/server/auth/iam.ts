import { requiredEnv } from '../config';

type KeycloakUser = { id: string; attributes?: Record<string, string[]> };

export async function userManagement() {
  const issuer = new URL(requiredEnv('KEYCLOAK_ISSUER'));
  const match = /^\/realms\/([a-z0-9-]+)$/.exec(issuer.pathname);
  if (!match || issuer.username || issuer.password ||
      (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(issuer.hostname)))) {
    throw new Error('Invalid issuer for user management');
  }
  const result = await fetch(`${issuer.href}/protocol/openid-connect/token`, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3500),
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: requiredEnv('APP_IAM_CLIENT_ID'),
      client_secret: requiredEnv('APP_IAM_CLIENT_SECRET')
    })
  });
  if (!result.ok) throw new Error('Identity provider unavailable');
  const { access_token } = await result.json() as { access_token?: string };
  if (!access_token) throw new Error('Identity provider token missing');

  const endpoint = new URL(`/admin/realms/${match[1]}`, issuer);
  async function call(path: string, method = 'GET', body?: object) {
    const response = await fetch(endpoint.href + path, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3500),
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Identity provider rejected request');
    return response;
  }

  const read = async <Output>(path: string): Promise<Output> => (await call(path)).json();
  const userPath = (subject: string) => `/users/${encodeURIComponent(subject)}`;

  return {
    async provisionTeacher(id: string, username: string, name: string, password: string) {
      const parameters = new URLSearchParams({ exact: 'true', username });
      const prior = await read<KeycloakUser[]>(`/users?${parameters}`);
      if (prior.length) throw new Error('Username already registered at identity provider');
      await call('/users', 'POST', {
        username, firstName: name, lastName: 'Vườn Văn', enabled: true,
        attributes: { garden_provisioning_id: [id] },
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [{ type: 'password', value: password, temporary: true }]
      });
      const [user] = await read<KeycloakUser[]>(`/users?${parameters}`);
      if (!user?.id) throw new Error('Provisioned user not found');
      const profile = await read<KeycloakUser>(userPath(user.id));
      if (profile.attributes?.garden_provisioning_id?.[0] !== id) throw new Error('Provisioning identity mismatch');
      const role = await read<{ id: string; name: string }>('/roles/garden-teacher');
      await call(`${userPath(user.id)}/role-mappings/realm`, 'POST', [{ id: role.id, name: role.name }]);
      return user.id;
    },
    async resetPassword(subject: string, password: string) {
      await call(`${userPath(subject)}/reset-password`, 'PUT', { type: 'password', temporary: true, value: password });
      await call(`${userPath(subject)}/logout`, 'POST');
    },
    async setTeacherEnabled(subject: string, enabled: boolean) {
      await call(userPath(subject), 'PUT', { enabled });
      if (!enabled) await call(`${userPath(subject)}/logout`, 'POST');
    }
  };
}
