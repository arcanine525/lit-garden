import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';

const issuer = process.env.DRIVE_FAKE_ISSUER;
const client = process.env.DRIVE_FAKE_CLIENT_ID;
const secret = process.env.DRIVE_FAKE_CLIENT_SECRET;
const callback = process.env.DRIVE_FAKE_CALLBACK;
if (!issuer || !client || !secret || !callback) throw Error('Missing local Drive fixture settings');

const folderMime = 'application/vnd.google-apps.folder';
const scope = 'openid https://www.googleapis.com/auth/drive.file';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = randomUUID();
const jwks = { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid }] };
const forms = new Map();
const codes = new Map();
const refreshTokens = new Map();
const accessTokens = new Map();
const files = new Map();
const grants = new Map();
const faults = new Map();
const holds = new Map();
const revoked = new Set();

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const challenge = value => createHash('sha256').update(value).digest('base64url');
const claim = (sub, nonce) => {
  const now = Math.floor(Date.now() / 1000);
  const data = [encode({ alg: 'RS256', kid }), encode({ iss: issuer, aud: client, sub, nonce, iat: now, exp: now + 3600 })].join('.');
  return data + '.' + sign('sha256', Buffer.from(data), keys.privateKey).toString('base64url');
};
const token = () => randomUUID() + randomUUID();
const redirect = (response, url) => { response.writeHead(303, { Location: url }); response.end(); };
const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};
const fault = (response, status, reason) => json(response, status, { error: { errors: [{ reason }] } });
const data = async request => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12_000_000) throw Error('Fixture request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
const body = async request => JSON.parse((await data(request)).toString());

function register(file, sub, bytes = Buffer.alloc(0)) {
  files.set(file.id, { bytes, sub, file: {
    id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, appProperties: file.appProperties,
    trashed: false, ownedByMe: true, ...(file.mimeType === folderMime ? {} : { size: String(bytes.length) }),
    capabilities: { canAddChildren: file.mimeType === folderMime }, permissions: [{ type: 'user' }], version: '1'
  }, granted: file.granted === true || Boolean(file.appProperties) });
}

function root(sub) {
  const id = 'parent-' + sub;
  if (!files.has(id)) register({ id, name: 'Thư mục Drive thử', mimeType: folderMime }, sub);
  return id;
}

function mayAccess(id, sub) {
  const entry = files.get(id);
  return entry?.sub === sub && (entry.granted || grants.get(sub)?.has(id)) ? entry : undefined;
}

function issue(sub, includeRefresh) {
  const access = token();
  accessTokens.set(access, { sub, expires: Date.now() + 3_600_000 });
  const result = { access_token: access, token_type: 'Bearer', expires_in: 3600, scope };
  if (includeRefresh) {
    result.refresh_token = token();
    refreshTokens.set(result.refresh_token, sub);
  }
  return result;
}

async function applyFault(response, sub, operation, afterCommit = false) {
  const key = sub + ':' + operation;
  const next = faults.get(key);
  if (next?.afterCommit !== afterCommit) return false;
  faults.delete(key);
  if (next.hold) {
    await new Promise(resolve => {
      const release = () => { clearTimeout(timer); holds.delete(key); resolve(); };
      const timer = setTimeout(release,12_000);
      holds.set(key,release);
    });
    return false;
  }
  fault(response, next.status, next.reason);
  return true;
}

async function fixture(request, response) {
  if (request.headers.authorization !== 'Bearer ' + secret || request.method !== 'POST') return fault(response, 403, 'forbidden');
  const input = await body(request);
  if (!/^[a-z0-9_-]{1,40}$/.test(input.sub)) return json(response, 422, {});
  if (input.action === 'fault') {
    faults.set(input.sub + ':' + input.operation, {
      status: input.status, reason: input.reason, afterCommit: input.afterCommit === true, hold: input.hold === true
    });
  } else if (input.action === 'release') {
    const release = holds.get(input.sub + ':' + input.operation);
    if (!release) return json(response, 404, {});
    release();
  } else if (input.action === 'revoke') {
    revoked.add(input.sub);
  } else if (input.action === 'file') {
    register(input.file,input.sub,Buffer.from(input.base64 ?? '', 'base64'));
  } else if (input.action === 'alter') {
    const entry = files.get(input.id);
    if (entry?.sub !== input.sub) return json(response, 404, {});
    Object.assign(entry.file,input.patch);
  } else if (input.action === 'inspect') {
    return json(response, 200, {
      files: Array.from(files.values()).filter(entry => entry.sub === input.sub).map(entry => entry.file),
      holds: Array.from(holds.keys()).filter(key => key.startsWith(input.sub + ':')).map(key => key.split(':')[1])
    });
  } else if (input.action === 'reset') {
    for (const [id, entry] of files) if (entry.sub === input.sub) files.delete(id);
    for (const [id, value] of refreshTokens) if (value === input.sub) refreshTokens.delete(id);
    for (const [id, value] of accessTokens) if (value.sub === input.sub) accessTokens.delete(id);
    for (const key of faults.keys()) if (key.startsWith(input.sub + ':')) faults.delete(key);
    for (const [key, release] of holds) if (key.startsWith(input.sub + ':')) release();
    grants.delete(input.sub);
    revoked.delete(input.sub);
  } else return json(response, 422, {});
  return json(response, 200, { ok: true });
}

async function handle(request, response) {
  const url = new URL(request.url, issuer);
  const { pathname } = url;
  const method = request.method;
  if (method === 'GET' && pathname === '/health') return json(response, 200, { provider: 'mock-drive', ready: true });
  if (pathname === '/fake/control') return fixture(request,response);
  if (method === 'GET' && pathname === '/.well-known/openid-configuration') {
    return json(response, 200, {
      issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'],
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256']
    });
  }
  if (method === 'GET' && pathname === '/jwks') return json(response, 200, jwks);
  if (pathname === '/authorize' && method === 'GET') {
    const query = url.searchParams;
    if (query.get('client_id') !== client || query.get('redirect_uri') !== callback ||
        query.get('scope') !== scope || query.get('response_type') !== 'code' ||
        query.get('code_challenge_method') !== 'S256' || !query.get('state') || !query.get('nonce')) return json(response, 400, {});
    const id = token();
    forms.set(id, { query, expires: Date.now() + 600_000 });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; form-action 'self' " + new URL(callback).origin });
    return response.end(`<!doctype html><html lang="vi"><title>Drive giả lập</title><h1>Drive giả lập</h1>
      <form method="post"><input type="hidden" name="fixture" value="${id}">
      <label>Danh tính Drive thử <input name="sub" pattern="[a-z0-9_-]{1,40}" required></label>
      <button>Cho phép</button></form></html>`);
  }
  if (pathname === '/authorize' && method === 'POST') {
    const input = new URLSearchParams((await data(request)).toString());
    const id = input.get('fixture');
    const form = forms.get(id);
    forms.delete(id);
    const sub = input.get('sub');
    if (!form || form.expires < Date.now() || !sub || !/^[a-z0-9_-]{1,40}$/.test(sub)) return json(response, 400, {});
    revoked.delete(sub);
    root(sub);
    const code = token();
    codes.set(code, { sub, nonce: form.query.get('nonce'), challenge: form.query.get('code_challenge'), expires: Date.now() + 60_000 });
    const next = new URL(callback);
    next.search = new URLSearchParams({ code, state: form.query.get('state') }).toString();
    return redirect(response,next.href);
  }
  if (pathname === '/token' && method === 'POST') {
    const input = new URLSearchParams((await data(request)).toString());
    if (input.get('client_id') !== client || input.get('client_secret') !== secret) return json(response, 401, { error: 'invalid_client' });
    if (input.get('grant_type') === 'authorization_code') {
      const code = input.get('code');
      const grant = codes.get(code);
      codes.delete(code);
      if (!grant || grant.expires < Date.now() || input.get('redirect_uri') !== callback ||
          challenge(input.get('code_verifier') ?? '') !== grant.challenge) return json(response, 400, { error: 'invalid_grant' });
      return json(response, 200, { ...issue(grant.sub,true), id_token: claim(grant.sub,grant.nonce) });
    }
    if (input.get('grant_type') === 'refresh_token') {
      const sub = refreshTokens.get(input.get('refresh_token'));
      if (!sub || revoked.has(sub)) return json(response,400,{ error: 'invalid_grant' });
      return json(response, 200, issue(sub,false));
    }
    return json(response,400,{ error: 'unsupported_grant_type' });
  }
  const auth = accessTokens.get(request.headers.authorization?.replace(/^Bearer /, ''));
  if (!auth || auth.expires < Date.now() || revoked.has(auth.sub)) return fault(response, 401, 'authError');
  const { sub } = auth;
  if (pathname === '/fake/picker') {
    if (method === 'GET') return json(response,200,[{ id: root(sub), name: 'Thư mục Drive thử' }]);
    if (method === 'POST') {
      const { id } = await body(request);
      if (files.get(id)?.sub !== sub) return fault(response, 404, 'notFound');
      if (!grants.has(sub)) grants.set(sub,new Set());
      grants.get(sub).add(id);
      return json(response,200,{ ok: true });
    }
  }
  if (pathname === '/drive/v3/files/generateIds' && method === 'GET') {
    if (await applyFault(response, sub, 'generate')) return;
    return json(response, 200, { ids: [randomUUID()] });
  }
  if (pathname === '/drive/v3/files' && method === 'POST') {
    if (await applyFault(response, sub, 'create')) return;
    const file = await body(request);
    if (!mayAccess(file.parents?.[0],sub)?.file.capabilities.canAddChildren) return fault(response,403,'insufficientFilePermissions');
    if (files.has(file.id)) return fault(response,409,'alreadyExists');
    register(file,sub);
    if (await applyFault(response, sub, 'create', true)) return;
    return json(response,200,{ id: file.id });
  }
  if (pathname === '/upload/drive/v3/files' && method === 'POST') {
    if (await applyFault(response, sub, 'upload')) return;
    const boundary = /boundary=([\w-]+)/.exec(request.headers['content-type'] ?? '')?.[1];
    if (!boundary) return fault(response,400,'badRequest');
    const payload = await data(request);
    const separator = Buffer.from('\r\n\r\n');
    const first = payload.indexOf(separator) + separator.length;
    const marker = Buffer.from('\r\n--' + boundary);
    const second = payload.indexOf(marker,first);
    const lastHeader = payload.indexOf(separator,second) + separator.length;
    const end = payload.lastIndexOf(marker);
    if (first < separator.length || second < 0 || lastHeader < second || end < lastHeader) return fault(response,400,'badRequest');
    const file = JSON.parse(payload.subarray(first,second).toString());
    if (!mayAccess(file.parents?.[0],sub)?.file.capabilities.canAddChildren) return fault(response,403,'insufficientFilePermissions');
    if (files.has(file.id)) return fault(response,409,'alreadyExists');
    register(file,sub,payload.subarray(lastHeader,end));
    if (await applyFault(response, sub, 'upload', true)) return;
    return json(response,200,{ id: file.id });
  }
  const fileId = /^\/drive\/v3\/files\/([\w-]+)$/.exec(pathname)?.[1];
  if (fileId && method === 'GET') {
    if (await applyFault(response,sub,'read')) return;
    const entry = mayAccess(fileId,sub);
    if (!entry) return fault(response,404,'notFound');
    if (url.searchParams.get('alt') === 'media') {
      response.writeHead(200, { 'Content-Type': entry.file.mimeType });
      return response.end(entry.bytes);
    }
    return json(response,200,entry.file);
  }
  return fault(response,404,'notFound');
}

createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  handle(request,response).catch(() => {
    if (!response.headersSent) fault(response, 500, 'fixtureError');
    else response.end();
  });
}).listen(8080, '0.0.0.0');
