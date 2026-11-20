import { pathToFileURL } from 'node:url';
import { migrationPool } from '../db/migrate.mjs';

function env(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

export async function keycloakAdmin() {
  const location = new URL(env('KEYCLOAK_ISSUER'));
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0] !== 'realms' || !/^[a-z0-9-]+$/.test(parts[1])) {
    throw new Error('Invalid Keycloak realm issuer');
  }
  if (location.protocol !== 'https:' && !(location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname))) {
    throw new Error('Keycloak management needs HTTPS outside local dev');
  }
  const response = await fetch(new URL('/realms/master/protocol/openid-connect/token', location), {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env('KEYCLOAK_BOOTSTRAP_CLIENT_ID'),
      client_secret: env('KEYCLOAK_BOOTSTRAP_CLIENT_SECRET')
    }),
    redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Keycloak management authentication failed (HTTP ${response.status})`);
  const { access_token: token } = await response.json();
  const base = new URL(`/admin/realms/${parts[1]}`, location).href;

  return async function admin(path, method = 'GET', body) {
    const result = await fetch(base + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!result.ok) throw new Error(`Keycloak management request failed (HTTP ${result.status})`);
    return result.headers.get('content-type')?.includes('application/json') ? result.json() : undefined;
  };
}

async function setupRealm(admin) {
  await admin('', 'PUT', {
    registrationAllowed: false, registrationEmailAsUsername: false,
    loginWithEmailAllowed: false, verifyEmail: false, resetPasswordAllowed: false,
    loginTheme: 'lit-garden'
  });
  const profile = await admin('/users/profile');
  for (const attribute of profile.attributes) {
    if (attribute.name === 'email') delete attribute.required;
  }
  for (const name of ['garden_bootstrap', 'garden_provisioning_id']) {
    if (!profile.attributes.some(attribute => attribute.name === name)) {
      profile.attributes.push({ name, permissions: { view: ['admin'], edit: ['admin'] } });
    }
  }
  await admin('/users/profile', 'PUT', profile);

  const existing = await admin('/roles');
  for (const role of ['admin', 'teacher', 'student']) {
    const name = `garden-${role}`;
    if (!existing.some(item => item.name === name)) await admin('/roles', 'POST', { name });
  }

  const origin = new URL(env('APP_ORIGIN')).origin;
  const clientId = env('APP_OIDC_CLIENT_ID');
  const configuration = {
    clientId, secret: env('APP_OIDC_SECRET'), protocol: 'openid-connect', enabled: true,
    publicClient: false, standardFlowEnabled: true, implicitFlowEnabled: false,
    directAccessGrantsEnabled: false, serviceAccountsEnabled: false,
    redirectUris: [`${origin}/auth/callback`], webOrigins: [origin],
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': `${origin}/`
    },
    protocolMappers: [{
      name: 'Vườn Văn role claims', protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-realm-role-mapper',
      config: {
        'claim.name': 'garden_roles', 'jsonType.label': 'String', multivalued: 'true',
        'id.token.claim': 'true', 'access.token.claim': 'false', 'userinfo.token.claim': 'false'
      }
    }]
  };
  const clients = await admin(`/clients?clientId=${encodeURIComponent(clientId)}`);
  const match = clients.find(candidate => candidate.clientId === clientId);
  if (match) {
    // Keycloak manages protocol mapper IDs independently of the client update.
    const { protocolMappers, ...client } = configuration;
    await admin(`/clients/${match.id}`, 'PUT', client);
    const mappers = await admin(`/clients/${match.id}/protocol-mappers/models`);
    for (const mapper of protocolMappers) {
      if (!mappers.some(existingMapper => existingMapper.name === mapper.name)) {
        await admin(`/clients/${match.id}/protocol-mappers/models`, 'POST', mapper);
      }
    }
  } else {
    await admin('/clients', 'POST', configuration);
  }
}

async function prepareIamClient(admin) {
  const clientId = env('APP_IAM_CLIENT_ID');
  const matches = await admin(`/clients?clientId=${encodeURIComponent(clientId)}`);
  if (!matches.some(client => client.clientId === clientId)) {
    await admin('/clients', 'POST', {
      clientId, secret: env('APP_IAM_CLIENT_SECRET'), protocol: 'openid-connect',
      enabled: true, publicClient: false, standardFlowEnabled: false,
      directAccessGrantsEnabled: false, serviceAccountsEnabled: true, fullScopeAllowed: true
    });
  }
  const [iam] = await admin(`/clients?clientId=${encodeURIComponent(clientId)}`);
  const [management] = await admin('/clients?clientId=realm-management');
  const account = await admin(`/clients/${iam.id}/service-account-user`);
  const roles = await Promise.all(['manage-users', 'view-realm'].map(role =>
    admin(`/clients/${management.id}/roles/${role}`)));
  await admin(`/users/${account.id}/role-mappings/clients/${management.id}`, 'POST',
    roles.map(({ id, name }) => ({ id, name })));
}

export async function provisionIdentity(admin, db, { username, name, role, password, bootstrap = false }) {
  if (!['admin', 'teacher', 'student'].includes(role) || !/^[a-z0-9_]{3,30}$/.test(username)) {
    throw new Error('Invalid account fixture');
  }
  const path = `/users?exact=true&username=${encodeURIComponent(username)}`;
  let [user] = await admin(path);
  if (user) {
    if (!bootstrap) throw new Error('Username is already managed outside bootstrap');
    const managed = await admin(`/users/${user.id}`);
    if (managed.attributes?.garden_bootstrap?.[0] !== 'true') {
      const { rows } = await db.query(`
        SELECT 1 FROM garden.users
        WHERE oidc_issuer=$1 AND oidc_subject=$2 AND username=$3 AND role='admin'
      `, [env('KEYCLOAK_ISSUER'), user.id, username]);
      if (!rows.length) throw new Error('Username is already managed outside bootstrap');
    }
  }
  if (!user) {
    await admin('/users', 'POST', {
      username, firstName: name, lastName: 'Vườn Văn', enabled: true,
      ...(bootstrap ? { attributes: { garden_bootstrap: ['true'] } } : {}),
      requiredActions: ['UPDATE_PASSWORD'],
      credentials: [{ type: 'password', value: password, temporary: true }]
    });
    [user] = await admin(path);
  }
  if (!user?.id) throw new Error('Keycloak user was not created');
  const mapping = await admin(`/roles/garden-${role}`);
  await admin(`/users/${user.id}/role-mappings/realm`, 'POST', [{ id: mapping.id, name: mapping.name }]);

  const connection = await db.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(`
      INSERT INTO garden.users(oidc_issuer, oidc_subject, username, display_name, role)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(oidc_issuer,oidc_subject) DO NOTHING
    `, [env('KEYCLOAK_ISSUER'), user.id, username, name, role]);
    const { rows } = await connection.query(
      'SELECT id,username,role FROM garden.users WHERE oidc_issuer=$1 AND oidc_subject=$2',
      [env('KEYCLOAK_ISSUER'), user.id]
    );
    const identity = rows[0];
    if (identity?.username !== username || identity.role !== role) throw new Error('Existing app identity does not match bootstrap');
    if (role === 'teacher') await connection.query('INSERT INTO garden.teachers(id) VALUES ($1) ON CONFLICT DO NOTHING', [identity.id]);
    if (role === 'student') await connection.query('INSERT INTO garden.students(id) VALUES ($1) ON CONFLICT DO NOTHING', [identity.id]);
    await connection.query('COMMIT');
    return { subject: user.id, id: identity.id };
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool;
  try {
    const admin = await keycloakAdmin();
    pool = migrationPool();
    await setupRealm(admin);
    await prepareIamClient(admin);
    await provisionIdentity(admin, pool, {
      username: env('APP_BOOTSTRAP_USER'), name: 'Quản trị viên',
      role: 'admin', password: env('APP_BOOTSTRAP_PASSWORD'), bootstrap: true
    });
    console.log('OIDC client and initial application administrator ready.');
  } catch (error) {
    console.error('Application auth bootstrap failed:', error.code ?? error.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
