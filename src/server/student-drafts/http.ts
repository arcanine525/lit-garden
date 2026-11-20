import { uuidPattern } from '../auth/identity-operations';
import { currentSession } from '../auth/session';
import { DriveError } from '../drive/provider';

export const isId = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);
export const isVersion = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) < 9_223_372_036_854_775_807n;

export async function studentActor() {
  const session = await currentSession();
  if (!session) throw new DriveError('UNAUTHENTICATED',401);
  if (session.user.role !== 'student') throw new DriveError('FORBIDDEN',403);
  return { student:session.user.id, sessionDigest:session.sessionDigest };
}
