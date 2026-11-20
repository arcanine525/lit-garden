-- The CSV roster resolves class names within one teacher and school year.
ALTER TABLE garden.classes ADD CONSTRAINT class_name_per_year UNIQUE (teacher_id,name,school_year);
