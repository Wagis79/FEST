/**
 * FEST Gödseloptimering v6 - Riktig MILP/ILP med HiGHS
 * 
 * SPECIFIKATION:
 * - Riktig MILP/ILP-solver (HiGHS via WASM)
 * - N: exakt targetN..targetN+1 kg/ha (om mustN=true)
 * - P/K/S: 85%-125% av target (om must=true)
 * - Minimera ENBART produktkostnad (SEK/ha)
 * - Prispall med 3 strategier (via no-good cuts)
 * - Max 4 produkter (hård cap)
 * - Single-nutrient mode: ranking av enskilda produkter
 * - Heltalsskalning för numerisk stabilitet
 */

import { Product } from '../models/Product';
import { NutrientNeed } from '../models/NutrientNeed';

// ============================================================================
// TYPER
// ============================================================================

export interface OptimizeV6Input {
  targets: NutrientNeed;           // kg/ha för N, P, K, S
  mustFlags: {
    mustN: boolean;
    mustP: boolean;
    mustK: boolean;
    mustS: boolean;
  };
  maxProductsUser: number;         // Användarens val (1-4)
  minDoseKgHa: number;             // Default 100
  maxDoseKgHa: number;             // Default 600
  /** Valfri algoritm-konfiguration från databas */
  config?: AlgorithmConfigV6;
}

export interface ProductAllocationV6 {
  artikelnr: number;
  produkt: string;
  doseKgHa: number;
  costSekHa: number;
}

/**
 * Algoritm-konfiguration
 */
export interface AlgorithmConfigV6 {
  /** N-tolerans i kg/ha (default: 1) */
  N_TOLERANCE_KG?: number;
  /** PKS min-procent (default: 85) */
  PKS_MIN_PCT?: number;
  /** PKS max-procent (default: 125) */
  PKS_MAX_PCT?: number;
  /** Varningströskel för okryssade ämnen i % (default: 150) */
  HIGH_LEVEL_THRESHOLD?: number;
  /** Max antal produkter - HÅRD CAP 4 (ignorerar högre värden) */
  MAX_PRODUCTS_HARD?: number;
  /** Antal strategier att returnera (default: 3) */
  NUM_STRATEGIES?: number;
}

/**
 * Default-värden för algoritm-konfiguration
 */
export const DEFAULT_ALGORITHM_CONFIG_V6: Required<AlgorithmConfigV6> = {
  N_TOLERANCE_KG: 1,
  PKS_MIN_PCT: 85,
  PKS_MAX_PCT: 125,
  HIGH_LEVEL_THRESHOLD: 150,
  MAX_PRODUCTS_HARD: 4,  // Hård cap
  NUM_STRATEGIES: 3,
};

export interface StrategyResultV6 {
  rank: number;
  totalCostSekHa: number;
  products: ProductAllocationV6[];
  achieved: {
    N: number;
    P: number;
    K: number;
    S: number;
  };
  percentOfTarget: {
    N: number | null;
    P: number | null;
    K: number | null;
    S: number | null;
  };
  mustFlags: {
    N: boolean;
    P: boolean;
    K: boolean;
    S: boolean;
  };
  warnings: WarningItemV6[];
}

export interface WarningItemV6 {
  nutrient: 'N' | 'P' | 'K' | 'S';
  type: 'HIGH_LEVEL';
  threshold: number;
  valueKgHa: number;
  ratio: number;
}

// Kompatibel med v5 output
export interface OptimizeV6Output {
  status: 'ok' | 'infeasible';
  usedMaxProducts: number;
  strategies: StrategyResultV6[];
  message?: string;
}

interface PreparedProduct {
  id: string;
  artikelnr: number;
  name: string;
  price: number;        // SEK/kg
  priceOre: number;     // Öre/kg (heltal)
  n: number;            // Fraktion 0-1
  p: number;
  k: number;
  s: number;
  n10: number;          // Tiondels-procent som heltal (15.5% -> 155)
  p10: number;
  k10: number;
  s10: number;
}

// Räknare för att tvinga unique import varje gång
let highsInstanceCounter = 0;

