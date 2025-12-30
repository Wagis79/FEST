-- =============================================================================
-- FEST: Lägg till 'active' kolumn för produkter
-- =============================================================================
-- Kör detta i Supabase SQL Editor (Dashboard > SQL Editor)
-- =============================================================================

-- 1. Lägg till 'active' kolumn med default true
ALTER TABLE "Produkter" 
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- 2. Sätt alla befintliga produkter som aktiva
UPDATE "Produkter" SET active = true WHERE active IS NULL;

-- 3. Skapa index för snabbare filtrering
CREATE INDEX IF NOT EXISTS idx_produkter_active ON "Produkter"(active);

-- 4. Verifiera
SELECT 
  COUNT(*) as total, 
  COUNT(*) FILTER (WHERE active = true) as active_count,
  COUNT(*) FILTER (WHERE active = false) as inactive_count
FROM "Produkter";
