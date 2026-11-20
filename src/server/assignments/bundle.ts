import { uuidPattern } from '../auth/identity-operations';
import { DriveError } from '../drive/provider';
import type { Rubric } from '../rubrics/definition';
import { maxMarkdownBytes } from '../../shared/editor-markdown';
import { encodeDocument, decodeDocument } from '../drive/envelope';

export type AssignmentDraft = {
  title: string; prompt: string; material: string; reference: string;
  rubricId: string; rubricRevision: number; scale: string; dueAt?: string | null;
};
export type AssignmentPrompt = Pick<AssignmentDraft, 'title' | 'prompt' | 'material'>;
export type RubricSnapshot = { id: string; label: string; revision: number; scale: string; max: string;
  criteria: Rubric['definition']['criteria']; rounding: 'round-half-up-2' };

export function draftInput(input: unknown): AssignmentDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DriveError('INVALID_DRAFT',422);
  const value = input as Record<string,unknown>;
  if (Object.keys(value).some(key => !['title','prompt','material','reference','rubricId','rubricRevision','scale','dueAt'].includes(key)) ||
      typeof value.title !== 'string' || value.title.trim().length > 160 || /[\r\n\u0000]/.test(value.title) ||
      typeof value.prompt !== 'string' || typeof value.material !== 'string' || typeof value.reference !== 'string' ||
      typeof value.rubricId !== 'string' || !uuidPattern.test(value.rubricId) ||
      typeof value.rubricRevision !== 'number' || !Number.isSafeInteger(value.rubricRevision) || value.rubricRevision < 1 ||
      typeof value.scale !== 'string' || !/^\d{1,3}(?:[.,]\d{1,2})?$/.test(value.scale)) throw new DriveError('INVALID_DRAFT',422);
  const scale = Number(value.scale.replace(',','.'));
  if (scale < .25 || scale > 100 || !Number.isInteger(scale * 4)) throw new DriveError('INVALID_SCALE',422);
  const draft = { title: value.title.trim(), prompt: value.prompt, material: value.material, reference: value.reference,
    rubricId: value.rubricId, rubricRevision: value.rubricRevision, scale: scale.toFixed(2),
    ...(value.dueAt === undefined ? {} : { dueAt: deadlineInput(value.dueAt) }) };
  if (Buffer.byteLength(JSON.stringify(draft)) > maxMarkdownBytes) throw new DriveError('MARKDOWN_SIZE',422);
  return draft;
}

export function deadlineInput(input: unknown) {
  if (input === null) return null;
  if (typeof input !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input)) throw new DriveError('INVALID_DEADLINE',422);
  const due = new Date(input);
  if (!Number.isFinite(due.getTime()) || due.toISOString() !== input) throw new DriveError('INVALID_DEADLINE',422);
  return input;
}

export const encodeAssignment = encodeDocument;

export function decodeAssignment<T>(bytes: Buffer, schema: string, id: string): T {
  return decodeDocument<T>(bytes,schema,id).fields;
}

export function assignmentFiles(id: string, op: string, draft: AssignmentDraft, rubric: Rubric) {
  const prompt = { title: draft.title, prompt: draft.prompt, material: draft.material };
  const snapshot: RubricSnapshot = {
    id: rubric.id, label: rubric.label, revision: rubric.revision, scale: draft.scale, max: rubric.definition.max,
    criteria: rubric.definition.criteria, rounding: 'round-half-up-2'
  };
  const snapshotFields = { label: snapshot.label, revision: snapshot.revision, scale: snapshot.scale, max: snapshot.max,
    criteria: snapshot.criteria, rounding: snapshot.rounding, assignmentId: id };
  const files = [
    { slot: 'prompt' as const, bytes: encodeAssignment('garden.assignment-prompt/1',id,prompt,
      [draft.prompt,draft.material].filter(Boolean).join('\n\n')) },
    { slot: 'rubric' as const, bytes: encodeAssignment('garden.rubric-snapshot/1',snapshot.id,snapshotFields) }
  ];
  const reference = draft.reference.trim() ? [{ slot: 'reference' as const,
    bytes: encodeAssignment('garden.assignment-reference/1',id,{ reference: draft.reference },draft.reference) }] : [];
  return [...files,...reference].map(file => ({ ...file, operationId: op, mimeType: 'text/markdown', name: `${file.slot}-${op}.md` }));
}
