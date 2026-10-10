ALTER TABLE file_storage ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;
