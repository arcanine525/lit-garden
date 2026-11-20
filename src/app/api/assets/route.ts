import { uuidPattern } from '../../../server/auth/identity-operations';
import { driveActor, driveFailure, driveJson } from '../../../server/drive/http';
import { uploadAssignmentAsset } from '../../../server/drive/assignment-assets';
import { rasterUpload } from '../../../server/drive/raster';

export async function POST(request: Request) {
  try {
    const actor = await driveActor(request);
    const assignment = request.headers.get('x-garden-assignment');
    const key = request.headers.get('idempotency-key');
    if (!assignment || !key || !uuidPattern.test(assignment) || !uuidPattern.test(key)) return driveJson({ error: 'INVALID' },422);
    const id = await uploadAssignmentAsset(actor.teacher,assignment,key,await rasterUpload(request));
    return driveJson({ reference: `/api/assets/${id}` },201);
  } catch (error) { return driveFailure(error); }
}
