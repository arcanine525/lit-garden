import { driveStatus, finishDriveSetup, pickerOptions, startDrive } from '../../../server/drive/connection';
import { driveActor, driveFailure, driveJson, privateHeaders } from '../../../server/drive/http';

export async function GET(request: Request) {
  try {
    const actor = await driveActor();
    if (new URL(request.url).searchParams.get('view') === 'picker') return driveJson(await pickerOptions(actor));
    return driveJson(await driveStatus(actor));
  } catch (error) { return driveFailure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await driveActor(request);
    const contentType = request.headers.get('content-type');
    if (contentType?.startsWith('application/x-www-form-urlencoded')) {
      const action = (await request.formData()).get('action');
      if (action !== 'authorize') return driveJson({ error: 'INVALID' }, 422);
      return new Response(null, { status: 303, headers: { ...privateHeaders, Location: (await startDrive(actor)).href } });
    }
    const body = await request.json().catch(() => null);
    if (body?.action !== 'finish' || (body.parent !== undefined && typeof body.parent !== 'string')) {
      return driveJson({ error: 'INVALID' }, 422);
    }
    return driveJson(await finishDriveSetup(actor,body.parent));
  } catch (error) { return driveFailure(error); }
}