async function getHighsSolver(): Promise<any> {
  // WORKAROUND: Skapa alltid helt ny instans för att undvika WASM state-problem
  // Increment counter för att säkerställa unik import
  highsInstanceCounter++;
  console.log(`Creating HiGHS instance #${highsInstanceCounter}...`);
  
  try {
    // Dynamisk import för att undvika cachning
    const highsModule = await import('highs');
    const loader = highsModule.default || highsModule;
    const highs = await loader({});
    console.log('✅ HiGHS solver ready, type:', typeof highs, 'solve:', typeof highs?.solve);
    return highs;
  } catch (e) {
    console.error('Failed to create HiGHS instance:', e);
    throw e;
  }
}

// ============================================================================
// HJÄLPFUNKTIONER
// ============================================================================

/**
 * Förbered produkter för optimering
 */
function prepareProducts(products: Product[]): PreparedProduct[] {
  return products
    .filter(p => p.id && p.pricePerKg !== undefined && p.pricePerKg > 0)
    .map(p => {
      const n = (p.nutrients.N || 0) / 100;
      const pVal = (p.nutrients.P || 0) / 100;
      const k = (p.nutrients.K || 0) / 100;
      const s = (p.nutrients.S || 0) / 100;
      const price = p.pricePerKg || 0;

      const artikelnr = parseInt(p.id.replace('prod-', '')) || 0;

      return {
        id: p.id,
        artikelnr,
        name: p.name,
        price,
        priceOre: Math.round(price * 100),
        n,
        p: pVal,
        k,
        s,
        n10: Math.round((p.nutrients.N || 0) * 10),
        p10: Math.round((p.nutrients.P || 0) * 10),
        k10: Math.round((p.nutrients.K || 0) * 10),
        s10: Math.round((p.nutrients.S || 0) * 10),
      };
    })
    .filter(p => p.n10 > 0 || p.p10 > 0 || p.k10 > 0 || p.s10 > 0);
}

/**
 * Beräkna percent of target
 */
function calcPercentOfTarget(achieved: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((achieved / target) * 1000) / 10;
}

/**
 * Generera varningar för ämnen som INTE är must men har hög nivå
 */
function generateWarnings(
  achieved: { N: number; P: number; K: number; S: number },
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV6>
): WarningItemV6[] {
  const warnings: WarningItemV6[] = [];
  const highLevelThreshold = config.HIGH_LEVEL_THRESHOLD / 100;

  const checkWarning = (nutrient: 'N' | 'P' | 'K' | 'S', must: boolean, target: number, achievedVal: number) => {
    if (!must && target > 0) {
      const ratio = achievedVal / target;
      if (ratio > highLevelThreshold) {
        warnings.push({
          nutrient,
          type: 'HIGH_LEVEL',
          threshold: highLevelThreshold,
          valueKgHa: achievedVal,
          ratio: Math.round(ratio * 100) / 100,
        });
      }
    }
  };

  checkWarning('N', mustFlags.mustN, targets.N || 0, achieved.N);
  checkWarning('P', mustFlags.mustP, targets.P || 0, achieved.P);
  checkWarning('K', mustFlags.mustK, targets.K || 0, achieved.K);
  checkWarning('S', mustFlags.mustS, targets.S || 0, achieved.S);

  return warnings;
}

// ============================================================================
// SINGLE NUTRIENT MODE (activeCount == 1)
// ============================================================================

interface SingleNutrientSolution {
  product: PreparedProduct;
  dose: number;
  cost: number;
  achieved: { N: number; P: number; K: number; S: number };
}

/**
 * Single-nutrient mode: hitta bästa enskilda produkter
 */
function solveSingleNutrient(
  products: PreparedProduct[],
  nutrient: 'N' | 'P' | 'K' | 'S',
  target: number,
  minDose: number,
  maxDose: number,
  config: Required<AlgorithmConfigV6>,
  numStrategies: number
): SingleNutrientSolution[] {
  const nutrientKey = nutrient.toLowerCase() as 'n' | 'p' | 'k' | 's';
  const nutrient10Key = `${nutrientKey}10` as 'n10' | 'p10' | 'k10' | 's10';

  // Beräkna tillåtet intervall
  let lower: number;
  let upper: number;

  if (nutrient === 'N') {
    lower = target;
    upper = target + config.N_TOLERANCE_KG;
  } else {
    lower = (config.PKS_MIN_PCT / 100) * target;
    upper = (config.PKS_MAX_PCT / 100) * target;
  }

  const feasibleProducts: SingleNutrientSolution[] = [];

  for (const p of products) {
    const frac = p[nutrientKey];
    if (frac <= 0) continue;

    // Beräkna dos-intervall
    let xMin = Math.ceil(lower / frac);
    let xMax = Math.floor(upper / frac);

    // Clampa till min/maxDose
    xMin = Math.max(xMin, minDose);
    xMax = Math.min(xMax, maxDose);

    if (xMin > xMax) continue; // Ingen feasible dos

    // Välj minsta dos (billigast)
    const dose = xMin;
    const cost = dose * p.price;

    // Beräkna achieved för alla näringsämnen
    const achieved = {
      N: Math.round(dose * p.n * 100) / 100,
      P: Math.round(dose * p.p * 100) / 100,
      K: Math.round(dose * p.k * 100) / 100,
      S: Math.round(dose * p.s * 100) / 100,
    };

    feasibleProducts.push({ product: p, dose, cost, achieved });
  }

  // Sortera efter kostnad
  feasibleProducts.sort((a, b) => a.cost - b.cost);

  // Returnera upp till numStrategies
  return feasibleProducts.slice(0, numStrategies);
}

