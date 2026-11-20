ALTER TABLE garden.audit_events ADD COLUMN class_id uuid REFERENCES garden.classes;
