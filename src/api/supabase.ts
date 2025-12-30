import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import type { NutrientNeed } from '../models/NutrientNeed';
import type { Strategy } from '../engine/scoring';
import type { Crop, CropUnit } from '../data/crops';

// Load environment variables
dotenv.config();

// Validate environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase credentials. Please check your .env file contains SUPABASE_URL and SUPABASE_KEY'
  );
}

// Create Supabase client for READ operations (uses anon key with RLS)
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// Create Supabase admin client for WRITE operations (uses service role key, bypasses RLS)
// Falls back to regular client if service key not available
export const supabaseAdmin: SupabaseClient = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : supabase;

// Log which client is being used for admin
if (supabaseServiceKey) {
  console.log('✅ Admin client configured with service role key');
} else {
  console.warn('⚠️  No SUPABASE_SERVICE_KEY found - admin writes may fail due to RLS');
}

// Database table name - matching the Swedish table name in Supabase
export const PRODUCTS_TABLE = 'Produkter';
export const CROPS_TABLE = 'crops';

// Type for database product (matching Supabase table with Swedish column names)
export interface DBProduct {
  idx?: number;
  Artikelnr: number;
  Produkt: string;
  N: string;
  P: string;
  K: string;
  S: string;
  Ca?: string;
  Mg?: string;
  B?: string;
  Cu?: string;
  Mn?: string;
  Zn?: string;
  Övrigt?: string;
  Enhet?: string;
  PallAntal?: string;
  Produktklass?: string;
  Optimeringsbar?: string;
  Analysstatus?: string;
  Pris: string;
  active?: boolean;  // Om produkten är aktiv/disponibel (från M3)
}

// Helper to parse nutrient value (handles "-" as 0)
function parseNutrient(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper to transform DB product to app Product (for recommendation engine)
export function dbProductToProduct(dbProduct: DBProduct): any {
  const nutrients = {
    N: parseNutrient(dbProduct.N),
    P: parseNutrient(dbProduct.P),
    K: parseNutrient(dbProduct.K),
    S: parseNutrient(dbProduct.S),
  };
  
  return {
    id: `prod-${dbProduct.Artikelnr}`,
    name: dbProduct.Produkt,
    pricePerKg: parseFloat(dbProduct.Pris.replace(',', '.')),
    nutrients,
    description: `${dbProduct.Produktklass || 'Mineral'} - ${dbProduct.Övrigt || ''}`.trim(),
  };
}

// Helper to transform DB product to full admin format
export function dbProductToAdminProduct(dbProduct: DBProduct): any {
  return {
    id: `prod-${dbProduct.Artikelnr}`,
    name: dbProduct.Produkt,
    pricePerKg: parseFloat(dbProduct.Pris.replace(',', '.')),
    N: parseNutrient(dbProduct.N),
    P: parseNutrient(dbProduct.P),
    K: parseNutrient(dbProduct.K),
    S: parseNutrient(dbProduct.S),
    Ca: parseNutrient(dbProduct.Ca),
    Mg: parseNutrient(dbProduct.Mg),
    B: parseNutrient(dbProduct.B),
    Cu: parseNutrient(dbProduct.Cu),
    Mn: parseNutrient(dbProduct.Mn),
    Zn: parseNutrient(dbProduct.Zn),
    manufacturer: '',
    productType: dbProduct.Produktklass || 'mineral',
    notes: dbProduct.Övrigt || '',
    unit: dbProduct.Enhet || 'KG',
    optimizable: dbProduct.Optimeringsbar === 'Ja',
    active: dbProduct.active !== false,  // Default till true om null/undefined
  };
}

// Helper to transform app Product to DB product
export function productToDBProduct(product: any): Partial<DBProduct> {
  const formatNutrient = (val: number) => val === 0 ? '-' : val.toString();
  
  return {
    Artikelnr: parseInt(product.id.replace('prod-', '')),
    Produkt: product.name,
    N: formatNutrient(product.N || 0),
    P: formatNutrient(product.P || 0),
    K: formatNutrient(product.K || 0),
    S: formatNutrient(product.S || 0),
    Ca: formatNutrient(product.Ca || 0),
    Mg: formatNutrient(product.Mg || 0),
    B: formatNutrient(product.B || 0),
    Cu: formatNutrient(product.Cu || 0),
    Mn: formatNutrient(product.Mn || 0),
    Zn: formatNutrient(product.Zn || 0),
    Övrigt: product.notes || '-',
    Enhet: product.unit || 'KG',
    Produktklass: product.productType || 'mineral',
    Optimeringsbar: product.optimizable ? 'Ja' : 'Nej',
    Pris: product.pricePerKg.toString().replace('.', ','),
    active: product.active !== false,  // Default till true
  };
}

/**
 * Fetch all products from Supabase and transform to recommendation engine format
 * Prioriterar produkter med högre näringsinnehåll för bättre optimering
 * Filtrerar bort inaktiva produkter (active = false)
 */
export async function getAllProductsForRecommendation(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from(PRODUCTS_TABLE)
      .select('*')
      .eq('Optimeringsbar', 'Ja') // Only fetch products that can be optimized
      .neq('active', false) // Exclude inactive products (allows null = active for backwards compat)
      .order('Pris', { ascending: true }) // Sortera på pris för ekonomiska val
  .limit(500); // Hämta fler för behovsstyrt urval

    if (error) {
      console.error('Error fetching products from Supabase:', error);
      return [];
    }

    if (!data) {
      return [];
    }

    // Transform to Product format for recommendation engine
    const allProducts = data.map(dbProductToProduct);
    
    console.log(`📦 Hämtade ${allProducts.length} produkter från databasen (Optimeringsbar=Ja)`);
    
    // Returnera alla produkter där Optimeringsbar=Ja (redan filtrerat i query)
    // Ingen ytterligare filtrering på NPKS behövs - kolumnen Optimeringsbar styr
    return allProducts;
  } catch (error) {
    console.error('Exception fetching products:', error);
    return [];
  }
}

