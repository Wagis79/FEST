/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * FEST Gödseloptimering v7 - Produktionsredo MILP med HiGHS
 * 
 * SPECIFIKATION (baserad på funktionella krav):
 * 
 * 1. SYFTE: Föreslå upp till 3 gödselstrategier (prispall) som:
 *    - Uppfyller valda näringskrav inom toleranser
 *    - Respekterar praktiska begränsningar (max 4 produkter, dosgränser)
 *    - Minimerar produktkostnad (SEK/ha)
 * 
 * 2. NÄRINGSLOGIK:
 *    - N (om mustN=true): targetN ≤ N_ach ≤ targetN + tolerance (eskaleras vid fallback)
 *    - P/K/S (om must=true): 85% ≤ ach/target ≤ 125%
 *    - Ej aktiverade ämnen: inga constraints
 * 
 * 3. SINGLE NUTRIENT MODE (exakt ett aktiverat ämne):
 *    - Returnera ranking av enskilda produkter
 *    - Rankas på kostnad, tie-break på avvikelse från target
 * 
 * 4. N-TOLERANS ESKALERING (om mustN=true):
 *    - Om ingen lösning med tolerance +1, prova +2, +3, +4, +5
 * 
 * 5. PRISPALL (3 strategier):
 *    - Via no-good cuts på produktuppsättning
 *    - Tie-break: lägst summa absolut avvikelse, färre produkter
 * 
 * 6. VALIDERING:
 *    - Minst ett ämne aktiverat
 *    - För aktiverat ämne X: targetX ≥ 1
 * 
 * 7. WARNINGS:
 *    - För ej aktiverade ämnen: om achieved/target > 150%
 * 
 * 8. CHILD PROCESS ISOLATION:
 *    - HiGHS körs i separata worker-processer för att isolera WASM-krascher
 */

import type { Product } from '../models/Product';
import type { NutrientNeed } from '../models/NutrientNeed';
import type { Solution } from '../models/Solution';
import type { HighsResult } from './highs-pool';
import type { Highs, HighsSolution } from 'highs';
import { getHighsPool } from './highs-pool';
import log from '../utils/logger';

// ============================================================================
// TYPER
// ============================================================================

export interface OptimizeV7Input {
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
  /** Valfri algoritm-konfiguration */
  config?: AlgorithmConfigV7;
  /** Produkt-IDs som MÅSTE inkluderas i lösningen */
  requiredProductIds?: string[];
}

export interface ProductAllocationV7 {
  artikelnr: number;
  produkt: string;
  doseKgHa: number;
  costSekHa: number;
}

/**
 * Algoritm-konfiguration
 */
export interface AlgorithmConfigV7 {
  /** N-tolerans i kg/ha (default: 1) */
  N_TOLERANCE_KG?: number;
  /** Max N-tolerans vid eskalering (default: 5) */
  N_MAX_TOLERANCE_KG?: number;
  /** PKS min-procent (default: 85) */
  PKS_MIN_PCT?: number;
  /** PKS max-procent (default: 125) */
  PKS_MAX_PCT?: number;
  /** Varningströskel för okryssade ämnen i % (default: 150) */
  HIGH_LEVEL_THRESHOLD?: number;
  /** Max antal produkter - HÅRD CAP 4 */
  MAX_PRODUCTS_HARD?: number;
  /** Antal strategier att returnera (default: 3) */
  NUM_STRATEGIES?: number;
  /** Timeout i ms (default: 30000) */
  TIMEOUT_MS?: number;
}

/**
 * Default-värden för algoritm-konfiguration
 * 
 * OBS: Dessa är FALLBACK-värden. Produktionen använder alltid
 * värden från databasen (algorithm_config tabellen).
 * Dessa defaults används endast om databasen inte kan nås.
 * 
 * Synka med: sql/algorithm_config.sql
 */
export const DEFAULT_ALGORITHM_CONFIG_V7: Required<AlgorithmConfigV7> = {
  N_TOLERANCE_KG: 1,
  N_MAX_TOLERANCE_KG: 5,
  PKS_MIN_PCT: 90,       // Databas-master: 90
  PKS_MAX_PCT: 150,      // Databas-master: 150
  HIGH_LEVEL_THRESHOLD: 151,  // Databas-master: 151
  MAX_PRODUCTS_HARD: 5,  // Databas-master: 5
  NUM_STRATEGIES: 3,
  TIMEOUT_MS: 30000,
};

export interface StrategyResultV7 {
  rank: number;
  totalCostSekHa: number;
  products: ProductAllocationV7[];
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
  warnings: WarningItemV7[];
  /** Vilken N-tolerans som användes (om relevant) */
  nToleranceUsed: number | null;
}

export interface WarningItemV7 {
  nutrient: 'N' | 'P' | 'K' | 'S';
  type: 'HIGH_LEVEL';
  threshold: number;
  valueKgHa: number;
  ratio: number;
}

