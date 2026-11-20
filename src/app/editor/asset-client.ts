import { assetReference } from '../../shared/editor-markdown';

export async function assetBlob(reference: string) {
  if (!assetReference.test(reference)) throw Error('PRIVATE_ASSET_REQUIRED');
  const lease = await fetch(`${reference}/lease`,{ method: 'POST', cache: 'no-store' });
  const result = await lease.json();
  if (!lease.ok) throw Error(result.error);
  const response = await fetch(result.url,{ cache: 'no-store' });
  if (!response.ok) throw Error((await response.json()).error);
  return response.blob();
}