// ============================================================================
// MILP SOLVER (activeCount >= 2 eller fallback)
// ============================================================================

interface MILPSolution {
  products: Array<{ product: PreparedProduct; dose: number }>;
  cost: number;
  achieved: { N: number; P: number; K: number; S: number };
}

/**
 * Bygg och lös MILP-modell med HiGHS (med retry-mekanism)
 * 
 * Variabler:
 * - x_i: heltal, dos för produkt i
 * - y_i: binär, om produkt i används
 * 
 * Constraints:
 * - x_i >= minDose * y_i
 * - x_i <= maxDose * y_i
 * - sum(y_i) <= maxProducts
 * - näringsconstraints för must=true
 * - no-good cuts från tidigare strategier
 */
async function solveMILP(
  products: PreparedProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV6>
): Promise<MILPSolution | null> {
  
  // Retry-mekanism för WASM-stabilitet
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await solveMILPCore(products, targets, mustFlags, maxProducts, minDose, maxDose, noGoodCuts, config);
    } catch (e: any) {
      lastError = e;
      const isWasmError = e?.message?.includes('WASM') || 
                          e?.message?.includes('null function') || 
                          e?.message?.includes('Aborted');
      
      if (isWasmError && attempt < maxRetries) {
        console.log(`HiGHS WASM error, retrying (attempt ${attempt + 1}/${maxRetries})...`);
        // Kort paus för att låta WASM återställas
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      
      // Logga men ge inte upp - returnera null istället för att kasta
      console.error('HiGHS solve error:', e);
      return null;
    }
  }
  
  console.error('HiGHS solve failed after', maxRetries, 'attempts:', lastError);
  return null;
}

/**
 * Intern: Lös MILP-problem (kan kasta fel vid WASM-problem)
 */