type NutrientKey = 'N' | 'P' | 'K' | 'S';

function pickNeededKeys(need: NutrientNeed): NutrientKey[] {
  const keys: NutrientKey[] = [];
  if ((need.N || 0) > 0) keys.push('N');
  if ((need.P || 0) > 0) keys.push('P');
  if ((need.K || 0) > 0) keys.push('K');
  if ((need.S || 0) > 0) keys.push('S');
  return keys;
}

/**
 * Behovsstyrt urval av produkter för rekommendationsmotorn.
 *
 * Mål:
 * - Behåll tillräckligt många kandidater för bra träffbild
 * - Men begränsa så att kombinationssökning inte exploderar
 */
export async function getProductsForRecommendation(
  need: NutrientNeed,
  strategy: Strategy,
  opts: { maxCandidates?: number } = {}
): Promise<any[]> {
  const maxCandidates = opts.maxCandidates ?? (strategy === 'optimized' ? 80 : 60);

  const all = await getAllProductsForRecommendation();
  const needed = pickNeededKeys(need);

  // Om inget behov angivet av någon anledning, returnera en rimlig mängd
  if (needed.length === 0) {
    return all.slice(0, maxCandidates);
  }

  // Score: "näringsmängd per krona" för de näringsämnen man faktiskt behöver.
  // Detta är en enkel men effektiv preselection för att få bra träffbild.
  function productScore(p: any): number {
    const pricePerKg = Number(p.pricePerKg) || 0;
    const safePrice = pricePerKg > 0 ? pricePerKg : 0.000001;

    // kg nutrient per kr: (kg nutrient per kg product) / (kr per kg)
    // nutrients[] ligger i procent, så pct/100 är kg/kg.
    let score = 0;
    for (const k of needed) {
      const pct = Number(p.nutrients?.[k]) || 0;
      score += (pct / 100) / safePrice;
    }

    // Mild bonus för produkter som täcker flera av de behövda ämnena
    const coverage = needed.reduce((acc, k) => acc + ((Number(p.nutrients?.[k]) || 0) > 0 ? 1 : 0), 0);
    score *= 1 + coverage * 0.05;

    return score;
  }

  const sorted = [...all].sort((a, b) => productScore(b) - productScore(a));

  // Diversifiering: se till att vi har med "starka" produkter per ämne också
  // (t.ex. K- eller S-rika) för att undvika att ett ämne får för få kandidater.
  const byNutrientTop: any[] = [];
  for (const k of needed) {
    const topForK = [...all]
      .filter((p) => (Number(p.nutrients?.[k]) || 0) > 0)
      .sort((a, b) => (Number(b.nutrients?.[k]) || 0) - (Number(a.nutrients?.[k]) || 0))
      .slice(0, 15);
    byNutrientTop.push(...topForK);
  }

  // Combine + dedupe by id
  const picked: any[] = [];
  const seen = new Set<string>();
  for (const p of [...byNutrientTop, ...sorted]) {
    if (!p?.id) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    picked.push(p);
    if (picked.length >= maxCandidates) break;
  }

  console.log(`🎯 Behovsstyrt urval: ${picked.length} kandidater (strategy=${strategy})`);
  return picked;
}

