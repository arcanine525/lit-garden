import { database } from './db';

type EventKind = 'assigned' | 'deadline_extended' | 'returned' | 'reply';
type EventRow = {
  id: string; event_kind: EventKind; created_at: Date; read_at: Date | null;
  assignment_id: string | null; submission_id: string | null; publication_id: string | null; comment_id: string | null;
  class_name: string | null; teacher_name: string | null;
};

async function notificationRows(user: string, id?: string) {
  const { rows } = await database().query<EventRow>(`
    SELECT n.id,n.event_kind,n.created_at,n.read_at,a.id AS assignment_id,
      coalesce(returned.submission_id,thread.submission_id) AS submission_id,
      coalesce(returned.id,thread.publication_id) AS publication_id,thread.comment_id,
      c.name AS class_name,teacher.display_name AS teacher_name
    FROM garden.notifications n
    JOIN garden.users account ON account.id=n.user_id AND account.status='active' AND account.role IN ('student','teacher')
    LEFT JOIN garden.assignments a ON n.event_kind IN ('assigned','deadline_extended') AND n.target_kind='assignment'
      AND a.id=n.target_id AND a.teacher_id=n.teacher_id AND garden.can_read_assignment(n.user_id,a.id)
    LEFT JOIN LATERAL (
      SELECT p.id,p.submission_id,r.class_id FROM garden.review_publications p
      JOIN garden.submissions s ON s.id=p.submission_id AND s.current_publication_id=p.id
      JOIN garden.recipients r ON r.id=s.recipient_id
      WHERE n.event_kind='returned' AND n.target_kind='submission'
        AND p.operation_id=n.event_operation_id AND p.submission_id=n.target_id AND p.teacher_id=n.teacher_id
        AND garden.readable_review_object(n.user_id,s.id,p.id) IS NOT NULL
    ) returned ON true
    LEFT JOIN LATERAL (
      SELECT m.comment_id,s.id AS submission_id,p.publication_id,r.class_id FROM garden.conversation_messages m
      JOIN garden.submissions s ON s.id=m.submission_id
      JOIN garden.recipients r ON r.id=s.recipient_id
      JOIN garden.publication_comments p ON p.submission_id=m.submission_id
        AND p.comment_id=m.comment_id AND p.publication_id=s.current_publication_id
      WHERE n.event_kind='reply' AND n.target_kind='comment' AND m.comment_id=n.target_id
        AND m.operation_id=n.event_operation_id AND m.teacher_id=n.teacher_id
        AND garden.readable_review_object(n.user_id,s.id,p.publication_id) IS NOT NULL
    ) thread ON true
    LEFT JOIN garden.classes c ON c.id=coalesce(a.class_id,returned.class_id,thread.class_id) AND c.teacher_id=n.teacher_id
    LEFT JOIN garden.users teacher ON teacher.id=c.teacher_id
    WHERE n.user_id=$1 AND ($2::uuid IS NULL OR n.id=$2)
    ORDER BY n.created_at DESC,n.id DESC`,[user,id ?? null]);
  return rows;
}

function destination(row: EventRow) {
  if (row.assignment_id) return `/assignments/${row.assignment_id}`;
  if (!row.submission_id || !row.publication_id) return null;
  const result = `/results/${row.submission_id}?publication=${row.publication_id}`;
  return row.comment_id ? result + '#comment-' + row.comment_id : result;
}

export async function listNotifications(user: string) {
  return (await notificationRows(user)).map(row => ({
    id:row.id,kind:row.event_kind,createdAt:row.created_at.toISOString(),readAt:row.read_at?.toISOString() ?? null,
    available:Boolean(destination(row)),className:row.class_name,teacherName:row.teacher_name
  }));
}

export async function notificationDestination(user: string, id: string) {
  const [row] = await notificationRows(user,id);
  return row ? { path:destination(row) } : undefined;
}

export async function markNotificationRead(user: string, sessionDigest: string, id: string) {
  const { rows:[entry] } = await database().query<{ read_at: Date }>(`
    UPDATE garden.notifications n SET read_at=coalesce(n.read_at,now())
    FROM garden.app_sessions s JOIN garden.users u ON u.id=s.user_id
    WHERE n.id=$1 AND n.user_id=$2 AND s.user_id=n.user_id AND s.handle_digest=$3
      AND s.auth_epoch=u.auth_epoch AND s.expires_at>now() AND u.status='active' AND u.role IN ('student','teacher')
    RETURNING n.read_at`,[id,user,sessionDigest]);
  return entry?.read_at.toISOString() ?? null;
}