async function solveMILPCore(
  products: PreparedProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV6>
): Promise<MILPSolution | null> {
  
  const highs = await getHighsSolver();
  const n = products.length;
  
  if (n === 0) return null;

  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;

  const nTolKg = config.N_TOLERANCE_KG;
  const pksMinRatio = config.PKS_MIN_PCT / 100;
  const pksMaxRatio = config.PKS_MAX_PCT / 100;

  // Bygg LP-fil i CPLEX LP-format
  let lp = '';
  
  // Objective: minimize cost
  lp += 'Minimize\n obj: ';
  const objTerms: string[] = [];
  for (let i = 0; i < n; i++) {
    objTerms.push(`${products[i].priceOre} x${i}`);
  }
  lp += objTerms.join(' + ') + '\n';

  lp += 'Subject To\n';
  let constraintIdx = 0;

  // Dos-koppling: x_i >= minDose * y_i  =>  x_i - minDose*y_i >= 0
  for (let i = 0; i < n; i++) {
    lp += ` c${constraintIdx++}: x${i} - ${minDose} y${i} >= 0\n`;
  }

  // Dos-koppling: x_i <= maxDose * y_i  =>  x_i - maxDose*y_i <= 0
  for (let i = 0; i < n; i++) {
    lp += ` c${constraintIdx++}: x${i} - ${maxDose} y${i} <= 0\n`;
  }

  // Max produkter: sum(y_i) <= maxProducts
  lp += ` c${constraintIdx++}: ` + 
    products.map((_, i) => `y${i}`).join(' + ') + 
    ` <= ${maxProducts}\n`;

  // N-constraint (om mustN)
  // N_ach = sum(x_i * n10_i) / 1000  (kg)
  // Constraint: targetN <= N_ach <= targetN + nTolKg
  // => targetN * 1000 <= sum(x_i * n10_i) <= (targetN + nTolKg) * 1000
  if (mustFlags.mustN && targetN > 0) {
    const nMin10 = Math.round(targetN * 1000);
    const nMax10 = Math.round((targetN + nTolKg) * 1000);
    
    const nTerms = products.map((p, i) => `${p.n10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${nTerms} >= ${nMin10}\n`;
    lp += ` c${constraintIdx++}: ${nTerms} <= ${nMax10}\n`;
  }

  // P-constraint (om mustP)
  if (mustFlags.mustP && targetP > 0) {
    const pMin10 = Math.ceil(pksMinRatio * targetP * 1000);
    const pMax10 = Math.floor(pksMaxRatio * targetP * 1000);
    
    const pTerms = products.map((p, i) => `${p.p10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${pTerms} >= ${pMin10}\n`;
    lp += ` c${constraintIdx++}: ${pTerms} <= ${pMax10}\n`;
  }

  // K-constraint (om mustK)
  if (mustFlags.mustK && targetK > 0) {
    const kMin10 = Math.ceil(pksMinRatio * targetK * 1000);
    const kMax10 = Math.floor(pksMaxRatio * targetK * 1000);
    
    const kTerms = products.map((p, i) => `${p.k10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${kTerms} >= ${kMin10}\n`;
    lp += ` c${constraintIdx++}: ${kTerms} <= ${kMax10}\n`;
  }

  // S-constraint (om mustS)
  if (mustFlags.mustS && targetS > 0) {
    const sMin10 = Math.ceil(pksMinRatio * targetS * 1000);
    const sMax10 = Math.floor(pksMaxRatio * targetS * 1000);
    
    const sTerms = products.map((p, i) => `${p.s10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${sTerms} >= ${sMin10}\n`;
    lp += ` c${constraintIdx++}: ${sTerms} <= ${sMax10}\n`;
  }

  // No-good cuts: förhindra exakt samma produktmix
  // Enkel metod: minst en av de tidigare valda produkterna måste vara AV
  // sum_{i in S}(y_i) <= |S| - 1  (dvs inte ALLA valda produkter kan vara aktiva)
  for (const prevY of noGoodCuts) {
    // Hitta vilka produkter som var valda (y_i = 1)
    const selectedIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (prevY[i] === 1) {
        selectedIndices.push(i);
      }
    }
    
    if (selectedIndices.length === 0) continue;
    
    // Constraint: y_a + y_b + y_c <= |S| - 1 (minst en måste vara av)
    const terms = selectedIndices.map(i => `y${i}`).join(' + ');
    const rhs = selectedIndices.length - 1;
    
    lp += ` c${constraintIdx++}: ${terms} <= ${rhs}\n`;
  }

  // Bounds
  lp += 'Bounds\n';
  for (let i = 0; i < n; i++) {
    lp += ` 0 <= x${i} <= ${maxDose}\n`;
    lp += ` 0 <= y${i} <= 1\n`;
  }

  // Integer/Binary
  lp += 'General\n';
  for (let i = 0; i < n; i++) {
    lp += ` x${i}\n`;
  }
  lp += 'Binary\n';
  for (let i = 0; i < n; i++) {
    lp += ` y${i}\n`;
  }

  lp += 'End\n';

  // Debug: skriv ut LP-problem
  if (process.env.DEBUG_LP === '1') {
    console.log('LP PROBLEM:\n' + lp.slice(0, 2000) + '...');
    // Skriv hela LP till fil
    const fs = await import('fs');
    fs.writeFileSync('/tmp/highs-debug.lp', lp);
    console.log('Wrote full LP to /tmp/highs-debug.lp');
  }

  // Lös med HiGHS
  try {
    console.log('Calling highs.solve() with LP of', lp.length, 'chars');
    const result = highs.solve(lp);
    console.log('HiGHS result status:', result.Status);
    
    if (result.Status !== 'Optimal') {
      console.log(`HiGHS status: ${result.Status}`);
      return null;
    }

    // Extrahera lösning
    const xValues: number[] = [];
    const yValues: number[] = [];
    
    for (let i = 0; i < n; i++) {
      const xVal = result.Columns[`x${i}`]?.Primal || 0;
      const yVal = result.Columns[`y${i}`]?.Primal || 0;
      xValues.push(Math.round(xVal));
      yValues.push(Math.round(yVal));
    }

    // Beräkna achieved och kostnad
    let totalCostOre = 0;
    let nAch10 = 0;
    let pAch10 = 0;
    let kAch10 = 0;
    let sAch10 = 0;

    const productDoses: Array<{ product: PreparedProduct; dose: number }> = [];

    for (let i = 0; i < n; i++) {
      const dose = xValues[i];
      if (dose > 0) {
        const p = products[i];
        productDoses.push({ product: p, dose });
        totalCostOre += dose * p.priceOre;
        nAch10 += dose * p.n10;
        pAch10 += dose * p.p10;
        kAch10 += dose * p.k10;
        sAch10 += dose * p.s10;
      }
    }

    if (productDoses.length === 0) {
      return null;
    }

    return {
      products: productDoses,
      cost: totalCostOre / 100,
      achieved: {
        N: Math.round(nAch10 / 10) / 100,
        P: Math.round(pAch10 / 10) / 100,
        K: Math.round(kAch10 / 10) / 100,
        S: Math.round(sAch10 / 10) / 100,
      },
    };
  } catch (e) {
    // Kasta felet så att solveMILP kan hantera retry
    throw e;
  }
}

/**
 * Extrahera y-vektor från lösning
 */
function extractYVector(solution: MILPSolution, products: PreparedProduct[]): number[] {
  const yVector = new Array(products.length).fill(0);
  for (const pd of solution.products) {
    const idx = products.findIndex(p => p.id === pd.product.id);
    if (idx >= 0) {
      yVector[idx] = 1;
    }
  }
  return yVector;
}

// ============================================================================
// HUVUDFUNKTION
// ============================================================================

// Max antal produkter för WASM-stabilitet (HiGHS kraschar med för stora LP-problem)
const MAX_PRODUCTS_FOR_MILP = 40;

/**
 * Optimera gödselstrategi med MILP (v6)
 */
export async function optimizeV6(
  products: Product[],
  input: OptimizeV6Input
): Promise<OptimizeV6Output> {
  
  const { targets, mustFlags, maxProductsUser, minDoseKgHa, maxDoseKgHa } = input;
  
  // Merge config med defaults
  const config: Required<AlgorithmConfigV6> = {
    ...DEFAULT_ALGORITHM_CONFIG_V6,
    ...input.config,
  };
  
  // Hård cap: max 4 produkter
  const effectiveHardCap = Math.min(4, config.MAX_PRODUCTS_HARD);
  const numStrategies = config.NUM_STRATEGIES;
  
  // Förbered produkter
  let preparedProducts = prepareProducts(products);
  
  if (preparedProducts.length === 0) {
    return {
      status: 'infeasible',
      usedMaxProducts: maxProductsUser,
      strategies: [],
      message: 'Inga optimerbara produkter tillgängliga',
    };
  }
  
  // Begränsa produktantal för WASM-stabilitet
  // Sortera efter pris/näring-ratio för att behålla de mest ekonomiska
  if (preparedProducts.length > MAX_PRODUCTS_FOR_MILP) {
    console.log(`⚠️  Begränsar produkter från ${preparedProducts.length} till ${MAX_PRODUCTS_FOR_MILP} för WASM-stabilitet`);
    
    // Ranka produkter efter "värde" (mest näring per krona)
    const ranked = preparedProducts.map(p => {
      const totalNutrient = p.n10 + p.p10 + p.k10 + p.s10;
      const valueScore = totalNutrient / (p.priceOre + 1); // Näring per öre
      return { product: p, score: valueScore };
    });
    
    // Sortera fallande (högst värde först) och ta de bästa
    ranked.sort((a, b) => b.score - a.score);
    preparedProducts = ranked.slice(0, MAX_PRODUCTS_FOR_MILP).map(r => r.product);
  }

  // Räkna aktiva näringsämnen
  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;
  
  const activeNutrients: ('N' | 'P' | 'K' | 'S')[] = [];
  if (mustFlags.mustN && targetN > 0) activeNutrients.push('N');
  if (mustFlags.mustP && targetP > 0) activeNutrients.push('P');
  if (mustFlags.mustK && targetK > 0) activeNutrients.push('K');
  if (mustFlags.mustS && targetS > 0) activeNutrients.push('S');
  
  const activeCount = activeNutrients.length;

  // ──────────────────────────────────────────────────────────────────────────
  // SPECIALFALL: activeCount == 0
  // ──────────────────────────────────────────────────────────────────────────
  if (activeCount === 0) {
    return {
      status: 'ok',
      usedMaxProducts: 0,
      strategies: [{
        rank: 1,
        totalCostSekHa: 0,
        products: [],
        achieved: { N: 0, P: 0, K: 0, S: 0 },
        percentOfTarget: { N: null, P: null, K: null, S: null },
        mustFlags: {
          N: mustFlags.mustN,
          P: mustFlags.mustP,
          K: mustFlags.mustK,
          S: mustFlags.mustS,
        },
        warnings: [],
      }],
      message: 'Inga näringsämnen valda som krav.',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SPECIALFALL: activeCount == 1 (SINGLE NUTRIENT MODE)
  // ──────────────────────────────────────────────────────────────────────────
  if (activeCount === 1) {
    const nutrient = activeNutrients[0];
    const target = nutrient === 'N' ? targetN : nutrient === 'P' ? targetP : nutrient === 'K' ? targetK : targetS;
    
    const singleSolutions = solveSingleNutrient(
      preparedProducts,
      nutrient,
      target,
      minDoseKgHa,
      maxDoseKgHa,
      config,
      numStrategies
    );

    if (singleSolutions.length > 0) {
      // Returnera ranking av enskilda produkter
      const strategies: StrategyResultV6[] = singleSolutions.map((sol, idx) => ({
        rank: idx + 1,
        totalCostSekHa: Math.round(sol.cost * 100) / 100,
        products: [{
          artikelnr: sol.product.artikelnr,
          produkt: sol.product.name,
          doseKgHa: sol.dose,
          costSekHa: Math.round(sol.cost * 100) / 100,
        }],
        achieved: sol.achieved,
        percentOfTarget: {
          N: calcPercentOfTarget(sol.achieved.N, targetN),
          P: calcPercentOfTarget(sol.achieved.P, targetP),
          K: calcPercentOfTarget(sol.achieved.K, targetK),
          S: calcPercentOfTarget(sol.achieved.S, targetS),
        },
        mustFlags: {
          N: mustFlags.mustN,
          P: mustFlags.mustP,
          K: mustFlags.mustK,
          S: mustFlags.mustS,
        },
        warnings: generateWarnings(sol.achieved, targets, mustFlags, config),
      }));

      return {
        status: 'ok',
        usedMaxProducts: 1,
        strategies,
      };
    }

    // Fallback till MILP om ingen single-produkt funkar
    // (fortsätt nedan med autoökning)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MILP MODE (activeCount >= 2 eller single-nutrient fallback)
  // ──────────────────────────────────────────────────────────────────────────
  
  // Autoökning vid infeasible
  let currentMaxProducts = Math.min(maxProductsUser, effectiveHardCap);
  let solution: MILPSolution | null = null;

  while (currentMaxProducts <= effectiveHardCap) {
    solution = await solveMILP(
      preparedProducts,
      targets,
      mustFlags,
      currentMaxProducts,
      minDoseKgHa,
      maxDoseKgHa,
      [],
      config
    );

    if (solution) break;
    currentMaxProducts++;
  }

  if (!solution) {
    return {
      status: 'infeasible',
      usedMaxProducts: effectiveHardCap,
      strategies: [],
      message: `Ingen lösning upp till ${effectiveHardCap} produkter med givor ${minDoseKgHa}–${maxDoseKgHa} kg/ha.`,
    };
  }

  // Bygg strategier med no-good cuts
  const strategies: StrategyResultV6[] = [];
  const noGoodCuts: number[][] = [];

  // Strategi 1
  strategies.push(buildStrategyResult(solution, 1, targets, mustFlags, config));
  noGoodCuts.push(extractYVector(solution, preparedProducts));

  // Strategi 2 (om numStrategies >= 2)
  if (numStrategies >= 2) {
    const solution2 = await solveMILP(
      preparedProducts,
      targets,
      mustFlags,
      currentMaxProducts,
      minDoseKgHa,
      maxDoseKgHa,
      noGoodCuts,
      config
    );

    if (solution2) {
      strategies.push(buildStrategyResult(solution2, 2, targets, mustFlags, config));
      noGoodCuts.push(extractYVector(solution2, preparedProducts));

      // Strategi 3 (om numStrategies >= 3)
      if (numStrategies >= 3) {
        const solution3 = await solveMILP(
          preparedProducts,
          targets,
          mustFlags,
          currentMaxProducts,
          minDoseKgHa,
          maxDoseKgHa,
          noGoodCuts,
          config
        );

        if (solution3) {
          strategies.push(buildStrategyResult(solution3, 3, targets, mustFlags, config));
        }
      }
    }
  }

  return {
    status: 'ok',
    usedMaxProducts: currentMaxProducts,
    strategies,
  };
}

/**
 * Bygg StrategyResultV6 från MILPSolution
 */
function buildStrategyResult(
  solution: MILPSolution,
  rank: number,
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV6>
): StrategyResultV6 {
  
  const products: ProductAllocationV6[] = solution.products.map(pd => ({
    artikelnr: pd.product.artikelnr,
    produkt: pd.product.name,
    doseKgHa: pd.dose,
    costSekHa: Math.round(pd.dose * pd.product.price * 100) / 100,
  }));

  const totalCostSekHa = Math.round(solution.cost * 100) / 100;

  const percentOfTarget = {
    N: calcPercentOfTarget(solution.achieved.N, targets.N || 0),
    P: calcPercentOfTarget(solution.achieved.P, targets.P || 0),
    K: calcPercentOfTarget(solution.achieved.K, targets.K || 0),
    S: calcPercentOfTarget(solution.achieved.S, targets.S || 0),
  };

  const warnings = generateWarnings(solution.achieved, targets, mustFlags, config);

  return {
    rank,
    totalCostSekHa,
    products,
    achieved: solution.achieved,
    percentOfTarget,
    mustFlags: {
      N: mustFlags.mustN,
      P: mustFlags.mustP,
      K: mustFlags.mustK,
      S: mustFlags.mustS,
    },
    warnings,
  };
}

// ============================================================================
// ADAPTER FÖR BEFINTLIG API (kompatibel med v5)
// ============================================================================

/**
 * Adapter för att använda optimize-v6 med befintlig Solution-typ
 */
export async function optimizeV6ToSolutions(
  products: Product[],
  need: NutrientNeed,
  options: {
    maxProducts?: number;
    requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
    minDose?: number;
    maxDose?: number;
    config?: AlgorithmConfigV6;
  } = {}
): Promise<import('../models/Solution').Solution[]> {
  
  const requiredNutrients = options.requiredNutrients || [];
  
  // VIKTIGT: N är INTE default required. Bara det som finns i requiredNutrients är must.
  const input: OptimizeV6Input = {
    targets: need,
    mustFlags: {
      mustN: requiredNutrients.includes('N'),
      mustP: requiredNutrients.includes('P'),
      mustK: requiredNutrients.includes('K'),
      mustS: requiredNutrients.includes('S'),
    },
    maxProductsUser: options.maxProducts || 2,
    minDoseKgHa: options.minDose || 100,
    maxDoseKgHa: options.maxDose || 600,
    config: options.config,
  };

  const result = await optimizeV6(products, input);

  if (result.status === 'infeasible' || result.strategies.length === 0) {
    return [];
  }

  // Konvertera till Solution-format
  return result.strategies.map(strategy => ({
    products: strategy.products.map(p => ({
      productId: `prod-${p.artikelnr}`,
      name: p.produkt,
      kgPerHa: p.doseKgHa,
    })),
    supplied: strategy.achieved,
    deviation: {
      N: {
        kg: strategy.achieved.N - (need.N || 0),
        pct: (strategy.percentOfTarget.N || 100) - 100,
      },
      P: {
        kg: strategy.achieved.P - (need.P || 0),
        pct: (strategy.percentOfTarget.P || 0) - 100,
      },
      K: {
        kg: strategy.achieved.K - (need.K || 0),
        pct: (strategy.percentOfTarget.K || 0) - 100,
      },
      S: {
        kg: strategy.achieved.S - (need.S || 0),
        pct: (strategy.percentOfTarget.S || 0) - 100,
      },
    },
    costPerHa: strategy.totalCostSekHa,
    score: strategy.totalCostSekHa,
    notes: strategy.warnings.map(w => 
      `Varning: ${w.nutrient} är ${Math.round(w.ratio * 100)}% av behov (${w.valueKgHa} kg/ha)`
    ),
  }));
}

export default optimizeV6;
