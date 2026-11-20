import { createHash } from 'node:crypto';
import { prepareEditorMarkdown, projectMarkdown, sha256, walk } from './markdown.js';
import { readReview, restoreReview, schema as proposalSchema } from './review.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const limits = { 'garden.submission/1': 410_000, 'garden.rubric-snapshot/1': 250_000, 'garden.review-publication/1': 1_500_000 };
const shaBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const conflict = (code) => Object.assign(Error(code), { status: 409 });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function encodeEnvelope(garden, markdown = '') {
  const bytes = Buffer.from(`---\ngarden: ${JSON.stringify(canonical(garden))}\n---\n${markdown}`, 'utf8');
  if (!limits[garden.schema] || bytes.length > limits[garden.schema]) throw Error('ENVELOPE_SIZE');
  return bytes;
}

export function decodeEnvelope(bytes, schema) {
  if (!limits[schema] || bytes.length > limits[schema]) throw Error('ENVELOPE_SIZE');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const match = /^---\ngarden: ([^\n]+)\n---\n/.exec(source);
  if (!match) throw Error('ENVELOPE_FORMAT');
  const garden = JSON.parse(match[1]);
  const markdown = source.slice(match[0].length);
  if (garden?.schema !== schema || !encodeEnvelope(garden, markdown).equals(Buffer.from(bytes))) throw Error('ENVELOPE_FORMAT');
  return { garden, markdown };
}

// Fixture setup only. Production resolves this context from authorized DB metadata
// and reads the pinned Drive files by ID before calling the adapter.
export function createReviewFixture(markdown, ids) {
  const body = prepareEditorMarkdown(markdown, 'teacher');
  walk(projectMarkdown(body).tree, (node) => {
    if (node.type === 'image' && !uuid.test(node.url.split('/').at(-1))) throw Error('PRIVATE_ASSET_UUID_REQUIRED');
  });
  const submission = encodeEnvelope({
    schema: 'garden.submission/1', id: ids.submission, assignmentId: ids.assignment,
    recipientId: ids.recipient, acceptedAt: '2026-11-20T03:00:00Z', explanation: 'Em làm rõ ý kết.'
  }, body);
  const rubric = encodeEnvelope({
    schema: 'garden.rubric-snapshot/1', id: ids.rubric, max: '2.00', scale: '2.00',
    criteria: [{ id: 'images', label: 'Hình ảnh', max: '2.00', levels: [
      { id: 'developing', score: '1.00', description: 'Đang phát triển' },
      { id: 'complete', score: '2.00', description: 'Đạt' }
    ] }]
  });
  return {
    submission, rubric, metadata: {
      submissionId: ids.submission, version: 2, rubricId: ids.rubric,
      submissionSha256: shaBytes(submission), rubricSha256: shaBytes(rubric)
    }
  };
}

function readContext({ submission, rubric, metadata }) {
  if (shaBytes(submission) !== metadata.submissionSha256) throw conflict('SUBMISSION_HASH_MISMATCH');
  if (shaBytes(rubric) !== metadata.rubricSha256) throw conflict('RUBRIC_HASH_MISMATCH');
  const original = decodeEnvelope(submission, 'garden.submission/1');
  const snapshot = decodeEnvelope(rubric, 'garden.rubric-snapshot/1').garden;
  if (original.garden.id !== metadata.submissionId || snapshot.id !== metadata.rubricId) throw conflict('CONTEXT_ID_MISMATCH');
  return { metadata, snapshot, markdown: original.markdown };
}

function scoreLevels(scores, criteria) {
  if (!Array.isArray(scores) || scores.length !== criteria.length) throw Error('RUBRIC_SCORES');
  return criteria.map((criterion) => {
    const matching = scores.filter((score) => score.criterionId === criterion.id);
    if (matching.length !== 1) throw Error('RUBRIC_SCORES');
    const score = matching[0];
    const level = criterion.levels.find((candidate) =>
      typeof score.value === 'number'
        ? Number(candidate.score) === score.value && score.max === Number(criterion.max)
        : candidate.id === score.levelId && candidate.score === score.value
    );
    if (!level) throw Error('RUBRIC_SCORES');
    return { criterionId: criterion.id, levelId: level.id, value: level.score };
  });
}

