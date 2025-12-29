import { NutrientNeed } from './NutrientNeed';

/**
 * En produkt med giva i en lösning
 */
export interface ProductAllocation {
  productId: string;
  name: string;
  kgPerHa: number;
}

/**
 * Avvikelse från behov
 */
export interface Deviation {
  kg: number;  // absolut avvikelse i kg/ha (positivt = över, negativt = under)
  pct: number; // procentuell avvikelse
}

/**
 * Avvikelser per näringsämne
 */
export interface NutrientDeviations {
  N?: Deviation;
  P?: Deviation;
  K?: Deviation;
  S?: Deviation;
}

/**
 * En komplett lösning/rekommendation
 */
export interface Solution {
  products: ProductAllocation[];
  supplied: NutrientNeed; // kg/ha som tillförs
  deviation: NutrientDeviations;
  costPerHa: number; // SEK per ha
  score: number; // lägre är bättre
  notes: string[]; // varningar, tips, kommentarer
}
