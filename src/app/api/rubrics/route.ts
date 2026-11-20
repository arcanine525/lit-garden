import { uuidPattern } from '../../../server/auth/identity-operations';
import { appOrigin } from '../../../server/auth/oidc';
import { sessionUser } from '../../../server/auth/session';
import { changeRubric, listRubrics } from '../../../server/rubrics/catalog';
import { parseRubric, RubricError } from '../../../server/rubrics/definition';

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' }
});

function failure(error: unknown) {
  return error instanceof RubricError ? json({ error: error.code }, error.status) : json({ error: 'UNAVAILABLE' }, 503);
}

export async function GET() {
  try {
    const actor = await sessionUser();
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    return json({ rubrics: await listRubrics(actor.role === 'admin') });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return json({ error: 'FORBIDDEN' }, 403);
    const actor = await sessionUser();
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (actor.role !== 'admin') return json({ error: 'FORBIDDEN' }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.id !== 'string' || !uuidPattern.test(body.id)) return json({ error: 'INVALID_RUBRIC' }, 422);
    const { action, id, expectedRevision } = body;
    if (action === 'create') {
      const parsed = parseRubric(body.label, body.definition);
      return json(await changeRubric(actor.id, { action, id, expectedRevision: 0, ...parsed }), 201);
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || expectedRevision >= 2_147_483_647) {
      return json({ error: 'INVALID_RUBRIC' }, 422);
    }
    if (action === 'retire') return json(await changeRubric(actor.id, { action, id, expectedRevision }));
    if (action !== 'revise') return json({ error: 'INVALID_RUBRIC' }, 422);
    return json(await changeRubric(actor.id, { action, id, expectedRevision, ...parseRubric(body.label, body.definition) }));
  } catch (error) {
    return failure(error);
  }
}
