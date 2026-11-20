import type { DraftBody } from '../../../../server/student-drafts/access';

export type DeviceCopy = DraftBody & { branch: string; savedAt: number; version: string; hash: string | null };
export const syncedBranch = 'synced';

function storage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vuon-van-writing',1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deviceDrafts(student: string, assignment: string) {
  const db = await storage();
  try {
    return await new Promise<{ recovery: DeviceCopy | null; synced: DeviceCopy | null }>((resolve,reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll(
        IDBKeyRange.bound([student,assignment,''],[student,assignment,'\uffff']));
      request.onsuccess = () => {
        const saved = request.result as DeviceCopy[];
        resolve({ recovery:saved.filter(copy => copy.branch !== syncedBranch).sort((a,b) => b.savedAt-a.savedAt)[0] ?? null,
          synced:saved.find(copy => copy.branch === syncedBranch) ?? null });
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function keepDeviceCopy(student: string, assignment: string, branch: string, copy: DeviceCopy | null) {
  const db = await storage();
  try {
    await new Promise<void>((resolve,reject) => {
      const tx = db.transaction('drafts','readwrite');
      const store = tx.objectStore('drafts');
      const key = [student,assignment,branch];
      if (copy?.branch === syncedBranch) {
        const request = store.get(key);
        request.onsuccess = () => {
          if (!request.result || BigInt(request.result.version) <= BigInt(copy.version)) store.put(copy,key);
        };
      } else if (copy) store.put(copy,key);
      else store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function downloadDraft({ markdown, explanation }: DraftBody) {
  const prefix = explanation ? `---\nexplanation: ${JSON.stringify(explanation)}\n---\n\n` : '';
  const url = URL.createObjectURL(new Blob([prefix,markdown],{ type:'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vuon-van-nhap.md';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url),0);
}