export interface OptimizeV7Output {
  status: 'ok' | 'infeasible';
  usedMaxProducts: number;
  strategies: StrategyResultV7[];
  message?: string;
  /** N-tolerans som användes (om relevant) */
  nToleranceUsed?: number;
}

// ============================================================================
// INTERNA TYPER
// ============================================================================

interface PreparedProduct {
  id: string;
  artikelnr: number;
  name: string;
  price: number;        // SEK/kg
  priceOre: number;     // Öre/kg (heltal för numerisk stabilitet)
  n: number;            // Fraktion 0-1
  p: number;
  k: number;
  s: number;
  n10: number;          // Tiondels-procent som heltal (15.5% -> 155)
  p10: number;
  k10: number;
  s10: number;
}

interface MILPSolution {
  products: Array<{ product: PreparedProduct; dose: number }>;
  cost: number;
  achieved: { N: number; P: number; K: number; S: number };
}

interface SingleNutrientSolution {
  product: PreparedProduct;
  dose: number;
  cost: number;
  achieved: { N: number; P: number; K: number; S: number };
  deviation: number; // Absolut procentuell avvikelse
}

// ============================================================================
// HIGHS WORKER POOL MODE (child process isolation)
// ============================================================================

// Flag för att aktivera/deaktivera worker pool mode
const USE_WORKER_POOL = true;

// Worker pool singleton (initieras direkt om aktiverat)
const workerPool = USE_WORKER_POOL ? getHighsPool() : null;

// Räknare för konsekutiva pool-fel (för fallback)
let consecutivePoolErrors = 0;
const MAX_POOL_ERRORS_BEFORE_FALLBACK = 999; // Praktiskt inaktivera fallback - worker pool är stabilare

/**
 * Lös LP via worker pool med automatisk retry
 */
async function solveLPViaPool(lp: string): Promise<HighsResult | null> {
  if (!workerPool) {
    throw new Error('Worker pool not initialized');
  }
  
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await workerPool.solve(lp);
      consecutivePoolErrors = 0; // Återställ vid lyckat anrop
      return result;
    } catch (e) {
      consecutivePoolErrors++;
      const isLastAttempt = attempt === maxRetries;
      
      if (!isLastAttempt) {
        // Vänta lite innan retry för att ge ny worker tid att starta
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      log.error(`Worker pool error after ${maxRetries} retries`, e instanceof Error ? e : new Error(String(e)));
      return null;
    }
  }
  
  return null;
}

/**
 * Kolla om vi ska falla tillbaka till inline HiGHS
 */
function shouldUseFallback(): boolean {
  return consecutivePoolErrors >= MAX_POOL_ERRORS_BEFORE_FALLBACK;
}

// Fallback-variabler för inline HiGHS (används om pool inte fungerar)
let cachedHighs: Highs | null = null;
let highsInstanceCounter = 0;
let highsSolveCount = 0;
const MAX_SOLVES_BEFORE_RESET = 50;

/**
 * Hämta HiGHS solver - fallback för inline-mode
 */
async function getHighsSolver(forceNew: boolean = false): Promise<Highs> {
  if (forceNew || highsSolveCount >= MAX_SOLVES_BEFORE_RESET) {
    if (cachedHighs) {
      log.debug(`Resetting HiGHS (${highsSolveCount} solves, forceNew=${forceNew})`);
      cachedHighs = null;
      highsSolveCount = 0;
    }
  }
  
  if (cachedHighs) {
    return cachedHighs;
  }

  highsInstanceCounter++;
  log.debug(`Creating HiGHS instance #${highsInstanceCounter}...`);

  try {
    const highsModule = await import('highs');
    const loader = highsModule.default || highsModule;
    cachedHighs = await loader({});
    highsSolveCount = 0;
    log.debug('HiGHS solver ready');
    return cachedHighs;
  } catch (e) {
    log.error('Failed to create HiGHS instance', e as Error);
    cachedHighs = null;
    throw e;
  }
}

function incrementSolveCount(): void {
  highsSolveCount++;
}

function resetHighsOnError(): void {
  log.warn('Forcing HiGHS reset due to error');
  cachedHighs = null;
  highsSolveCount = 0;
}

// ============================================================================
// HJÄLPFUNKTIONER
// ============================================================================

/**
 * Förbered produkter för optimering
 * Filtrerar på:
 * - isOptimizable: om produkten är markerad som optimerbar (default: true)
 * - active: om produkten är aktiv/disponibel (default: true)
 * - Giltigt pris > 0
 * - Har minst ett näringsämne
 */
