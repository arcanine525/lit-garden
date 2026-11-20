import { DriveError } from './provider';

export function encodeDocument(schema: string, id: string, fields: object, body = '') {
  return Buffer.from(`---\ngarden: ${JSON.stringify({ schema,id,...fields })}\n---\n${body}`);
}

export function decodeDocument<T>(bytes: Buffer, schema: string, id: string) {
  try {
    const decoded = new TextDecoder('utf-8',{ fatal:true }).decode(bytes);
    const match = /^---\ngarden: ([^\n]+)\n---\n/.exec(decoded);
    if (!match) throw new Error('Invalid document');
    const { schema: kind, id: resource, ...fields } = JSON.parse(match[1]);
    const body = decoded.slice(match[0].length);
    if (kind !== schema || resource !== id || !encodeDocument(kind,resource,fields,body).equals(bytes)) throw new Error('Invalid document');
    return { fields:fields as T, body };
  } catch { throw new DriveError('DRIVE_INTEGRITY',409); }
}
