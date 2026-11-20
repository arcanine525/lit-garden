import type { ReviewDraft } from '../../shared/review';

export type DeviceReview = { branch: string; savedAt: number; draft: ReviewDraft };

function storage() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('vuon-van-reviews',1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function latestDeviceReview(teacher: string, submission: string) {
  const db = await storage();
  try {
    return await new Promise<DeviceReview | null>((resolve,reject) => {
      const request = db.transaction('drafts').objectStore('drafts')
        .getAll(IDBKeyRange.bound([teacher,submission,''],[teacher,submission,'\uffff']));
      request.onsuccess = () => resolve((request.result as DeviceReview[]).sort((a,b) => b.savedAt-a.savedAt)[0] ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function keepDeviceReview(teacher: string, submission: string, branch: string, draft: ReviewDraft | null) {
  const db = await storage();
  try {
    await new Promise<void>((resolve,reject) => {
      const tx = db.transaction('drafts','readwrite');
      const store = tx.objectStore('drafts');
      const key = [teacher,submission,branch];
      if (draft) store.put({ draft,branch,savedAt:Date.now() },key);
      else store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