function verifyIds(ids) {
  if (ids.some((id) => !uuid.test(id)) || new Set(ids).size !== ids.length) throw Error('PUBLICATION_IDS');
}

async function checkedProposal(proposal, context) {
  const { markdown, metadata } = context;
  const result = await restoreReview(proposal, {
    id: metadata.submissionId, version: metadata.version, contentHash: await sha256(markdown)
  }, markdown);
  if (result.status !== 'restored') throw conflict(result.status);
}

export async function publishReview(proposalMarkdown, files, { publicationId, overallId }) {
  const context = readContext(files);
  const { metadata, snapshot } = context;
  const proposal = readReview(proposalMarkdown);
  if (proposal.kind !== 'publication') throw Error('PUBLICATION_REQUIRED');
  await checkedProposal(proposal, context);
  const comments = proposal.annotations.map(({ id, color, comment, anchor }) => ({
    id, kind: 'range', color, body: comment,
    anchor: { start: anchor.start, end: anchor.end, exact: anchor.exact,
      prefix: anchor.prefix, suffix: anchor.suffix, projectionSha256: anchor.textHash }
  }));
  if (proposal.overall) comments.push({ id: overallId, kind: 'overall', body: proposal.overall });
  verifyIds([publicationId, ...comments.map(({ id }) => id)]);
  return encodeEnvelope({
    schema: 'garden.review-publication/1', id: publicationId, ...metadata,
    textProjection: 'vv-render-text-v1', scores: scoreLevels(proposal.scores, snapshot.criteria),
    comments, overallCommentId: proposal.overall ? overallId : null
  });
}

export async function openPublication(bytes, files) {
  const context = readContext(files);
  const { metadata, markdown, snapshot } = context;
  const { garden, markdown: projectionBody } = decodeEnvelope(bytes, 'garden.review-publication/1');
  if (projectionBody || garden.textProjection !== 'vv-render-text-v1' ||
      Object.entries(metadata).some(([key, value]) => garden[key] !== value)) throw conflict('PUBLICATION_CONTEXT');
  const overall = garden.comments.filter(({ kind }) => kind === 'overall');
  if (overall.length !== (garden.overallCommentId === null ? 0 : 1) ||
      overall.some(({ id, body }) => id !== garden.overallCommentId || typeof body !== 'string')) throw Error('PUBLICATION_OVERALL');
  verifyIds([garden.id, ...garden.comments.map(({ id }) => id)]);
  const proposal = {
    schema: proposalSchema, id: garden.id, kind: 'publication',
    submissionId: garden.submissionId, version: garden.version, contentHash: await sha256(markdown),
    scores: scoreLevels(garden.scores, snapshot.criteria).map(({ criterionId, value }, i) => ({
      criterionId, value: Number(value), max: Number(snapshot.criteria[i].max)
    })),
    overall: overall[0]?.body ?? '',
    annotations: garden.comments.filter(({ kind }) => kind !== 'overall').map(({ id, color, body, anchor, kind }) => {
      if (kind !== 'range') throw Error('PUBLICATION_COMMENT_KIND');
      return { id, color, comment: body, anchor: {
        projection: garden.textProjection, start: anchor.start, end: anchor.end,
        exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix, textHash: anchor.projectionSha256
      } };
    })
  };
  await checkedProposal(proposal, context);
  return { garden, markdown, review: proposal };
}

export async function fixtureDetails(files) {
  const { metadata, markdown } = readContext(files);
  return { ...metadata, markdown, contentHash: await sha256(markdown) };
}

export function changeSubmissionMetadata(files) {
  const { garden, markdown } = decodeEnvelope(files.submission, 'garden.submission/1');
  return encodeEnvelope({ ...garden, explanation: 'Giải thích bị sửa bên ngoài.' }, markdown);
}