// =============================================================================
// CROPS - Grödor från Supabase
// =============================================================================

// Type for database crop (matching Supabase crops table)
export interface DBCrop {
  id: string;
  name: string;
  category: string;
  unit: string;
  n_per_ton: number;
  p_per_ton: number;
  k_per_ton: number;
  s_per_ton: number | null;
  yield_min: number;
  yield_max: number;
  yield_average: number;
  precrop_n_effect: number;
  precrop_yield_effect: number;
  description: string | null;
  source_provider: string | null;
  source_note: string | null;
  source_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// Transform DB crop to app Crop format
export function dbCropToCrop(dbCrop: DBCrop): Crop {
  return {
    id: dbCrop.id,
    name: dbCrop.name,
    category: dbCrop.category as Crop['category'],
    unit: dbCrop.unit as CropUnit,
    nutrientPerTon: {
      N: dbCrop.n_per_ton,
      P: dbCrop.p_per_ton,
      K: dbCrop.k_per_ton,
      S: dbCrop.s_per_ton ?? undefined,
    },
    typicalYield: {
      min: dbCrop.yield_min,
      max: dbCrop.yield_max,
      average: dbCrop.yield_average,
    },
    precropEffect: {
      nEffect: dbCrop.precrop_n_effect,
      yieldEffect: dbCrop.precrop_yield_effect,
    },
    description: dbCrop.description ?? undefined,
    source: {
      provider: (dbCrop.source_provider as Crop['source']['provider']) ?? 'Jordbruksverket',
      note: dbCrop.source_note ?? '',
      url: dbCrop.source_url ?? undefined,
    },
  };
}

// Cache för crops (uppdateras var 5:e minut)
let cropsCache: Crop[] | null = null;
let cropsCacheTime = 0;
const CROPS_CACHE_TTL = 5 * 60 * 1000; // 5 minuter

/**
 * Hämta alla grödor från Supabase
 */
export async function getAllCrops(): Promise<Crop[]> {
  const now = Date.now();
  
  // Returnera cache om den är färsk
  if (cropsCache && now - cropsCacheTime < CROPS_CACHE_TTL) {
    return cropsCache;
  }

  try {
    const { data, error } = await supabase
      .from(CROPS_TABLE)
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching crops from Supabase:', error);
      return cropsCache ?? []; // Returnera gammal cache om möjligt
    }

    if (!data) {
      return [];
    }

    cropsCache = data.map(dbCropToCrop);
    cropsCacheTime = now;
    
    console.log(`🌾 Hämtade ${cropsCache.length} grödor från databasen`);
    return cropsCache;
  } catch (error) {
    console.error('Exception fetching crops:', error);
    return cropsCache ?? [];
  }
}

/**
 * Hämta en specifik gröda via ID
 */
export async function getCropById(cropId: string): Promise<Crop | null> {
  const crops = await getAllCrops();
  return crops.find(c => c.id === cropId) ?? null;
}

/**
 * Hämta grödor per kategori
 */
export async function getCropsByCategory(category: Crop['category']): Promise<Crop[]> {
  const crops = await getAllCrops();
  return crops.filter(c => c.category === category);
}

/**
 * Invalidera crops-cachen (t.ex. efter uppdatering)
 */
export function invalidateCropsCache(): void {
  cropsCache = null;
  cropsCacheTime = 0;
}

/**
 * Hämta alla grödor i raw DB-format (för admin)
 */
export async function getAllCropsRaw(): Promise<DBCrop[]> {
  try {
    const { data, error } = await supabase
      .from(CROPS_TABLE)
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching crops from Supabase:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Exception fetching crops:', error);
    throw error;
  }
}

/**
 * Skapa en ny gröda (uses admin client to bypass RLS)
 */
