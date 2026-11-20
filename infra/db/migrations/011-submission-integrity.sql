CREATE OR REPLACE FUNCTION garden.can_review_submission(actor uuid, submission uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, garden AS $$
  SELECT EXISTS (
    SELECT 1 FROM submissions s JOIN recipients r ON r.id=s.recipient_id
      JOIN classes c ON c.id=r.class_id JOIN users teacher ON teacher.id=s.teacher_id
      JOIN drive_connections d ON d.teacher_id=s.teacher_id
      JOIN drive_objects source ON source.id=s.object_id AND source.teacher_id=s.teacher_id
    WHERE s.id=submission AND teacher.id=actor AND teacher.status='active' AND teacher.role='teacher'
      AND c.state='active' AND d.state='ready' AND source.integrity='ok' AND source.lifecycle='referenced'
  )
$$;
