import { parseDocument, stringify } from 'yaml';
import { projectMarkdown, sha256 } from './markdown.js';
export const schema = 'vv-review-proposal-v1';
function isUtf16Boundary(text, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}
export async function makeAnchor(markdown, start, end) {
  const { text } = projectMarkdown(markdown);
  if (!isUtf16Boundary(text, start) || !isUtf16Boundary(text, end) || end <= start) throw Error('ANCHOR_RANGE');
  return { projection: 'vv-render-text-v1', start, end, exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32), textHash: await sha256(text) };
}
export function writeReview(review) {
  validateReview(review);
  // Entire review is one Markdown file. Structured data is YAML front matter;
  // the generated body is a readable view, never parsed as a second authority.
  return `---\n${stringify(review, { blockQuote: false })}---\n\n# Nhận xét bài viết\n\n${review.overall || '(Không có nhận xét chung)'}\n\n## Rubric\n\n${review.scores.map((s) => `- ${s.criterionId}: ${s.value ?? 'Chưa chấm'} / ${s.max}`).join('\n')}\n\n## Góp ý theo đoạn\n\n${review.annotations.map((a) => `> ${a.anchor.exact.replaceAll('\n', '\n> ')}\n\n${a.comment}`).join('\n\n')}\n`;
}
export function readReview(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 250000) throw Error('REVIEW_SIZE');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw Error('REVIEW_FRONTMATTER');
  const doc = parseDocument(match[1], { uniqueKeys: true, strict: true });
  if (doc.errors.length) throw Error('REVIEW_YAML');
  const data = doc.toJS({ maxAliasCount: 0 });
  validateReview(data);
  return data;
}
export function validateReview(r) {
  if (!r || r.schema !== schema || !['draft', 'publication'].includes(r.kind) || typeof r.id !== 'string' || typeof r.submissionId !== 'string' || !Number.isInteger(r.version) || r.version < 1 || !/^[a-f0-9]{64}$/.test(r.contentHash)) throw Error('REVIEW_IDENTITY');
  if (typeof r.overall !== 'string' || !Array.isArray(r.scores) || !r.scores.length || !Array.isArray(r.annotations)) throw Error('REVIEW_FIELDS');
  const scoreIds = new Set();
  for (const s of r.scores) {
    if (typeof s.criterionId !== 'string' || scoreIds.has(s.criterionId) || !Number.isFinite(s.max) || s.max <= 0 || (s.value !== null && (!Number.isFinite(s.value) || s.value < 0 || s.value > s.max)) || (r.kind === 'publication' && s.value === null)) throw Error('REVIEW_SCORES');
    scoreIds.add(s.criterionId);
  }
  const ids = new Set();
  for (const a of r.annotations) {
    const p = a.anchor;
    if (typeof a.id !== 'string' || ids.has(a.id) || typeof a.comment !== 'string' || !['yellow', 'green', 'pink', 'blue'].includes(a.color) || !p || p.projection !== 'vv-render-text-v1' || !Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end <= p.start || typeof p.exact !== 'string' || typeof p.prefix !== 'string' || typeof p.suffix !== 'string' || !/^[a-f0-9]{64}$/.test(p.textHash)) throw Error('REVIEW_ANCHOR');
    ids.add(a.id);
  }
}
export async function restoreReview(review, submission, markdown) {
  validateReview(review);
  if (review.submissionId !== submission.id || review.version !== submission.version) return { status: 'wrong-version', annotations: [] };
  if (markdown === null) return { status: 'missing', annotations: [] };
  if (await sha256(markdown) !== submission.contentHash || review.contentHash !== submission.contentHash) return { status: 'content-conflict', annotations: [] };
  const { text } = projectMarkdown(markdown);
  const hash = await sha256(text);
  if (review.annotations.some(({ anchor: a }) => a.textHash !== hash || !isUtf16Boundary(text, a.start) || !isUtf16Boundary(text, a.end) || text.slice(a.start, a.end) !== a.exact || text.slice(Math.max(0, a.start - 32), a.start) !== a.prefix || text.slice(a.end, a.end + 32) !== a.suffix)) return { status: 'anchor-conflict', annotations: [] };
  return { status: 'restored', annotations: review.annotations };
}

// In-memory lifecycle probe. Production must serialize these decisions with
// conversation writes and enforce reader scope before loading Drive content.
export class ReviewLedger {
  constructor() { this.draft = null; this.publications = []; this.messages = []; }
  saveDraft(review) {
    validateReview(review);
    if (review.kind !== 'draft') throw Error('DRAFT_REQUIRED');
    const previous = this.publications.at(-1);
    for (const message of this.messages) {
      const old = previous?.annotations.find((a) => a.id === message.annotationId);
      const next = review.annotations.find((a) => a.id === message.annotationId);
      if (old && JSON.stringify(old) !== JSON.stringify(next)) throw Error('REPLIED_COMMENT_IMMUTABLE');
    }
    const bound = this.draft ?? this.publications[0];
    if (bound && (review.submissionId !== bound.submissionId || review.version !== bound.version || review.contentHash !== bound.contentHash)) throw Error('LEDGER_SUBMISSION_IDENTITY');
    this.draft = structuredClone(review);
  }
  publish(id) {
    if (!this.draft || this.publications.some((r) => r.id === id)) throw Error('PUBLICATION_ID');
    this.saveDraft(this.draft); // recheck replies that arrived AFTER draft save
    const publication = { ...structuredClone(this.draft), id, kind: 'publication' };
    validateReview(publication);
    this.publications.push(publication);
    return structuredClone(publication);
  }
  read(role) {
    if (role === 'teacher') return structuredClone({ draft: this.draft, publications: this.publications });
    if (role === 'student') return structuredClone({ current: this.publications.at(-1) ?? null });
    throw Error('FORBIDDEN');
  }
  reply(annotationId, body) {
    if (!this.publications.at(-1)?.annotations.some((a) => a.id === annotationId)) throw Error('PUBLISHED_COMMENT_REQUIRED');
    this.messages.push({ id: `message-${this.messages.length + 1}`, annotationId, body });
  }
  mutateMessage() { throw Error('SENT_MESSAGE_IMMUTABLE'); }
}
