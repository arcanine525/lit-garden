import sharp from 'sharp';
import { DriveError } from './provider';

const maxImageBytes = 5 * 1024 * 1024;
const maxPixels = 12_000_000;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as const;

export async function rasterUpload(request: Request) {
  const mimeType = request.headers.get('content-type')?.toLowerCase();
  if (!mimeType || !(mimeType in formats) || !request.body) throw new DriveError('UNSUPPORTED_IMAGE', 415);
  if (Number(request.headers.get('content-length')) > maxImageBytes) throw new DriveError('IMAGE_LIMIT', 413);
  const format = formats[mimeType as keyof typeof formats];
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new DriveError('IMAGE_LIMIT', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const image = sharp(Buffer.concat(chunks,size), { limitInputPixels: maxPixels, failOn: 'warning' });
  let bytes: Buffer;
  try {
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error('Invalid raster');
    bytes = await image.rotate().toFormat(format).toBuffer();
  } catch { throw new DriveError('UNSUPPORTED_IMAGE', 415); }
  if (bytes.length > maxImageBytes) throw new DriveError('IMAGE_LIMIT', 413);
  return { bytes, mimeType, format };
}
