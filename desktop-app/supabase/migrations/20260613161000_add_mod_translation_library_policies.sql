-- The player client needs to create missing mod translation keys before it can
-- submit the translation rows themselves.
CREATE POLICY "Allow anonymous users to insert translation categories"
ON translation_categories
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow anonymous users to insert translation keys"
ON translation_keys
FOR INSERT
WITH CHECK (true);

INSERT INTO translation_categories (name)
VALUES ('Mods')
ON CONFLICT (name) DO NOTHING;
