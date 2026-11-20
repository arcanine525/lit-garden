ALTER TABLE garden.drive_folders DROP CONSTRAINT drive_folders_kind_check;
ALTER TABLE garden.drive_folders ADD CHECK (kind IN ('class','assignment','student','assets','library','library_item'));

CREATE TABLE garden.library_assets (
  item_id uuid NOT NULL,
  asset_id uuid NOT NULL UNIQUE,
  teacher_id uuid NOT NULL,
  visible boolean NOT NULL DEFAULT false,
  PRIMARY KEY (item_id,asset_id),
  FOREIGN KEY (item_id,teacher_id) REFERENCES garden.library_items(id,teacher_id),
  FOREIGN KEY (asset_id,teacher_id) REFERENCES garden.drive_objects(id,teacher_id)
);

ALTER TABLE garden.asset_view_leases DROP CONSTRAINT asset_view_leases_asset_id_fkey;
ALTER TABLE garden.asset_view_leases ADD FOREIGN KEY (asset_id) REFERENCES garden.drive_objects(id) ON DELETE CASCADE;
