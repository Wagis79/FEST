/**
 * Näringsinnehåll i procent (0-100)
 */
export interface NutrientContent {
  N?: number; // Kväve
  P?: number; // Fosfor
  K?: number; // Kalium
  S?: number; // Svavel
}

/**
 * En gödselprodukt
 */
export interface Product {
  id: string;
  name: string;
  pricePerKg: number; // SEK per kg
  nutrients: NutrientContent; // procent
  description?: string;
}
