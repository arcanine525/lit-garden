import { appOrigin } from '../../../server/auth/oidc';
import { currentSession } from '../../../server/auth/session';
import { privateHeaders } from '../../../server/drive/http';
import { notificationDestination } from '../../../server/notifications';
import { isId } from '../../../server/student-drafts/http';

type Params = { params: Promise<{ id: string }> };
const redirect = (path: string) => new Response(null,{
  status:303,headers:{ ...privateHeaders,Location:new URL(path,appOrigin()).href }
});
const missing = () => new Response(null,{ status:404,headers:privateHeaders });

export async function GET(_request: Request,{ params }: Params) {
  const session = await currentSession();
  if (!session) return redirect('/');
  const { id } = await params;
  if (session.user.role === 'admin' || !isId(id)) return missing();
  const target = await notificationDestination(session.user.id,id.toLowerCase());
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) return redirect('/');
  if (!target) return missing();
  return redirect(target.path ?? '/notifications?unavailable=1');
}
