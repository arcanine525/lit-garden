import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { requiredEnv } from '../config';
import { driveMode, DriveError } from './provider';

const algorithm = 'aes-256-gcm';
const localKeyId = 'local-v1';
const kmsKeyPath = /^projects\/[\w-]+\/locations\/[\w-]+\/keyRings\/[\w-]+\/cryptoKeys\/[\w-]+$/;
const kmsAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
type TokenContext = { teacher: string; subject: string };
type Envelope = { v: 1; nonce: string; tag: string; bytes: string; wrappedKey: string };

function encrypt(key: Buffer, bytes: Buffer, aad: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, nonce).setAAD(aad);
  return Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}

function decrypt(key: Buffer, encrypted: Buffer, aad: Buffer) {
  const decipher = createDecipheriv(algorithm, key, encrypted.subarray(0,12));
  decipher.setAAD(aad).setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([decipher.update(encrypted.subarray(12,-16)), decipher.final()]);
}

function localKey() {
  const value = requiredEnv('APP_DRIVE_KEY_SECRET');
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new DriveError('DRIVE_KEY_UNAVAILABLE');
  return Buffer.from(value, 'hex');
}

async function wrap(keyId: string, value: Buffer, aad: Buffer, action: 'encrypt' | 'decrypt') {
  if (driveMode() === 'fake') {
    if (keyId !== localKeyId) throw new DriveError('DRIVE_KEY_UNAVAILABLE');
    return (action === 'encrypt' ? encrypt : decrypt)(localKey(), value, aad);
  }
  if (!kmsKeyPath.test(keyId)) throw new DriveError('DRIVE_KEY_UNAVAILABLE');
  const input = action === 'encrypt' ? 'plaintext' : 'ciphertext';
  const output = action === 'encrypt' ? 'ciphertext' : 'plaintext';
  const client = await kmsAuth.getClient();
  const response = await client.request<Record<string,string>>({
    url: `https://cloudkms.googleapis.com/v1/${keyId}:${action}`, method: 'POST', timeout: 8000,
    data: { [input]: value.toString('base64'), additionalAuthenticatedData: aad.toString('base64') }
  });
  if (!response.data[output]) throw new DriveError('DRIVE_KEY_UNAVAILABLE');
  return Buffer.from(response.data[output], 'base64');
}

const tokenAad = ({ teacher, subject }: TokenContext) => Buffer.from(JSON.stringify(['garden.drive-token/1',teacher,subject]));

export async function sealToken(token: string, context: TokenContext) {
  const keyId = driveMode() === 'fake' ? localKeyId : requiredEnv('APP_DRIVE_KMS_KEY');
  const aad = tokenAad(context);
  const dek = randomBytes(32);
  try {
    const encrypted = encrypt(dek, Buffer.from(token), aad);
    const wrapped = await wrap(keyId, dek, aad, 'encrypt');
    const envelope: Envelope = {
      v: 1, nonce: encrypted.subarray(0,12).toString('base64'), tag: encrypted.subarray(-16).toString('base64'),
      bytes: encrypted.subarray(12,-16).toString('base64'), wrappedKey: wrapped.toString('base64')
    };
    return { ciphertext: Buffer.from(JSON.stringify(envelope)), keyId };
  } catch { throw new DriveError('DRIVE_KEY_UNAVAILABLE'); }
  finally { dek.fill(0); }
}

export async function openToken(ciphertext: Buffer, keyId: string, context: TokenContext) {
  let dek: Buffer | undefined;
  try {
    const envelope: Envelope = JSON.parse(ciphertext.toString());
    if (envelope.v !== 1) throw new DriveError('DRIVE_KEY_UNAVAILABLE');
    const aad = tokenAad(context);
    dek = await wrap(keyId, Buffer.from(envelope.wrappedKey,'base64'), aad, 'decrypt');
    const encrypted = Buffer.concat([envelope.nonce,envelope.bytes,envelope.tag].map(value => Buffer.from(value,'base64')));
    return decrypt(dek, encrypted, aad).toString();
  } catch { throw new DriveError('DRIVE_KEY_UNAVAILABLE'); }
  finally { dek?.fill(0); }
}
