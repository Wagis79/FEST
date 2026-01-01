-- ============================================================================
-- FEST Algorithm Configuration Table
-- Skapad: 2024-12-27
-- Beskrivning: Lagrar konfigurerbara parametrar för optimeringsalgoritmen (V7)
-- ============================================================================

-- Skapa tabellen för algoritmkonfiguration
CREATE TABLE IF NOT EXISTS algorithm_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key VARCHAR(50) NOT NULL UNIQUE,
    value NUMERIC NOT NULL,
    unit VARCHAR(20),
    description TEXT,
    min_value NUMERIC,
    max_value NUMERIC,
    category VARCHAR(30) NOT NULL DEFAULT 'general',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kommentar på tabellen
COMMENT ON TABLE algorithm_config IS 'Konfigurerbara parametrar för FEST optimeringsalgoritm V7';

-- Kommentarer på kolumner
COMMENT ON COLUMN algorithm_config.key IS 'Unik nyckel för parametern';
COMMENT ON COLUMN algorithm_config.value IS 'Numeriskt värde för parametern';
COMMENT ON COLUMN algorithm_config.unit IS 'Enhet (%, kg, st, etc.)';
COMMENT ON COLUMN algorithm_config.description IS 'Beskrivning av vad parametern styr';
COMMENT ON COLUMN algorithm_config.min_value IS 'Minsta tillåtna värde';
COMMENT ON COLUMN algorithm_config.max_value IS 'Högsta tillåtna värde';
COMMENT ON COLUMN algorithm_config.category IS 'Kategori för gruppering i admin-UI';

-- Trigger för att uppdatera updated_at automatiskt
CREATE OR REPLACE FUNCTION update_algorithm_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS algorithm_config_updated_at ON algorithm_config;
CREATE TRIGGER algorithm_config_updated_at
    BEFORE UPDATE ON algorithm_config
    FOR EACH ROW
    EXECUTE FUNCTION update_algorithm_config_timestamp();

-- ============================================================================
-- RENSA LEGACY MOTORVAL (tas bort)
-- ============================================================================

DELETE FROM algorithm_config WHERE key IN ('USE_V5', 'USE_V6', 'USE_V7');

-- ============================================================================
-- TOLERANSER (Constraints)
-- ============================================================================
-- OBS: Dessa värden är MASTER för systemet. Koden i optimize-v7.ts har
-- fallback-defaults som bara används om databasen inte kan nås.

INSERT INTO algorithm_config (key, value, unit, description, min_value, max_value, category)
VALUES 
    ('N_TOLERANCE_KG', 1, 'kg/ha', 'Max överskott av kväve (N) över target. N måste vara mellan target och target + detta värde.', 0, 5, 'tolerances'),
    ('PKS_MIN_PCT', 90, '%', 'Minsta accepterade procent av P/K/S target. Om användaren kryssar i P/K/S måste leveransen vara minst detta värde av behovet.', 50, 100, 'tolerances'),
    ('PKS_MAX_PCT', 150, '%', 'Högsta accepterade procent av P/K/S target. Om användaren kryssar i P/K/S får leveransen inte överstiga detta värde av behovet.', 100, 200, 'tolerances'),
    ('HIGH_LEVEL_THRESHOLD', 151, '%', 'Varningströskel för ej ikryssade ämnen. Om P/K/S levereras över denna procent (utan att vara ikryssad) visas en varning.', 100, 300, 'tolerances')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    unit = EXCLUDED.unit,
    description = EXCLUDED.description,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    category = EXCLUDED.category,
    updated_at = NOW();

-- ============================================================================
-- DOSBEGRÄNSNINGAR
-- ============================================================================

INSERT INTO algorithm_config (key, value, unit, description, min_value, max_value, category)
VALUES 
    ('DEFAULT_MIN_DOSE', 75, 'kg/ha', 'Standard minsta dos per produkt. Produkter under denna dos exkluderas från lösningen.', 0, 200, 'doses'),
    ('DEFAULT_MAX_DOSE', 600, 'kg/ha', 'Standard högsta dos per produkt. Produkter över denna dos begränsas till detta värde.', 300, 1000, 'doses')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    unit = EXCLUDED.unit,
    description = EXCLUDED.description,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    category = EXCLUDED.category,
    updated_at = NOW();

-- ============================================================================
-- SYSTEMBEGRÄNSNINGAR
-- ============================================================================

INSERT INTO algorithm_config (key, value, unit, description, min_value, max_value, category)
VALUES 
    ('MAX_PRODUCTS_HARD', 5, 'st', 'Absolut max antal produkter i en gödselmix. Systemet ökar automatiskt från användarens val upp till detta tak om ingen lösning hittas.', 2, 10, 'system'),
    ('NUM_STRATEGIES', 3, 'st', 'Antal prispallar/strategier att returnera. Användaren ser detta antal alternativa lösningar sorterade efter kostnad.', 1, 10, 'system')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    unit = EXCLUDED.unit,
    description = EXCLUDED.description,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    category = EXCLUDED.category,
    updated_at = NOW();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Aktivera RLS
ALTER TABLE algorithm_config ENABLE ROW LEVEL SECURITY;

-- Ta bort gamla policies om de finns
DROP POLICY IF EXISTS "Allow public read access" ON algorithm_config;
DROP POLICY IF EXISTS "Allow public update access" ON algorithm_config;
DROP POLICY IF EXISTS "Allow public insert access" ON algorithm_config;
DROP POLICY IF EXISTS "Allow service role full access" ON algorithm_config;

-- Policy: Service role har full åtkomst (för backend-API)
-- Service role används av servern och kringgår RLS automatiskt,
-- men vi skapar ändå en explicit policy för tydlighet
CREATE POLICY "Allow service role full access" ON algorithm_config
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Policy: Autentiserade användare kan läsa (för admin-frontend)
CREATE POLICY "Allow authenticated read access" ON algorithm_config
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Policy: Autentiserade användare kan uppdatera (för admin-frontend)
CREATE POLICY "Allow authenticated update access" ON algorithm_config
    FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- OBS: Anon-användare har INGEN åtkomst till denna tabell.
-- Alla anrop måste gå via backend-API:et som använder service_role.

-- ============================================================================
-- INDEX för snabbare uppslag
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_algorithm_config_key ON algorithm_config(key);
CREATE INDEX IF NOT EXISTS idx_algorithm_config_category ON algorithm_config(category);

-- ============================================================================
-- VIEW för enklare åtkomst
-- ============================================================================

CREATE OR REPLACE VIEW algorithm_config_view AS
SELECT 
    key,
    value,
    unit,
    description,
    min_value,
    max_value,
    category,
    updated_at
FROM algorithm_config
ORDER BY 
    CASE category 
        WHEN 'tolerances' THEN 1
        WHEN 'doses' THEN 2
        WHEN 'system' THEN 3
        ELSE 4
    END,
    key;

-- ============================================================================
-- Verifiera att allt skapades korrekt
-- ============================================================================

SELECT 
    key, 
    value, 
    unit, 
    category,
    description
FROM algorithm_config 
ORDER BY category, key;
