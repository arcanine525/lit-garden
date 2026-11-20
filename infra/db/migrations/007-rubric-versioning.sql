DROP TRIGGER rubric_immutable ON garden.rubric_templates;
CREATE TRIGGER rubric_immutable BEFORE UPDATE OF id, revision, label, definition, created_by, created_at
  ON garden.rubric_templates FOR EACH ROW EXECUTE FUNCTION garden.immutable_record();

CREATE FUNCTION garden.guard_rubric_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retired AND NOT NEW.retired THEN
    RAISE EXCEPTION 'retired rubric revision cannot be reactivated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rubric_retirement BEFORE UPDATE OF retired ON garden.rubric_templates
  FOR EACH ROW EXECUTE FUNCTION garden.guard_rubric_retirement();