export async function createCrop(cropData: Partial<DBCrop>): Promise<DBCrop> {
  try {
    const { data, error } = await supabaseAdmin
      .from(CROPS_TABLE)
      .insert([cropData])
      .select()
      .single();

    if (error) {
      console.error('Error creating crop:', error);
      throw error;
    }

    // Invalidera cache
    invalidateCropsCache();
    
    console.log(`🌾 Skapade gröda: ${cropData.name}`);
    return data;
  } catch (error) {
    console.error('Exception creating crop:', error);
    throw error;
  }
}

/**
 * Uppdatera en gröda (uses admin client to bypass RLS)
 */
export async function updateCrop(cropId: string, cropData: Partial<DBCrop>): Promise<DBCrop> {
  try {
    const { data, error } = await supabaseAdmin
      .from(CROPS_TABLE)
      .update({ ...cropData, updated_at: new Date().toISOString() })
      .eq('id', cropId)
      .select()
      .single();

    if (error) {
      console.error('Error updating crop:', error);
      throw error;
    }

    // Invalidera cache
    invalidateCropsCache();
    
    console.log(`🌾 Uppdaterade gröda: ${cropId}`);
    return data;
  } catch (error) {
    console.error('Exception updating crop:', error);
    throw error;
  }
}

/**
 * Ta bort en gröda (uses admin client to bypass RLS)
 */
export async function deleteCrop(cropId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from(CROPS_TABLE)
      .delete()
      .eq('id', cropId);

    if (error) {
      console.error('Error deleting crop:', error);
      throw error;
    }

    // Invalidera cache
    invalidateCropsCache();
    
    console.log(`🌾 Borttagen gröda: ${cropId}`);
  } catch (error) {
    console.error('Exception deleting crop:', error);
    throw error;
  }
}


// ============================================================================
// ALGORITHM CONFIG FUNCTIONS
// ============================================================================

export const ALGORITHM_CONFIG_TABLE = 'algorithm_config';

export interface AlgorithmConfigRow {
  id: string;
  key: string;
  value: number;
  unit: string | null;
  description: string | null;
  min_value: number | null;
  max_value: number | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface AlgorithmConfig {
  [key: string]: number;
}

// Cache för algoritmkonfiguration
let configCache: AlgorithmConfigRow[] | null = null;
let configCacheTime: number = 0;
const CONFIG_CACHE_TTL = 60000; // 1 minut

/**
 * Hämta all algoritmkonfiguration
 */
export async function getAlgorithmConfig(): Promise<AlgorithmConfigRow[]> {
  const now = Date.now();
  
  // Returnera cache om den är färsk
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from(ALGORITHM_CONFIG_TABLE)
      .select('*')
      .order('category')
      .order('key');

    if (error) {
      console.error('Error fetching algorithm config:', error);
      throw error;
    }

    configCache = data || [];
    configCacheTime = now;
    
    console.log(`⚙️  Algoritmkonfiguration laddad: ${configCache.length} parametrar`);
    return configCache;
  } catch (error) {
    console.error('Exception fetching algorithm config:', error);
    throw error;
  }
}

/**
 * Hämta algoritmkonfiguration som key-value objekt
 */
export async function getAlgorithmConfigMap(): Promise<AlgorithmConfig> {
  const rows = await getAlgorithmConfig();
  const config: AlgorithmConfig = {};
  
  for (const row of rows) {
    config[row.key] = row.value;
  }
  
  return config;
}

/**
 * Uppdatera en algoritmkonfigurationsparameter
 */
