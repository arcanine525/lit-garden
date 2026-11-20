import type { DraftBody } from '../../../../server/student-drafts/access';
import type { Snapshot } from '../../../../server/student-drafts/writer';
import { formatDraftMarkdown } from '../../../../shared/draft-markdown';

export type DeviceCopy = DraftBody & { branch: string; savedAt: number; version: string; hash: string | null };
export type PendingSubmission = Snapshot & { action: 'submit'; draft: DraftBody };
export const syncedBranch = 'synced';

function storage() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('vuon-van-writing',2);
    request.onupgradeneeded = event => {
      if (event.oldVersion < 1) request.result.createObjectStore('drafts');
      if (event.oldVersion < 2) request.result.createObjectStore('submissions');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function pendingSubmission(student: string, assignment: string) {
  const db = await storage();
  try {
    return await new Promise<PendingSubmission | null>((resolve,reject) => {
      const request = db.transaction('submissions').objectStore('submissions').get([student,assignment]);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function keepSubmission(student: string, assignment: string, attempt: PendingSubmission, clear = false) {
  const db = await storage();
  try {
    return await new Promise<PendingSubmission>((resolve,reject) => {
      const tx = db.transaction('submissions','readwrite');
      const store = tx.objectStore('submissions');
      const key = [student,assignment];
      let saved = attempt;
      const request = store.get(key);
      request.onsuccess = () => {
        if (clear) {
          if (request.result?.key === attempt.key) store.delete(key);
        } else if (request.result) saved = request.result;
        else store.put(attempt,key);
      };
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
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

export function downloadDraft(draft: DraftBody) {
  const url = URL.createObjectURL(new Blob([formatDraftMarkdown(draft)],{ type:'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vuon-van-nhap.md';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url),0);
}
