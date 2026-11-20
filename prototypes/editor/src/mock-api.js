// PROTOTYPE ONLY: deterministic principals, fake Drive bytes, memory only.
// No Google credentials are loaded or requested.
import { randomUUID } from 'node:crypto';
import { validateMarkdown, walk, referenceDefinitions } from './markdown.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64');
export function mockApi() {
  const sessions = new Map(), leases = new Map();
  const assets = new Map([['flower', { status: 'available', owner: 'teacher', documentId: 'assignment-1', bytes: png }]]);
  function fail(code, status = 400) { throw Object.assign(Error(code), { status }); }
  function permission(user, asset) {
    if (!user || !['teacher', 'student'].includes(user)) fail('FORBIDDEN', 403);
    if (!asset) fail('ASSET_NOT_FOUND', 404);
    // Fixture: student is assigned assignment-1; outsider is not. Admin denied.
    if (asset.owner !== 'teacher' || asset.documentId !== 'assignment-1') fail('FORBIDDEN', 403);
    if (asset.status === 'revoked') fail('DRIVE_PERMISSION_LOST', 403);
    if (asset.status === 'missing') fail('DRIVE_FILE_MISSING', 404);
    if (asset.status === 'disconnected') fail('DRIVE_RECONNECT', 503);
  }
  return { name: 'editor-mock-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const sid = /(?:^|; )mock_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
      const user = sessions.get(sid);
      const json = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      try {
        // Origin check for writes (real deployment additionally uses app CSRF policy).
        if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) fail('ORIGIN', 403);
        let raw = Buffer.alloc(0);
        if (req.method === 'POST') {
          for await (const chunk of req) { raw = Buffer.concat([raw, chunk]); if (raw.length > 2000000) fail('BODY_SIZE', 413); }
        }
        const body = () => JSON.parse(raw.toString() || '{}');
        if (url.pathname === '/api/mock/login' && req.method === 'POST') {
          const { role } = body();
          if (!['teacher', 'student', 'outsider', 'admin'].includes(role)) fail('ROLE');
          if (sid) sessions.delete(sid);
          const id = randomUUID(); sessions.set(id, role);
          res.setHeader('Set-Cookie', `mock_session=${id}; HttpOnly; SameSite=Strict; Path=/`);
          return json({ role, mock: true });
        }
        if (!user) fail('UNAUTHENTICATED', 401);
        if (url.pathname === '/api/documents' && req.method === 'POST') {
          if (!['teacher', 'student'].includes(user)) fail('FORBIDDEN', 403);
          const tree = validateMarkdown(body().markdown, user);
          const definitions = referenceDefinitions(tree);
          walk(tree, (n) => { if (n.type === 'image' || n.type === 'imageReference') { const url = n.url ?? definitions.get(n.identifier)?.url; permission(user, assets.get(url.split('/').at(-1))); } });
          return json({ accepted: true, persisted: false, mock: true });
        }
        if (url.pathname === '/api/assets' && req.method === 'POST') {
          if (user !== 'teacher') fail('TEACHER_ONLY', 403);
          // Narrow spike: PNG signature. Production needs decoded raster validation,
          // metadata stripping/re-encoding, limits; SVG is deliberately excluded.
          if (req.headers['content-type'] !== 'image/png' || !raw.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('PNG_REQUIRED', 415);
          const id = `mock-${randomUUID()}`;
          assets.set(id, { status: 'available', owner: user, documentId: 'assignment-1', bytes: raw });
          return json({ reference: `/api/assets/${id}`, mock: true }, 201);
        }
        const assetRoute = /^\/api\/assets\/([\w-]+)\/(lease|state)$/.exec(url.pathname);
        if (assetRoute && req.method === 'POST') {
          const [, id, action] = assetRoute; const asset = assets.get(id);
          if (action === 'state') {
            if (user !== 'teacher') fail('TEACHER_ONLY', 403);
            if (!asset) fail('ASSET_NOT_FOUND', 404);
            const { status } = body();
            if (!['available', 'revoked', 'missing', 'disconnected'].includes(status)) fail('STATE');
            asset.status = status; return json({ status, mock: true });
          }
          permission(user, asset);
          const lease = randomUUID(), expiresAt = Date.now() + 1500;
          leases.set(lease, { assetId: id, sid, expiresAt });
          return json({ url: `/api/asset-views/${lease}`, expiresAt, mock: true });
        }
        const view = /^\/api\/asset-views\/([\w-]+)$/.exec(url.pathname);
        if (view && req.method === 'GET') {
          const lease = leases.get(view[1]);
          if (!lease || lease.sid !== sid) fail('LEASE_FORBIDDEN', 403);
          if (Date.now() >= lease.expiresAt) { leases.delete(view[1]); fail('LEASE_EXPIRED', 410); }
          const asset = assets.get(lease.assetId); permission(user, asset);
          res.setHeader('Content-Type', 'image/png'); res.end(asset.bytes); return;
        }
        fail('NOT_FOUND', 404);
      } catch (error) { json({ error: error.message, mock: true }, error.status ?? 400); }
    });
  } };
}
