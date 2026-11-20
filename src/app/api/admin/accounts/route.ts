import { appOrigin } from '../../../../server/auth/oidc';
import { currentSession } from '../../../../server/auth/session';
import {
  accountDirectory, changeIdentity, IdentityError, reconcileIdentity, uuidPattern, type Mutation
} from '../../../../server/auth/identity-operations';

const headers = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { headers, status });
const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

async function admin(write: boolean) {
  const session = await currentSession();
  if (!session) throw new IdentityError(401, 'UNAUTHENTICATED');
  if (session.user.role !== 'admin') throw new IdentityError(403, 'FORBIDDEN');
  if (write && !session.recentAuth) throw new IdentityError(403, 'REAUTH_REQUIRED');
  return session.user;
}

function failure(error: unknown) {
  return error instanceof IdentityError ? json({ error: error.code }, error.status) : json({ error: 'UNAVAILABLE' }, 503);
}

export async function GET() {
  try {
    await admin(false);
    return json({ accounts: await accountDirectory() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appOrigin()) throw new IdentityError(403, 'FORBIDDEN');
    const actor = await admin(true);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new IdentityError(422, 'INVALID');
    if (body.kind === 'reconcile' && isUuid(body.operationId)) {
      const result = await reconcileIdentity(actor.id, body.operationId);
      return json(result, result.operation.state === 'committed' ? 200 : 202);
    }
    if (!isUuid(body.key)) throw new IdentityError(422, 'INVALID');
    let mutation: Mutation;
    if (body.kind === 'create_teacher' && typeof body.username === 'string' && /^[a-z0-9_]{3,30}$/.test(body.username)
        && typeof body.name === 'string' && body.name.trim().length > 0 && body.name.trim().length <= 100) {
      mutation = { kind: body.kind, key: body.key, username: body.username, name: body.name.trim() };
    } else if ((body.kind === 'suspend_teacher' || body.kind === 'resume_teacher') && isUuid(body.userId)) {
      mutation = { kind: body.kind, key: body.key, userId: body.userId };
    } else if (body.kind === 'reset_student' && isUuid(body.userId) && body.identityVerified === true) {
      mutation = { kind: body.kind, key: body.key, userId: body.userId, identityVerified: true };
    } else {
      throw new IdentityError(422, 'INVALID');
    }
    const result = await changeIdentity(actor.id, mutation);
    return json(result, result.operation.state === 'committed' ? 200 : 202);
  } catch (error) {
    return failure(error);
  }
}
