-- Allow anonymous users (players) to suggest translations
-- Note: We use 'anon' role or authenticated check depending on how users access the app.
-- For a public game assistant, we typically allow 'anon' to insert.

CREATE POLICY "Allow anonymous users to insert translations" 
ON translations 
FOR INSERT 
WITH CHECK (true);

-- Optional: Allow anonymous users to update existing translations (use with caution)
-- In a real scenario, you might want a moderation system instead of direct updates.
-- CREATE POLICY "Allow anonymous users to update translations" 
-- ON translations 
-- FOR UPDATE 
-- USING (true);
