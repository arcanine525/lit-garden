import { uuidPattern } from '../../../server/auth/identity-operations';
import { driveActor, driveFailure, driveJson } from '../../../server/drive/http';
import { uploadAssignmentAsset } from '../../../server/drive/assignment-assets';
import { rasterUpload } from '../../../server/drive/raster';
import { uploadLibraryImage } from '../../../server/library/items';

export async function POST(request: Request) {
  try {
    const actor = await driveActor(request);
    const assignment = request.headers.get('x-garden-assignment');
    const item = request.headers.get('x-garden-library');
    const key = request.headers.get('idempotency-key');
    if (Boolean(assignment) === Boolean(item) || !key || !uuidPattern.test(assignment ?? item ?? '') || !uuidPattern.test(key)) {
      return driveJson({ error:'INVALID' },422);
    }
    const image = await rasterUpload(request);
    const id = assignment ? await uploadAssignmentAsset(actor.teacher,assignment,key,image) : await uploadLibraryImage(actor,item!,key,image);
    return driveJson({ reference: `/api/assets/${id}` },201);
  } catch (error) { return driveFailure(error); }
}