function prepareProducts(products: Product[]): PreparedProduct[] {
  return products
    .filter(p => {
      // Filtrera bort produkter som inte är optimerbara
      if (p.isOptimizable === false) return false;
      // Filtrera bort inaktiva produkter
      if (p.active === false) return false;
      // Måste ha id och positivt pris
      if (!p.id || p.pricePerKg === undefined || p.pricePerKg <= 0) return false;
      return true;
    })
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
  config: Required<AlgorithmConfigV7>
): WarningItemV7[] {
  const warnings: WarningItemV7[] = [];
  const highLevelThreshold = config.HIGH_LEVEL_THRESHOLD / 100;

  const checkWarning = (
    nutrient: 'N' | 'P' | 'K' | 'S', 
    must: boolean, 
    target: number, 
    achievedVal: number
  ) => {
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

/**
 * Beräkna summa absolut procentuell avvikelse för tie-break
 */
function calcTotalDeviation(
  achieved: { N: number; P: number; K: number; S: number },
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean }
): number {
  let totalDev = 0;
  
  if (mustFlags.mustN && (targets.N || 0) > 0) {
    totalDev += Math.abs(achieved.N - (targets.N || 0)) / (targets.N || 1);
  }
  if (mustFlags.mustP && (targets.P || 0) > 0) {
    totalDev += Math.abs(achieved.P - (targets.P || 0)) / (targets.P || 1);
  }
  if (mustFlags.mustK && (targets.K || 0) > 0) {
    totalDev += Math.abs(achieved.K - (targets.K || 0)) / (targets.K || 1);
  }
  if (mustFlags.mustS && (targets.S || 0) > 0) {
    totalDev += Math.abs(achieved.S - (targets.S || 0)) / (targets.S || 1);
  }
  
  return totalDev;
}

// ============================================================================
// VALIDERING
// ============================================================================

interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validera input enligt specifikation (punkt 3)
 */
function validateInput(
  input: OptimizeV7Input
): ValidationResult {
  const { targets, mustFlags } = input;
  
  // Minst ett ämne måste vara aktiverat
  const hasActiveNutrient = mustFlags.mustN || mustFlags.mustP || mustFlags.mustK || mustFlags.mustS;
  if (!hasActiveNutrient) {
    return {
      valid: false,
      message: 'Minst ett näringsämne måste vara aktiverat (mustN, mustP, mustK eller mustS)',
    };
  }
  
  // För varje aktiverat ämne: target >= 1
  if (mustFlags.mustN && (targets.N || 0) < 1) {
    return {
      valid: false,
      message: 'N är aktiverat men targetN < 1 kg/ha',
    };
  }
  if (mustFlags.mustP && (targets.P || 0) < 1) {
    return {
      valid: false,
      message: 'P är aktiverat men targetP < 1 kg/ha',
    };
  }
  if (mustFlags.mustK && (targets.K || 0) < 1) {
    return {
      valid: false,
      message: 'K är aktiverat men targetK < 1 kg/ha',
    };
  }
  if (mustFlags.mustS && (targets.S || 0) < 1) {
    return {
      valid: false,
      message: 'S är aktiverat men targetS < 1 kg/ha',
    };
  }
  
  return { valid: true };
}

// ============================================================================
// SINGLE NUTRIENT MODE (punkt 9)
// ============================================================================

/**
 * Single-nutrient mode: hitta bästa enskilda produkter
 * 
 * - Varje strategi = exakt 1 produkt
 * - Välj dos med minsta procentuella avvikelse mot target
 * - Rankas primärt på kostnad, sekundärt på avvikelse
 */
function solveSingleNutrient(
  products: PreparedProduct[],
  nutrient: 'N' | 'P' | 'K' | 'S',
  target: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  config: Required<AlgorithmConfigV7>,
  numStrategies: number
): SingleNutrientSolution[] {
  const nutrientKey = nutrient.toLowerCase() as 'n' | 'p' | 'k' | 's';

  // Beräkna tillåtet intervall
  let lower: number;
  let upper: number;

  if (nutrient === 'N') {
    lower = target;
  upper = target + nToleranceKg;
  } else {
    lower = (config.PKS_MIN_PCT / 100) * target;
    upper = (config.PKS_MAX_PCT / 100) * target;
  }

  const feasibleProducts: SingleNutrientSolution[] = [];

  for (const p of products) {
    const frac = p[nutrientKey];
    if (frac <= 0) continue;

    // Beräkna dos-intervall för att nå tillåtet näringsintervall
    let xMin = Math.ceil(lower / frac);
    let xMax = Math.floor(upper / frac);

    // Clampa till min/maxDose
    xMin = Math.max(xMin, minDose);
    xMax = Math.min(xMax, maxDose);

    if (xMin > xMax) continue; // Ingen feasible dos

    // Hitta dos med minsta avvikelse från exakt target
    // (inte bandgräns, utan target enligt specifikation)
    let bestDose = xMin;
    let bestDeviation = Infinity;
    
    for (let dose = xMin; dose <= xMax; dose++) {
      const achieved = dose * frac;
      const deviation = Math.abs(achieved - target) / target;
      if (deviation < bestDeviation) {
        bestDeviation = deviation;
        bestDose = dose;
      }
    }

    const cost = bestDose * p.price;
    const achieved = {
      N: Math.round(bestDose * p.n * 100) / 100,
      P: Math.round(bestDose * p.p * 100) / 100,
      K: Math.round(bestDose * p.k * 100) / 100,
      S: Math.round(bestDose * p.s * 100) / 100,
    };

    feasibleProducts.push({ 
      product: p, 
      dose: bestDose, 
      cost, 
      achieved,
      deviation: bestDeviation,
    });
  }

  // Sortera: primärt på kostnad, sekundärt på avvikelse (lägst först)
  feasibleProducts.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.deviation - b.deviation;
  });

  return feasibleProducts.slice(0, numStrategies);
}

