/**
 * Gröda med näringsbehov per ton skörd
 * Data hämtas från Supabase (tabell: crops)
 */
export type CropUnit =
  | 'TON_GRAIN'   // kärna, spannmål
  | 'TON_SEED'    // frö, oljevx
  | 'TON_TUBER'   // knöl, potatis
  | 'TON_ROOT'    // beta, sockerbeta
  | 'TON_TS';     // torrsubstans, vall/majsensilage

export interface Crop {
  id: string;
  name: string;
  category: 'spannmal' | 'oljevaxte' | 'rotfrukter' | 'grovfoder' | 'ovriga';
  unit: CropUnit;
  nutrientPerTon: {
    N: number;
    P: number;
    K: number;
    S?: number;
  };
  typicalYield: {
    min: number;
    max: number;
    average: number;
  };
  /** Förfruktsvärde - effekt på efterföljande gröda */
  precropEffect?: {
    nEffect: number;       // kg N/ha
    yieldEffect: number;   // kg/ha skördeökning
  };
  description?: string;
  source: {
    provider: 'Odla' | 'Yara/SLU' | 'Proxy' | 'Jordbruksverket' | 'Jordbruksverket + Yara';
    note: string;
    url?: string;
  };
}

/**
 * Beräkna näringsbehov baserat på gröda och förväntad skörd
 */
export function calculateNutrientNeed(crop: Crop, yieldTonPerHa: number) {
  return {
    N: crop.nutrientPerTon.N * yieldTonPerHa,
    P: crop.nutrientPerTon.P * yieldTonPerHa,
    K: crop.nutrientPerTon.K * yieldTonPerHa,
    S: typeof crop.nutrientPerTon.S === 'number' ? crop.nutrientPerTon.S * yieldTonPerHa : undefined,
  };
}

/**
 * Koefficient för hur mycket extra kväve som krävs per ton skördeökning.
 * Enligt riktlinjerna: 15 kg N/ton för spannmål, 20 kg N/ton för vall.
 * Vi använder 15 som standardvärde (konservativt).
 */
const N_PER_TON_YIELD_INCREASE = 15; // kg N per ton skördeökning

/**
 * Beräkna näringsbehov med förfruktseffekt (tvåstegsmodell)
 * 
 * Förfruktsvärdet består av tre delar:
 * 1. Kvarlämnat kväve (från rötter och rester) = kväveefterverkan
 * 2. Förbättrad markstruktur = skördeökning
 * 3. Sjukdomssanerande effekt (ingår i skördeökning)
 * 
 * Beräkning enligt Jordbruksverkets riktlinjer 2025:
 * 
 * Steg A: Justering för ökad skördepotential
 *   Ökat N-behov = Skördeökning (ton) × 15 kg N/ton
 * 
 * Steg B: Beräkning av Nettobehov
 *   N-nettobehov = Basbehov + Ökat N-behov − Kväveefterverkan
 * 
 * @example Fodervete efter blandvall:
 *   Basbehov vid 6 ton = 101 kg N (16.86 × 6)
 *   Skördeökning = 800 kg = 0.8 ton → +12 kg N
 *   Kväveefterverkan = −40 kg N
 *   Slutbehov = 101 + 12 − 40 = 73 kg N
 */
export function calculateNutrientNeedWithPrecrop(
  crop: Crop, 
  yieldTonPerHa: number, 
  precrop?: Crop
): { 
  N: number; 
  P: number; 
  K: number; 
  S?: number; 
  precropNEffect: number;
  yieldIncreaseKgHa: number;
  yieldIncreaseNRequirement: number;
} {
  const baseNeed = calculateNutrientNeed(crop, yieldTonPerHa);
  
  // Hämta förfruktseffekter
  const nEffect = precrop?.precropEffect?.nEffect ?? 0;           // kg N/ha (kväveefterverkan)
  const yieldEffectKgHa = precrop?.precropEffect?.yieldEffect ?? 0; // kg/ha skördeökning
  
  // Steg A: Beräkna ökat N-behov pga skördeökning
  const yieldIncreaseTon = yieldEffectKgHa / 1000; // Omvandla kg till ton
  const yieldIncreaseNRequirement = yieldIncreaseTon * N_PER_TON_YIELD_INCREASE;
  
  // Steg B: Beräkna netto N-behov
  // N-nettobehov = Basbehov + Ökat N-behov − Kväveefterverkan
  const adjustedN = Math.max(0, baseNeed.N + yieldIncreaseNRequirement - nEffect);
  
  return {
    ...baseNeed,
    N: Math.round(adjustedN * 10) / 10, // Avrunda till 1 decimal
    precropNEffect: nEffect,
    yieldIncreaseKgHa: yieldEffectKgHa,
    yieldIncreaseNRequirement: Math.round(yieldIncreaseNRequirement * 10) / 10,
  };
}