export async function updateAlgorithmConfigValue(key: string, value: number): Promise<void> {
  try {
    // Hämta först för att validera
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from(ALGORITHM_CONFIG_TABLE)
      .select('min_value, max_value')
      .eq('key', key)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Okänd konfigurationsnyckel: ${key}`);
    }

    // Validera värde mot min/max
    if (existing.min_value !== null && value < existing.min_value) {
      throw new Error(`Värdet ${value} är under minimum ${existing.min_value}`);
    }
    if (existing.max_value !== null && value > existing.max_value) {
      throw new Error(`Värdet ${value} är över maximum ${existing.max_value}`);
    }

    // Uppdatera
    const { error } = await supabaseAdmin
      .from(ALGORITHM_CONFIG_TABLE)
      .update({ value })
      .eq('key', key);

    if (error) {
      console.error('Error updating algorithm config:', error);
      throw error;
    }

    // Invalidera cache
    configCache = null;
    
    console.log(`⚙️  Algoritmkonfiguration uppdaterad: ${key} = ${value}`);
  } catch (error) {
    console.error('Exception updating algorithm config:', error);
    throw error;
  }
}

/**
 * Invalidera konfigurationscachen
 */
export function invalidateConfigCache(): void {
  configCache = null;
  configCacheTime = 0;
}

/**
 * Ta bort legacy motorval-konfiguration (USE_V5, USE_V6, USE_V7)
 */
export async function deleteLegacyEngineConfig(): Promise<number> {
  try {
    // Ta bort alla nycklar som börjar med USE_
    const { data, error } = await supabaseAdmin
      .from(ALGORITHM_CONFIG_TABLE)
      .delete()
      .like('key', 'USE_%')
      .select();

    if (error) {
      console.error('Error deleting legacy engine config:', error);
      throw error;
    }

    // Invalidera cache
    configCache = null;
    
    const deletedCount = data?.length || 0;
    console.log(`🗑️  Tog bort ${deletedCount} legacy motorval-konfigurationer`);
    return deletedCount;
  } catch (error) {
    console.error('Exception deleting legacy config:', error);
    throw error;
  }
}

// =============================================================================
// PRODUCT UPDATE FUNCTIONS (for M3 webhook integration)
// =============================================================================

/**
 * Uppdatera produktpris baserat på artikelnummer
 * @param artikelnr Artikelnummer från M3
 * @param price Nytt pris per kg
 * @returns true om produkten hittades och uppdaterades
 */
export async function updateProductPrice(artikelnr: number, price: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update({ Pris: price.toString().replace('.', ',') })
      .eq('Artikelnr', artikelnr)
      .select();

    if (error) {
      console.error('Error updating product price:', error);
      throw error;
    }

    const updated = data && data.length > 0;
    if (updated) {
      console.log(`💰 Uppdaterade pris för artikel ${artikelnr}: ${price} kr/kg`);
    } else {
      console.warn(`⚠️  Artikel ${artikelnr} hittades inte`);
    }
    return updated;
  } catch (error) {
    console.error('Exception updating product price:', error);
    throw error;
  }
}

/**
 * Uppdatera produktens aktiv-status baserat på artikelnummer
 * @param artikelnr Artikelnummer från M3
 * @param active Om produkten är aktiv/disponibel
 * @returns true om produkten hittades och uppdaterades
 */
export async function updateProductActiveStatus(artikelnr: number, active: boolean): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update({ active })
      .eq('Artikelnr', artikelnr)
      .select();

    if (error) {
      console.error('Error updating product active status:', error);
      throw error;
    }

    const updated = data && data.length > 0;
    if (updated) {
      console.log(`${active ? '✅' : '❌'} Artikel ${artikelnr} markerad som ${active ? 'aktiv' : 'inaktiv'}`);
    } else {
      console.warn(`⚠️  Artikel ${artikelnr} hittades inte`);
    }
    return updated;
  } catch (error) {
    console.error('Exception updating product active status:', error);
    throw error;
  }
}

/**
 * Uppdatera produkt från M3 webhook (pris och/eller aktiv-status)
 * @param artikelnr Artikelnummer från M3
 * @param updates Fält att uppdatera
 * @returns Resultat av uppdateringen
 */
export async function updateProductFromM3(
  artikelnr: number, 
  updates: { price?: number; active?: boolean }
): Promise<{ found: boolean; updated: boolean; artikelnr: number }> {
  try {
    const updateData: Record<string, any> = {};
    
    if (updates.price !== undefined) {
      updateData.Pris = updates.price.toString().replace('.', ',');
    }
    if (updates.active !== undefined) {
      updateData.active = updates.active;
    }

    if (Object.keys(updateData).length === 0) {
      return { found: false, updated: false, artikelnr };
    }

    const { data, error } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .update(updateData)
      .eq('Artikelnr', artikelnr)
      .select();

    if (error) {
      console.error('Error updating product from M3:', error);
      throw error;
    }

    const found = data && data.length > 0;
    if (found) {
      const changes: string[] = [];
      if (updates.price !== undefined) changes.push(`pris=${updates.price}`);
      if (updates.active !== undefined) changes.push(`active=${updates.active}`);
      console.log(`🔄 M3 uppdatering för artikel ${artikelnr}: ${changes.join(', ')}`);
    } else {
      console.warn(`⚠️  M3 webhook: Artikel ${artikelnr} hittades inte i FEST-databasen`);
    }

    return { found, updated: found, artikelnr };
  } catch (error) {
    console.error('Exception in updateProductFromM3:', error);
    throw error;
  }
}
