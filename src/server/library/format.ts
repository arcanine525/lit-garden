import { maxMarkdownBytes } from '../../shared/editor-markdown';
import { DriveError } from '../drive/provider';

export const libraryFormats = ['markdown','pdf','text'] as const;
export type LibraryFormat = typeof libraryFormats[number];
export type LibraryFields = { title: string; category: string; author: string; sourceLabel: string; excerpt: string; format: LibraryFormat };
export type LibraryInput = LibraryFields & { markdown: string; upload?: { bytes: Buffer; mimeType: 'application/pdf' | 'text/plain' } };
export const maxLibraryUpload = 8 * 1024 * 1024;

function field(value: FormDataEntryValue | null, limit: number) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new DriveError('INVALID_LIBRARY',422);
  }
  return value.trim();
}

export async function libraryForm(request: Request) {
  const contentType = request.headers.get('Content-Type');
  if (!contentType?.startsWith('multipart/form-data;') || !request.body) throw new DriveError('INVALID_LIBRARY',422);
  const limit = maxLibraryUpload + 32_768;
  if (Number(request.headers.get('Content-Length')) > limit) throw new DriveError('LIBRARY_SIZE',413);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value,done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DriveError('LIBRARY_SIZE',413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return new Response(new Uint8Array(Buffer.concat(chunks,size)),{ headers:{ 'Content-Type':contentType } }).formData()
    .catch(() => { throw new DriveError('INVALID_LIBRARY',422); });
}

export function libraryText(bytes: Buffer) {
  let source;
  try { source = new TextDecoder('utf-8',{ fatal:true }).decode(bytes); }
  catch { throw new DriveError('UNSUPPORTED_LIBRARY_FILE',415); }
  if (!source.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) throw new DriveError('UNSUPPORTED_LIBRARY_FILE',415);
  return source;
}

export async function libraryInput(form: FormData): Promise<LibraryInput> {
  const title = field(form.get('title'),160);
  const category = field(form.get('category') ?? '',100);
  const author = field(form.get('author') ?? '',160);
  const sourceLabel = field(form.get('sourceLabel') ?? '',300);
  const excerpt = field(form.get('excerpt') ?? '',2000);
  const format = form.get('format');
  if (!title || typeof format !== 'string' || !libraryFormats.includes(format as LibraryFormat)) throw new DriveError('INVALID_LIBRARY',422);
  const fields = { title,category,author,sourceLabel,excerpt,format:format as LibraryFormat };
  const file = form.get('file');
  const markdown = form.get('markdown');
  if (format === 'markdown') {
    if (file || typeof markdown !== 'string' || !markdown.trim() || Buffer.byteLength(markdown) > maxMarkdownBytes) {
      throw new DriveError('INVALID_LIBRARY',422);
    }
    return { ...fields,markdown };
  }
  if (markdown || !(file instanceof File) || !file.size) throw new DriveError('INVALID_LIBRARY',422);
  if (file.size > maxLibraryUpload) throw new DriveError('LIBRARY_SIZE',413);
  const mimeType = format === 'pdf' ? 'application/pdf' : 'text/plain';
  if (file.type && file.type !== mimeType && file.type !== 'application/octet-stream') throw new DriveError('UNSUPPORTED_LIBRARY_FILE',415);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (format === 'text') libraryText(bytes);
  else if (!/^%PDF-[12]\.\d/.test(bytes.subarray(0,8).toString('ascii')) || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) {
    throw new DriveError('UNSUPPORTED_LIBRARY_FILE',415);
  }
  return { ...fields,markdown:'',upload:{ bytes,mimeType } };
}
