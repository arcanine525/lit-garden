-- The foreign keys validate existing rows during upgrades. Inconsistent data
-- rolls back this migration rather than reassigning or deleting any rows.
ALTER TABLE garden.notifications
  ADD CONSTRAINT notifications_operation_owner
  FOREIGN KEY (event_operation_id, teacher_id) REFERENCES garden.operations(id, teacher_id);

ALTER TABLE garden.library_delete_files ADD COLUMN teacher_id uuid;
UPDATE garden.library_delete_files AS file
SET teacher_id = operation.teacher_id
FROM garden.operations AS operation
WHERE file.operation_id = operation.id;
ALTER TABLE garden.library_delete_files
  ALTER COLUMN teacher_id SET NOT NULL,
  ADD CONSTRAINT deletion_operation_owner
    FOREIGN KEY (operation_id, teacher_id) REFERENCES garden.operations(id, teacher_id),
  ADD CONSTRAINT deletion_object_owner
    FOREIGN KEY (object_id, teacher_id) REFERENCES garden.drive_objects(id, teacher_id);
