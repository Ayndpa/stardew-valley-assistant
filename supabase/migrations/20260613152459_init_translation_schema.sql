-- Create categories for translations (e.g., 'Crops', 'NPCs', 'Items')
CREATE TABLE translation_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create supported languages
CREATE TABLE languages (
    code TEXT PRIMARY KEY, -- e.g., 'en', 'zh-CN'
    name TEXT NOT NULL,    -- e.g., 'English', 'Chinese (Simplified)'
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create translation keys
CREATE TABLE translation_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES translation_categories(id) ON DELETE CASCADE,
    key_path TEXT NOT NULL, -- e.g., 'parsnip.description'
    description TEXT,       -- Context for translators
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(category_id, key_path)
);

-- Create actual translations
CREATE TABLE translations (
    key_id UUID REFERENCES translation_keys(id) ON DELETE CASCADE,
    language_code TEXT REFERENCES languages(code) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (key_id, language_code)
);

-- Enable Row Level Security (RLS)
ALTER TABLE translation_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

-- Create basic policies (Allow anyone to read, but only authenticated can write - adjust as needed)
CREATE POLICY "Allow public read-only access" ON translation_categories FOR SELECT USING (true);
CREATE POLICY "Allow public read-only access" ON languages FOR SELECT USING (true);
CREATE POLICY "Allow public read-only access" ON translation_keys FOR SELECT USING (true);
CREATE POLICY "Allow public read-only access" ON translations FOR SELECT USING (true);

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_translations_updated_at
BEFORE UPDATE ON translations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Seed some initial data
INSERT INTO languages (code, name, is_default) VALUES
('en', 'English', TRUE),
('zh-CN', 'Chinese (Simplified)', FALSE);

INSERT INTO translation_categories (name) VALUES
('Crops'),
('NPCs'),
('Items'),
('System');
