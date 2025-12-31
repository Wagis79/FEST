/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * Näringsbehov per hektar i kg/ha
 */
export interface NutrientNeed {
  N?: number; // kg/ha kväve
  P?: number; // kg/ha fosfor
  K?: number; // kg/ha kalium
  S?: number; // kg/ha svavel
}
