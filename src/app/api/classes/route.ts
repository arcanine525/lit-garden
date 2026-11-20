import {
  approveEnrollment, importCsv, listStudentClasses, listTeacherClasses, previewCsv,
  provisionStudent, requestEnrollment, RosterError, saveClass
} from '../../../server/classes/roster';
import { isUsername } from '../../../server/classes/csv';
import { sessionUser } from '../../../server/auth/session';
import { uuidPattern } from '../../../server/auth/identity-operations';
import { appOrigin } from '../../../server/auth/oidc';

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' }
});
const isUuid = (input: unknown): input is string => typeof input === 'string' && uuidPattern.test(input);
function text(input: unknown, max: number): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > max) throw new RosterError(422, 'INVALID');
  return input.trim();
}

function fault(error: unknown) {
  if (error instanceof RosterError) return json({ error: error.code }, error.status);
  return json({ error: 'UNAVAILABLE' }, 503);
}

export async function GET() {
  try {
    const user = await sessionUser();
    if (!user) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (user.role === 'teacher') return json(await listTeacherClasses(user.id));
    if (user.role === 'student') return json(await listStudentClasses(user.id));
    return json({ error: 'FORBIDDEN' }, 403);
  } catch (error) {
    return fault(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appOrigin()) return json({ error: 'FORBIDDEN' }, 403);
    const user = await sessionUser();
    if (!user) return json({ error: 'UNAUTHENTICATED' }, 401);
    const raw: unknown = await request.json().catch(() => null);
    if (typeof raw !== 'object' || raw === null) return json({ error: 'INVALID' }, 422);
    const body = raw as Record<string, unknown>;

    if (body.action === 'join') {
      if (user.role !== 'student') return json({ error: 'FORBIDDEN' }, 403);
      const code = text(body.code,12).toUpperCase();
      if (!/^[A-F0-9]{12}$/.test(code)) return json({ error: 'INVALID_CODE' }, 422);
      return json(await requestEnrollment(user.id, code));
    }
    if (user.role !== 'teacher') return json({ error: 'FORBIDDEN' }, 403);

    switch (body.action) {
      case 'save_class': {
        const classId = body.classId;
        if (classId !== undefined && !isUuid(classId)) return json({ error: 'INVALID' }, 422);
        return json(await saveClass(user.id, text(body.name,100), text(body.year,30), classId), classId ? 200 : 201);
      }
      case 'approve':
        if (!isUuid(body.requestId)) return json({ error: 'INVALID' }, 422);
        return json(await approveEnrollment(user.id, body.requestId));
      case 'create_student': {
        const { key, classId, username } = body;
        if (!isUuid(key) || !isUuid(classId) || typeof username !== 'string' || !isUsername(username)) {
          return json({ error: 'INVALID' }, 422);
        }
        const result = await provisionStudent(user.id, key, { classId, username, name: text(body.name,100) });
        return json(result, result.state === 'pending' ? 202 : 200);
      }
      case 'preview_csv':
        if (typeof body.source !== 'string') return json({ error: 'INVALID_CSV' }, 422);
        return json(await previewCsv(user.id, body.source));
      case 'import_csv':
        if (typeof body.source !== 'string' || !isUuid(body.batch) ||
            (body.line !== undefined && (typeof body.line !== 'number' || !Number.isInteger(body.line) || body.line < 2))) {
          return json({ error: 'INVALID_CSV' }, 422);
        }
        return json(await importCsv(user.id, body.source, body.batch, body.line as number | undefined));
      default:
        return json({ error: 'INVALID' }, 422);
    }
  } catch (error) {
    return fault(error);
  }
}
