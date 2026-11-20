import { appOrigin } from '../../../../server/auth/oidc';
import { captureDriveAuthorization } from '../../../../server/drive/connection';
import { driveActor, privateHeaders } from '../../../../server/drive/http';
import { DriveError } from '../../../../server/drive/provider';

export async function GET(request: Request) {
  let result = 'ready';
  try {
    const actor = await driveActor();
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    if (!state || !/^[\w-]{43}$/.test(state)) throw new DriveError('DRIVE_CALLBACK_EXPIRED', 409);
    await captureDriveAuthorization(actor,state,url.search);
  } catch (error) {
    result = error instanceof DriveError ? error.code : 'DRIVE_AUTH';
  }
  const next = new URL('/drive',appOrigin());
  next.searchParams.set('connect',result);
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: next.href } });
}
