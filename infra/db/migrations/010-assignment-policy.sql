CREATE FUNCTION garden.can_review_submission(actor uuid, submission uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
  SELECT EXISTS (
    SELECT 1 FROM submissions s JOIN recipients r ON r.id=s.recipient_id
      JOIN classes c ON c.id=r.class_id JOIN users teacher ON teacher.id=s.teacher_id
      JOIN drive_connections d ON d.teacher_id=s.teacher_id
    WHERE s.id=submission AND teacher.id=actor AND teacher.status='active' AND teacher.role='teacher'
      AND c.state='active' AND d.state='ready'
  )
$$;

CREATE FUNCTION garden.can_reply_submission(actor uuid, submission uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
  SELECT EXISTS (
    SELECT 1 FROM submissions s JOIN recipients r ON r.id=s.recipient_id
      JOIN classes c ON c.id=r.class_id JOIN users teacher ON teacher.id=s.teacher_id
      JOIN memberships m ON m.class_id=r.class_id AND m.student_id=r.student_id
      JOIN users participant ON participant.id=actor JOIN drive_connections d ON d.teacher_id=s.teacher_id
    WHERE s.id=submission AND s.current_publication_id IS NOT NULL AND c.state='active'
      AND teacher.status='active' AND d.state='ready' AND participant.status='active'
      AND ((participant.role='teacher' AND participant.id=s.teacher_id) OR
           (participant.role='student' AND participant.id=r.student_id AND m.state='active'))
  )
$$;