// ============================================================================
// MILP SOLVER (HiGHS)
// ============================================================================

/**
 * Bygg och lös MILP-modell med HiGHS
 * 
 * Variabler:
 * - x_i: heltal, dos för produkt i
 * - y_i: binär, om produkt i används
 * 
 * Constraints:
 * - x_i >= minDose * y_i
 * - x_i <= maxDose * y_i
 * - sum(y_i) <= maxProducts
 * - näringsconstraints för aktiverade ämnen
 * - no-good cuts från tidigare strategier
 * - y_i = 1 för tvingade produkter
 */
async function solveMILP(
  highs: Highs,
  products: PreparedProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV7>,
  requiredProductIndices: number[] = []
): Promise<MILPSolution | null> {
  
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await solveMILPCore(
        highs, products, targets, mustFlags, maxProducts, minDose, maxDose, 
        nToleranceKg, noGoodCuts, config, requiredProductIndices
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const msg = lastError.message;
      const isWasmError = msg.includes('WASM') || 
                          msg.includes('null function') || 
                          msg.includes('Aborted');
      
      if (isWasmError && attempt < maxRetries) {
        log.debug(`HiGHS WASM error, retrying (${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      
      log.error('HiGHS solve error', lastError);
      return null;
    }
  }
  
  log.error(`HiGHS failed after ${maxRetries} attempts`, lastError);
  return null;
}

/**
 * Intern: Lös MILP-problem
 */
async function solveMILPCore(
  highs: Highs,
  products: PreparedProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV7>,
  requiredProductIndices: number[] = []
): Promise<MILPSolution | null> {

  const n = products.length;
  
  if (n === 0) return null;

  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;

  const pksMinRatio = config.PKS_MIN_PCT / 100;
  const pksMaxRatio = config.PKS_MAX_PCT / 100;

  // Bygg LP-fil i CPLEX LP-format
  let lp = '';
  
  // Objective: minimize cost (i öre för heltalsstabilitet)
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

  // Tvingade produkter: y_i = 1 för required products
  // Detta tvingar produkten att inkluderas i lösningen
  for (const reqIdx of requiredProductIndices) {
    if (reqIdx >= 0 && reqIdx < n) {
      lp += ` c${constraintIdx++}: y${reqIdx} = 1\n`;
    }
  }

  // N-constraint (om mustN=true)
  // N_ach = sum(x_i * n10_i) / 1000  (kg)
  // Skalat: targetN * 1000 <= sum(x_i * n10_i) <= (targetN + nToleranceKg) * 1000
  if (mustFlags.mustN && targetN > 0) {
    const nMin10 = Math.round(targetN * 1000);
    const nMax10 = Math.round((targetN + nToleranceKg) * 1000);
    
    const nTerms = products.map((p, i) => `${p.n10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${nTerms} >= ${nMin10}\n`;
    lp += ` c${constraintIdx++}: ${nTerms} <= ${nMax10}\n`;
  }

  // P-constraint (om mustP=true)
  if (mustFlags.mustP && targetP > 0) {
    const pMin10 = Math.ceil(pksMinRatio * targetP * 1000);
    const pMax10 = Math.floor(pksMaxRatio * targetP * 1000);
    
    const pTerms = products.map((p, i) => `${p.p10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${pTerms} >= ${pMin10}\n`;
    lp += ` c${constraintIdx++}: ${pTerms} <= ${pMax10}\n`;
  }

  // K-constraint (om mustK=true)
  if (mustFlags.mustK && targetK > 0) {
    const kMin10 = Math.ceil(pksMinRatio * targetK * 1000);
    const kMax10 = Math.floor(pksMaxRatio * targetK * 1000);
    
    const kTerms = products.map((p, i) => `${p.k10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${kTerms} >= ${kMin10}\n`;
    lp += ` c${constraintIdx++}: ${kTerms} <= ${kMax10}\n`;
  }

  // S-constraint (om mustS=true)
  if (mustFlags.mustS && targetS > 0) {
    const sMin10 = Math.ceil(pksMinRatio * targetS * 1000);
    const sMax10 = Math.floor(pksMaxRatio * targetS * 1000);
    
    const sTerms = products.map((p, i) => `${p.s10} x${i}`).join(' + ');
    lp += ` c${constraintIdx++}: ${sTerms} >= ${sMin10}\n`;
    lp += ` c${constraintIdx++}: ${sTerms} <= ${sMax10}\n`;
  }

  // No-good cuts: förbjud endast identiskt produkt-set (inte supersets)
  // Formell cut för tidigare set S = {i | y_i = 1}:
  //   sum_{i in S}(1 - y_i) + sum_{i not in S}(y_i) >= 1
  // Omskrivet (enkel standardform):
  //   sum_{i not in S} y_i - sum_{i in S} y_i >= 1 - |S|
  for (const prevY of noGoodCuts) {
    if (!prevY || prevY.length !== n) continue;

    const inSet: number[] = [];
    const notInSet: number[] = [];
    for (let i = 0; i < n; i++) {
      if (prevY[i] === 1) inSet.push(i);
      else notInSet.push(i);
    }

    // Om tidigare lösning är "tom" så finns inget att skilja sig från.
    if (inSet.length === 0) continue;

    const lhsTerms: string[] = [];
    for (const i of notInSet) lhsTerms.push(`y${i}`);
    for (const i of inSet) lhsTerms.push(`- y${i}`);

    const rhs = 1 - inSet.length;
    lp += ` c${constraintIdx++}: ${lhsTerms.join(' + ')} >= ${rhs}\n`;
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

  // Debug-loggning
  if (process.env.DEBUG_LP === '1') {
    log.debug('LP PROBLEM:\n' + lp.slice(0, 2000) + '...');
  }

  // Lös med HiGHS
  let result: HighsSolution | { Status: string; Columns: Record<string, { Primal: number }>; ObjectiveValue: number };
  
  // Använd worker pool om aktiverat och inte för många fel
  const usePool = USE_WORKER_POOL && workerPool && !shouldUseFallback();
  
  if (usePool) {
    // Använd worker pool för isolering (förhindrar WASM-krascher)
    const poolResult = await solveLPViaPool(lp);
    if (!poolResult) {
      // Pool misslyckades - returnera null, caller kan retry
      return null;
    }
    // Konvertera från pool-format till HiGHS-format
    result = {
      Status: poolResult.status,
      Columns: poolResult.columns,
      ObjectiveValue: poolResult.objectiveValue ?? 0,
    };
  } else {
    // Fallback: direkt HiGHS (kan krascha WASM men snabbare)
    if (shouldUseFallback()) {
      log.warn('Using inline HiGHS fallback due to pool errors');
    }
    try {
      result = highs.solve(lp);
      incrementSolveCount();
    } catch (wasmError) {
      log.error('HiGHS WASM error during solve', wasmError instanceof Error ? wasmError : new Error(String(wasmError)));
      resetHighsOnError();
      throw wasmError; // Låt caller hantera retry
    }
  }
  
  if (result.Status !== 'Optimal') {
    log.debug(`HiGHS status: ${result.Status}`);
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
    cost: totalCostOre / 100, // Öre -> SEK
    achieved: {
      N: Math.round(nAch10 / 10) / 100, // Konvertera från skalat format
      P: Math.round(pAch10 / 10) / 100,
      K: Math.round(kAch10 / 10) / 100,
      S: Math.round(sAch10 / 10) / 100,
    },
  };
}

/**
 * Extrahera y-vektor (vilka produkter som användes)
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

// OBS: Inga heuristiska caps på kandidatprodukter i v7.
// Spec-krav: MILP ska köras på alla optimeringsbara produkter för att inte riskera att missa optimum.

/**
 * Optimera gödselstrategi med MILP (v7)
 * 
 * Fullständig implementation av specifikationen med:
 * - Validering (punkt 3)
 * - Single nutrient mode (punkt 9)
 * - N-tolerans eskalering (punkt 8)
 * - Prispall med 3 strategier (punkt 10)
 * - Warnings för ej aktiverade ämnen (punkt 11)
 */
export async function optimizeV7(
  products: Product[],
  input: OptimizeV7Input
): Promise<OptimizeV7Output> {
  
  const startTime = Date.now();
  const { targets, mustFlags, maxProductsUser, minDoseKgHa, maxDoseKgHa } = input;
  
  // Merge config med defaults
  const config: Required<AlgorithmConfigV7> = {
    ...DEFAULT_ALGORITHM_CONFIG_V7,
    ...input.config,
  };
  
  // Hård cap: max 4 produkter
  const effectiveHardCap = Math.min(4, config.MAX_PRODUCTS_HARD);
  const numStrategies = config.NUM_STRATEGIES;
  
  // ──────────────────────────────────────────────────────────────────────────
  // VALIDERING (punkt 3)
  // ──────────────────────────────────────────────────────────────────────────
  const validation = validateInput(input);
  if (!validation.valid) {
    return {
      status: 'infeasible',
      usedMaxProducts: 0,
      strategies: [],
      message: validation.message,
    };
  }
  
  // Förbered produkter
  const preparedProducts = prepareProducts(products);
  
  if (preparedProducts.length === 0) {
    return {
      status: 'infeasible',
      usedMaxProducts: maxProductsUser,
      strategies: [],
      message: 'Inga optimerbara produkter tillgängliga',
    };
  }
  
  // ──────────────────────────────────────────────────────────────────────────
  // TVINGADE PRODUKTER - Konvertera ID:n till index
  // ──────────────────────────────────────────────────────────────────────────
  const requiredProductIds = input.requiredProductIds || [];
  const requiredProductIndices: number[] = [];
  
  if (requiredProductIds.length > 0) {
    // Bygg lookup-map för snabb sökning
    const productIdToIndex = new Map<string, number>();
    preparedProducts.forEach((p, idx) => productIdToIndex.set(p.id, idx));
    
    for (const reqId of requiredProductIds) {
      const idx = productIdToIndex.get(reqId);
      if (idx !== undefined) {
        requiredProductIndices.push(idx);
      } else {
        log.warn(`Tvingad produkt ${reqId} hittades inte bland optimerbara produkter`);
      }
    }
    
    // Validera att inte för många produkter tvingas
    if (requiredProductIndices.length > maxProductsUser) {
      return {
        status: 'infeasible',
        usedMaxProducts: maxProductsUser,
        strategies: [],
        message: `Antal tvingade produkter (${requiredProductIndices.length}) överstiger maxProducts (${maxProductsUser})`,
      };
    }
    
    log.debug(`Tvingade produkter: ${requiredProductIndices.length} st (${requiredProductIds.join(', ')})`);
  }
  
  // Ingen trimning av produktlistan här.

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
  // SINGLE NUTRIENT MODE (punkt 9)
  // Hoppa över om det finns tvingade produkter - de kräver MILP-constraints
  // ──────────────────────────────────────────────────────────────────────────
  if (activeCount === 1 && requiredProductIndices.length === 0) {
    const nutrient = activeNutrients[0];
    const target = nutrient === 'N' ? targetN : 
                   nutrient === 'P' ? targetP : 
                   nutrient === 'K' ? targetK : targetS;
    
    log.debug(`Single nutrient mode: ${nutrient} = ${target} kg/ha`);
    
    const singleSolutions = solveSingleNutrient(
      preparedProducts,
      nutrient,
      target,
      minDoseKgHa,
      maxDoseKgHa,
      config.N_TOLERANCE_KG,
      config,
      numStrategies
    );

    if (singleSolutions.length > 0) {
      const strategies: StrategyResultV7[] = singleSolutions.map((sol, idx) => ({
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
        nToleranceUsed: nutrient === 'N' ? config.N_TOLERANCE_KG : null,
      }));

      log.optimize(`Single nutrient: ${strategies.length} strategier, tid: ${Date.now() - startTime}ms`);

      return {
        status: 'ok',
        usedMaxProducts: 1,
        strategies,
        nToleranceUsed: nutrient === 'N' ? config.N_TOLERANCE_KG : undefined,
      };
    }

    // Fallback till MILP om ingen single-produkt funkar
    log.debug('Single nutrient fallback till MILP');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MILP MODE (activeCount >= 2 eller single-nutrient fallback)
  // ──────────────────────────────────────────────────────────────────────────
  
  log.debug(`MILP mode: ${activeNutrients.join(', ')}`);
  
  // Söklogik: prova maxProductsUser, autoöka till effectiveHardCap
  // Om mustN=true: eskalera N-tolerans vid behov
  
  let solution: MILPSolution | null = null;
  let usedMaxProducts = Math.min(maxProductsUser, effectiveHardCap);
  let usedNTolerance = config.N_TOLERANCE_KG;

  // Skapa HiGHS-instans (återanvänds, återskapas vid WASM-fel)
  let highs = await getHighsSolver();
  
  // Yttre loop: N-tolerans eskalering (punkt 8)
  // Spec: starta på config.N_TOLERANCE_KG (default 1) och eskalera ett steg upp till 5.
  const nTolStart = Math.max(1, Math.floor(config.N_TOLERANCE_KG || 1));
  const nTolMax = Math.min(5, Math.floor(config.N_MAX_TOLERANCE_KG || 5));
  const nTolerances = mustFlags.mustN
    ? Array.from({ length: Math.max(0, nTolMax - nTolStart + 1) }, (_, i) => nTolStart + i)
    : [nTolStart]; // Om N inte är aktiverat: kör exakt en gång (värdet spelar ingen roll för constraints)
  
  outerLoop:
  for (const nTol of nTolerances) {
    usedNTolerance = nTol;
    
    // Timeout-check
    if (Date.now() - startTime > config.TIMEOUT_MS) {
      log.warn('Timeout nådd');
      break;
    }
    
    // Inre loop: autoökning av maxProducts (punkt 7)
    for (let mp = Math.min(maxProductsUser, effectiveHardCap); mp <= effectiveHardCap; mp++) {
      usedMaxProducts = mp;
      
      // Retry-logik för WASM-krascher
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        try {
          solution = await solveMILP(
            highs,
            preparedProducts,
            targets,
            mustFlags,
            mp,
            minDoseKgHa,
            maxDoseKgHa,
            nTol,
            [],
            config,
            requiredProductIndices
          );
          break; // Lyckades, avbryt retry-loop
        } catch {
          retryCount++;
          if (retryCount <= maxRetries) {
            log.debug(`WASM error, retry ${retryCount}/${maxRetries} with fresh HiGHS instance...`);
            // getHighsSolver returnerar ny instans efter resetHighsOnError()
            highs = await getHighsSolver(true);
          } else {
            log.error('Max retries reached, giving up on this solve');
            solution = null;
          }
        }
      }

      if (solution) {
        log.optimize(`Lösning hittad: maxProducts=${mp}, nTolerance=${nTol}`);
        break outerLoop;
      }
    }
    
    if (mustFlags.mustN) {
      log.debug(`Ingen lösning med N-tolerans +${nTol}, provar +${nTol + 1}...`);
    }
  }

  if (!solution) {
    return {
      status: 'infeasible',
      usedMaxProducts: effectiveHardCap,
      strategies: [],
      message: `Ingen lösning hittades med upp till ${effectiveHardCap} produkter` + 
               (mustFlags.mustN ? ` och N-tolerans upp till +${config.N_MAX_TOLERANCE_KG}` : '') +
               `. Givor: ${minDoseKgHa}–${maxDoseKgHa} kg/ha.`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BYGG PRISPALL (punkt 10) - 3 strategier via no-good cuts
  // ──────────────────────────────────────────────────────────────────────────
  
  const strategies: StrategyResultV7[] = [];
  const noGoodCuts: number[][] = [];

  // Strategi 1
  strategies.push(buildStrategyResult(solution, 1, targets, mustFlags, config, usedNTolerance));
  noGoodCuts.push(extractYVector(solution, preparedProducts));

  // Hjälpfunktion för säker solveMILP med retry
  async function safeSolveMILP(noGoods: number[][]): Promise<MILPSolution | null> {
    for (let retry = 0; retry <= 1; retry++) {
      try {
        return await solveMILP(
          highs, preparedProducts, targets, mustFlags, usedMaxProducts, 
          minDoseKgHa, maxDoseKgHa, usedNTolerance, noGoods, config,
          requiredProductIndices
        );
      } catch {
        if (retry === 0) {
          log.debug('WASM error in strategy solve, retrying...');
          highs = await getHighsSolver(true);
        }
      }
    }
    return null;
  }

  // Strategi 2 (om numStrategies >= 2)
  if (numStrategies >= 2) {
    const solution2 = await safeSolveMILP(noGoodCuts);

    if (solution2) {
      strategies.push(buildStrategyResult(solution2, 2, targets, mustFlags, config, usedNTolerance));
      noGoodCuts.push(extractYVector(solution2, preparedProducts));

      // Strategi 3 (om numStrategies >= 3)
      if (numStrategies >= 3) {
        const solution3 = await safeSolveMILP(noGoodCuts);

        if (solution3) {
          strategies.push(buildStrategyResult(solution3, 3, targets, mustFlags, config, usedNTolerance));
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FALLBACK: Generera syntetiska alternativ om vi inte har tillräckligt
  // ──────────────────────────────────────────────────────────────────────────
  if (strategies.length < numStrategies && strategies.length > 0) {
    log.debug(`Endast ${strategies.length}/${numStrategies} strategier, genererar fallback-alternativ...`);
    
    // Basera fallback på första strategin men med dosvariation
    const baseStrategy = strategies[0];
    const doseVariations = [1.05, 0.95, 1.10, 0.90]; // 5% och 10% variation
    
    for (let i = 0; i < doseVariations.length && strategies.length < numStrategies; i++) {
      const variation = doseVariations[i];
      const variedProducts: ProductAllocationV7[] = baseStrategy.products.map(p => ({
        ...p,
        doseKgHa: Math.round(Math.min(maxDoseKgHa, Math.max(minDoseKgHa, p.doseKgHa * variation))),
        costSekHa: 0, // Beräknas nedan
      }));

      // Beräkna nya kostnader och uppnådda värden
      let totalCost = 0;
      const achieved = { N: 0, P: 0, K: 0, S: 0 };
      
      for (const vp of variedProducts) {
        const originalProduct = preparedProducts.find(pp => pp.artikelnr === vp.artikelnr);
        if (originalProduct) {
          vp.costSekHa = Math.round(vp.doseKgHa * originalProduct.price * 100) / 100;
          totalCost += vp.costSekHa;
          // PreparedProduct har n, p, k, s som fraktioner (0-1)
          achieved.N += vp.doseKgHa * originalProduct.n;
          achieved.P += vp.doseKgHa * originalProduct.p;
          achieved.K += vp.doseKgHa * originalProduct.k;
          achieved.S += vp.doseKgHa * originalProduct.s;
        }
      }

      // Avrunda achieved-värden
      achieved.N = Math.round(achieved.N * 10) / 10;
      achieved.P = Math.round(achieved.P * 10) / 10;
      achieved.K = Math.round(achieved.K * 10) / 10;
      achieved.S = Math.round(achieved.S * 10) / 10;

      // Kontrollera att lösningen fortfarande uppfyller kraven (något tolerant)
      const toleranceFactor = 0.85; // Tillåt 15% underskridande
      const meetsRequirements = 
        (!mustFlags.mustN || achieved.N >= (targets.N || 0) * toleranceFactor) &&
        (!mustFlags.mustP || achieved.P >= (targets.P || 0) * toleranceFactor) &&
        (!mustFlags.mustK || achieved.K >= (targets.K || 0) * toleranceFactor) &&
        (!mustFlags.mustS || achieved.S >= (targets.S || 0) * toleranceFactor);

      if (meetsRequirements) {
        const fallbackStrategy: StrategyResultV7 = {
          rank: strategies.length + 1,
          totalCostSekHa: Math.round(totalCost * 100) / 100,
          products: variedProducts,
          achieved,
          percentOfTarget: {
            N: calcPercentOfTarget(achieved.N, targets.N || 0),
            P: calcPercentOfTarget(achieved.P, targets.P || 0),
            K: calcPercentOfTarget(achieved.K, targets.K || 0),
            S: calcPercentOfTarget(achieved.S, targets.S || 0),
          },
          mustFlags: {
            N: mustFlags.mustN,
            P: mustFlags.mustP,
            K: mustFlags.mustK,
            S: mustFlags.mustS,
          },
          warnings: generateWarnings(achieved, targets, mustFlags, config),
          nToleranceUsed: usedNTolerance,
        };
        
        strategies.push(fallbackStrategy);
        log.debug(`Fallback-strategi ${strategies.length} genererad (${variation > 1 ? '+' : ''}${Math.round((variation - 1) * 100)}% dos)`);
      }
    }
  }

  // Sortera strategier för tie-break (punkt 10)
  strategies.sort((a, b) => {
    // Primärt: kostnad
    if (a.totalCostSekHa !== b.totalCostSekHa) {
      return a.totalCostSekHa - b.totalCostSekHa;
    }
    // Sekundärt: summa absolut avvikelse
    const devA = calcTotalDeviation(a.achieved, targets, mustFlags);
    const devB = calcTotalDeviation(b.achieved, targets, mustFlags);
    if (devA !== devB) {
      return devA - devB;
    }
    // Tertiärt: färre produkter
    return a.products.length - b.products.length;
  });
  
  // Uppdatera rank efter sortering
  strategies.forEach((s, i) => s.rank = i + 1);

  log.optimize(`Klar: ${strategies.length} strategier, tid: ${Date.now() - startTime}ms`);

  return {
    status: 'ok',
    usedMaxProducts,
    strategies,
    nToleranceUsed: mustFlags.mustN ? usedNTolerance : undefined,
  };
}

/**
 * Bygg StrategyResultV7 från MILPSolution
 */
function buildStrategyResult(
  solution: MILPSolution,
  rank: number,
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV7>,
  nToleranceUsed: number
): StrategyResultV7 {
  
  const products: ProductAllocationV7[] = solution.products.map(pd => ({
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
    nToleranceUsed: mustFlags.mustN ? nToleranceUsed : null,
  };
}

// ============================================================================
// ADAPTER FÖR BEFINTLIG API (kompatibel med Solution-format)
// ============================================================================

/**
 * Adapter för att använda optimize-v7 med befintlig Solution-typ
 */
export async function optimizeV7ToSolutions(
  products: Product[],
  need: NutrientNeed,
  options: {
    maxProducts?: number;
    requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
    minDose?: number;
    maxDose?: number;
    config?: AlgorithmConfigV7;
    requiredProductIds?: string[];
  } = {}
): Promise<Solution[]> {
  
  const requiredNutrients = options.requiredNutrients || [];
  
  const input: OptimizeV7Input = {
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
    requiredProductIds: options.requiredProductIds,
  };

  const result = await optimizeV7(products, input);

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
    notes: [
      ...strategy.warnings.map(w => 
        `Varning: ${w.nutrient} är ${Math.round(w.ratio * 100)}% av behov (${w.valueKgHa} kg/ha)`
      ),
      ...(strategy.nToleranceUsed && strategy.nToleranceUsed > 1 
        ? [`N-tolerans: +${strategy.nToleranceUsed} kg/ha användes`] 
        : []),
    ],
  }));
}

// ============================================================================
// CLEANUP VID PROCESS-AVSLUT
// ============================================================================

// NOTE: Cleanup handlers moved to server.ts to avoid conflicts
// Worker pool cleanup sker automatiskt när processen avslutas

export default optimizeV7;
