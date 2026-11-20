import { encodeDocument, decodeDocument } from '../drive/envelope';
import { uuidPattern } from '../auth/identity-operations';
import { DriveError } from '../drive/provider';
import { reviewAnchor, reviewColors, type ReviewColor, type ReviewComment, type ReviewDraft } from '../../shared/review';
import type { ReviewSource } from './source';

function invalid(): never { throw new DriveError('INVALID_REVIEW_DRAFT',422); }
function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string,unknown>;
}

export function reviewDraftInput(input: unknown, source: ReviewSource): ReviewDraft {
  const draft = record(input);
  if (!Array.isArray(draft.scores) || draft.scores.length > source.rubric.criteria.length ||
      !Array.isArray(draft.comments) || draft.comments.length > 51 ||
      Object.keys(draft).some(key => !['scores','comments','overallCommentId'].includes(key))) invalid();
  const levels = new Map<string,string>();
  for (const input of draft.scores) {
    const item = record(input);
    const { criterionId,levelId,value } = item;
    if (typeof criterionId !== 'string' || typeof levelId !== 'string' || levels.has(criterionId) || Object.keys(item).length !== 3) invalid();
    const level = source.rubric.criteria.find(criterion => criterion.id === criterionId)?.levels.find(level => level.id === levelId);
    if (!level || level.score !== value) invalid();
    levels.set(criterionId,levelId);
  }
  const scores = source.rubric.criteria.flatMap(criterion => {
    const chosen = criterion.levels.find(level => level.id === levels.get(criterion.id));
    return chosen ? [{ criterionId:criterion.id,levelId:chosen.id,value:chosen.score }] : [];
  });
  const ids = new Set<string>();
  const comments = draft.comments.map((input): ReviewComment => {
    const item = record(input);
    const { id,body,kind,color } = item;
    if (typeof id !== 'string' || id !== id.toLowerCase() || !uuidPattern.test(id) || ids.has(id) ||
        typeof body !== 'string' || body.length > 3000 || body.includes('\u0000')) invalid();
    ids.add(id);
    if (kind === 'overall' && Object.keys(item).length === 3 && body.trim()) return { id,kind,body };
    if (kind !== 'range' || typeof color !== 'string' || !Object.hasOwn(reviewColors,color) || Object.keys(item).length !== 5) invalid();
    const anchor = record(item.anchor);
    if (typeof anchor.start !== 'number' || typeof anchor.end !== 'number') invalid();
    const expected = reviewAnchor(source.text,source.projectionSha256,anchor.start,anchor.end);
    if (!expected || Object.keys(anchor).length !== 6 || Object.entries(expected).some(([key,value]) => anchor[key] !== value)) {
      throw new DriveError('ANCHOR_CONFLICT',409);
    }
    return { id,kind,body,color:color as ReviewColor,anchor:expected };
  }).sort((a,b) => a.id.localeCompare(b.id));
  const overall = comments.filter(comment => comment.kind === 'overall');
  if (overall.length > 1 || comments.length-overall.length > 50 || draft.overallCommentId !== (overall[0]?.id ?? null)) invalid();
  return { scores,comments,overallCommentId:overall[0]?.id ?? null };
}

function metadata(source: ReviewSource) {
  return { submissionId:source.submission.id,version:source.submission.submission_no,rubricId:source.rubric.id,
    rubricSha256:source.rubricHash,submissionSha256:source.submissionSha256,textProjection:source.textProjection };
}

export function encodeReviewDraft(source: ReviewSource, stream: string, generation: string, draft: ReviewDraft) {
  return encodeDocument('garden.review-draft/1',stream,{ ...metadata(source),generation,...draft });
}

export function decodeReviewDraft(bytes: Buffer, source: ReviewSource, stream: string, generation: string) {
  const decoded = decodeDocument<Record<string,unknown>>(bytes,'garden.review-draft/1',stream);
  const { fields,body } = decoded;
  if (body || fields.generation !== generation || Object.entries(metadata(source)).some(([key,value]) => fields[key] !== value)) {
    throw new DriveError('REVIEW_DRAFT_CONFLICT',409);
  }
  const { scores,comments,overallCommentId } = fields;
  return reviewDraftInput({ scores,comments,overallCommentId },source);
}
