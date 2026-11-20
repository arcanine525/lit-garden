import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ReviewComment } from '../../shared/review';
import { DriveError } from '../drive/provider';

export function commentDigest(comment: ReviewComment) {
  const { body,id,kind } = comment;
  const fields = { body,id,kind };
  if (comment.kind === 'overall') return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  const { end,exact,prefix,projectionSha256,start,suffix } = comment.anchor;
  return createHash('sha256').update(JSON.stringify({ anchor:{ end,exact,prefix,projectionSha256,start,suffix },
    body,color:comment.color,id,kind })).digest('hex');
}

export async function assertPinnedComments(db: PoolClient, submission: string, publication: string | null, comments: ReviewComment[]) {
  const { rows } = await db.query<{ id: string; digest: string | null }>(`SELECT c.id,COALESCE(c.frozen_digest,p.comment_digest) AS digest
    FROM garden.review_comments c LEFT JOIN garden.publication_comments p ON p.comment_id=c.id AND p.publication_id=$2
    WHERE c.submission_id=$1 AND (c.frozen_digest IS NOT NULL OR c.pending_reply_operation IS NOT NULL)
    ORDER BY c.id FOR UPDATE OF c`,[submission,publication]);
  const proposed = new Map(comments.map(comment => [comment.id,commentDigest(comment)]));
  if (rows.some(row => row.digest === null || proposed.get(row.id) !== row.digest)) throw new DriveError('COMMENT_LOCKED',409);
}
