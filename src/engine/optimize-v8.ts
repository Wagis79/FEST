/**
 * FEST Gödseloptimering v8 - Strikt MILP med HiGHS
 * 
 * FÖRBÄTTRINGAR FRÅN V7:
 * 1. Striktare constraint-formulering för bättre konvergens
 * 2. Förbättrad numerisk skalning (alla värden i heltalsdomän)
 * 3. Tydligare separation av constraint-byggande
 * 4. Bättre validering av input och output
 * 
 * SPECIFIKATION:
 * 
 * 1. SYFTE: Minimera kostnad (SEK/ha) för gödselstrategi som uppfyller näringskrav
 * 
 * 2. MODELL (MILP):
 *    - Variabler: x_i (heltal, dos i kg/ha), y_i (binär, om produkt används)
 *    - Mål: min Σ(pris_i * x_i)
 *    - Constraints:
 *      * Dos-koppling: minDos * y_i ≤ x_i ≤ maxDos * y_i
 *      * Max produkter: Σy_i ≤ maxProducts
 *      * Näringsconstraints (endast för aktiverade ämnen)
 * 
 * 3. NÄRINGSLOGIK:
 *    - N (om mustN=true): targetN ≤ achieved ≤ targetN + tolerans
 *    - P/K/S (om must=true): minPct% ≤ achieved/target ≤ maxPct%
 *    - Ej aktiverade ämnen: inga constraints (men varningar om >150%)
 * 
 * 4. N-TOLERANS ESKALERING:
 *    - Startar med config.N_TOLERANCE_KG
 *    - Eskalerar +1 kg/ha åt gången upp till N_MAX_TOLERANCE_KG
 * 
 * 5. PRISPALL (3 strategier):
 *    - Använder no-good cuts för att exkludera tidigare produktuppsättningar
 * 
 * 6. SINGLE NUTRIENT MODE:
 *    - Om exakt ett ämne aktiverat: rankar enskilda produkter
 */

import { Product } from '../models/Product';
import { NutrientNeed } from '../models/NutrientNeed';
import { Solution } from '../models/Solution';

// ============================================================================
// TYPER
// ============================================================================

export interface OptimizeV8Input {
  targets: NutrientNeed;
  mustFlags: {
    mustN: boolean;
    mustP: boolean;
    mustK: boolean;
    mustS: boolean;
  };
  maxProductsUser: number;
  minDoseKgHa: number;
  maxDoseKgHa: number;
  config?: AlgorithmConfigV8;
}

export interface AlgorithmConfigV8 {
  N_TOLERANCE_KG?: number;
  N_MAX_TOLERANCE_KG?: number;
  PKS_MIN_PCT?: number;
  PKS_MAX_PCT?: number;
  HIGH_LEVEL_THRESHOLD?: number;
  MAX_PRODUCTS_HARD?: number;
  NUM_STRATEGIES?: number;
  TIMEOUT_MS?: number;
}

export const DEFAULT_CONFIG_V8: Required<AlgorithmConfigV8> = {
  N_TOLERANCE_KG: 1,
  N_MAX_TOLERANCE_KG: 5,
  PKS_MIN_PCT: 85,
  PKS_MAX_PCT: 125,
  HIGH_LEVEL_THRESHOLD: 150,
  MAX_PRODUCTS_HARD: 4,
  NUM_STRATEGIES: 3,
  TIMEOUT_MS: 30000,
};

export interface ProductAllocationV8 {
  artikelnr: number;
  produkt: string;
  doseKgHa: number;
  costSekHa: number;
}

export interface WarningItemV8 {
  nutrient: 'N' | 'P' | 'K' | 'S';
  type: 'HIGH_LEVEL';
  threshold: number;
  valueKgHa: number;
  ratio: number;
}

export interface StrategyResultV8 {
  rank: number;
  totalCostSekHa: number;
  products: ProductAllocationV8[];
  achieved: { N: number; P: number; K: number; S: number };
  percentOfTarget: { N: number | null; P: number | null; K: number | null; S: number | null };
  mustFlags: { N: boolean; P: boolean; K: boolean; S: boolean };
  warnings: WarningItemV8[];
  nToleranceUsed: number | null;
}

export interface OptimizeV8Output {
  status: 'ok' | 'infeasible';
  usedMaxProducts: number;
  strategies: StrategyResultV8[];
  message?: string;
  nToleranceUsed?: number;
}

// ============================================================================
// INTERNA TYPER
// ============================================================================

/** Skalad produkt för numerisk stabilitet */
interface ScaledProduct {
  id: string;
  artikelnr: number;
  name: string;
  /** Pris i öre/kg (heltal) */
  priceOre: number;
  /** Näringsinnehåll skalat * 1000 (N% * 1000 -> ex 15.5% = 15500) */
  n1000: number;
  p1000: number;
  k1000: number;
  s1000: number;
  /** Ursprungliga fraktioner (för beräkningar) */
  nFrac: number;
  pFrac: number;
  kFrac: number;
  sFrac: number;
}

interface MILPResult {
  status: 'optimal' | 'infeasible' | 'error';
  products: Array<{ product: ScaledProduct; dose: number }>;
  costSek: number;
  achieved: { N: number; P: number; K: number; S: number };
}

// ============================================================================
// SKALNING OCH FÖRBEREDELSE
// ============================================================================

/**
 * Konvertera Product[] till ScaledProduct[] med heltalsskalning
 */
function scaleProducts(products: Product[]): ScaledProduct[] {
  return products
    .filter(p => p.id && p.pricePerKg !== undefined && p.pricePerKg > 0)
    .map(p => {
      const nPct = p.nutrients.N || 0;
      const pPct = p.nutrients.P || 0;
      const kPct = p.nutrients.K || 0;
      const sPct = p.nutrients.S || 0;

      return {
        id: p.id,
        artikelnr: parseInt(p.id.replace('prod-', '')) || 0,
        name: p.name,
        priceOre: Math.round((p.pricePerKg || 0) * 100),
        n1000: Math.round(nPct * 1000),
        p1000: Math.round(pPct * 1000),
        k1000: Math.round(kPct * 1000),
        s1000: Math.round(sPct * 1000),
        nFrac: nPct / 100,
        pFrac: pPct / 100,
        kFrac: kPct / 100,
        sFrac: sPct / 100,
      };
    })
    .filter(p => p.n1000 > 0 || p.p1000 > 0 || p.k1000 > 0 || p.s1000 > 0);
}

// ============================================================================
// HIGHS SOLVER
// ============================================================================

let solverInstanceV8: any = null;
let instanceCounter = 0;

/**
 * Hämta HiGHS-instans (skapar ny varje gång för att undvika konflikter)
 * 
 * OBS: Vi skapar ny instans för varje anrop till optimizeV8 eftersom
 * HiGHS WASM-instanser kan korrupteras vid parallell användning.
 */
async function getHiGHS(forceNew: boolean = false): Promise<any> {
  if (solverInstanceV8 && !forceNew) {
    return solverInstanceV8;
  }
  
  instanceCounter++;
  console.log(`[v8] Loading HiGHS solver (instance #${instanceCounter})...`);
  const highsModule = await import('highs');
  const loader = highsModule.default || highsModule;
  solverInstanceV8 = await loader({});
  console.log('[v8] ✅ HiGHS ready');
  return solverInstanceV8;
}

/**
 * Återställ solver-instansen (anropas i början av optimizeV8)
 */
function resetSolverInstance(): void {
  solverInstanceV8 = null;
}

// ============================================================================
// CONSTRAINT BUILDERS
// ============================================================================

interface ConstraintSet {
  constraints: string[];
  nextIdx: number;
}

/**
 * Bygg dos-koppling constraints
 * x_i - minDos * y_i >= 0  (om y_i = 1, då x_i >= minDos)
 * x_i - maxDos * y_i <= 0  (om y_i = 0, då x_i = 0)
 */
function buildDoseConstraints(
  n: number,
  minDose: number,
  maxDose: number,
  startIdx: number
): ConstraintSet {
  const constraints: string[] = [];
  let idx = startIdx;

  for (let i = 0; i < n; i++) {
    // x_i >= minDose * y_i  =>  x_i - minDose*y_i >= 0
    constraints.push(`c${idx++}: x${i} - ${minDose} y${i} >= 0`);
    // x_i <= maxDose * y_i  =>  x_i - maxDose*y_i <= 0
    constraints.push(`c${idx++}: x${i} - ${maxDose} y${i} <= 0`);
  }

  return { constraints, nextIdx: idx };
}

/**
 * Bygg max-produkter constraint
 * Σy_i <= maxProducts
 */
function buildMaxProductsConstraint(
  n: number,
  maxProducts: number,
  startIdx: number
): ConstraintSet {
  const yTerms = Array.from({ length: n }, (_, i) => `y${i}`).join(' + ');
  return {
    constraints: [`c${startIdx}: ${yTerms} <= ${maxProducts}`],
    nextIdx: startIdx + 1,
  };
}

/**
 * Bygg N-constraint (strikt intervall)
 * targetN * SCALE <= Σ(x_i * n1000_i) <= (targetN + tolerans) * SCALE
 * 
 * Skalning: n1000 = N% * 1000, så x * n1000 / 100000 = kg N
 * Vi multiplicerar target med 100000 för att matcha
 */
function buildNConstraint(
  products: ScaledProduct[],
  targetN: number,
  toleranceKg: number,
  startIdx: number
): ConstraintSet {
  const SCALE = 100000; // n1000/100 = N%, N%*x/100 = kg, så n1000*x/100000 = kg
  
  const nTerms = products.map((p, i) => `${p.n1000} x${i}`).join(' + ');
  const lowerBound = Math.round(targetN * SCALE);
  const upperBound = Math.round((targetN + toleranceKg) * SCALE);

  return {
    constraints: [
      `c${startIdx}: ${nTerms} >= ${lowerBound}`,
      `c${startIdx + 1}: ${nTerms} <= ${upperBound}`,
    ],
    nextIdx: startIdx + 2,
  };
}

/**
 * Bygg PKS-constraint (procentuellt intervall)
 * minPct% * target <= achieved <= maxPct% * target
 */
function buildPKSConstraint(
  products: ScaledProduct[],
  nutrient: 'P' | 'K' | 'S',
  target: number,
  minPct: number,
  maxPct: number,
  startIdx: number
): ConstraintSet {
  const SCALE = 100000;
  
  const key = `${nutrient.toLowerCase()}1000` as 'p1000' | 'k1000' | 's1000';
  const terms = products.map((p, i) => `${p[key]} x${i}`).join(' + ');
  
  const lowerBound = Math.round((minPct / 100) * target * SCALE);
  const upperBound = Math.round((maxPct / 100) * target * SCALE);

  return {
    constraints: [
      `c${startIdx}: ${terms} >= ${lowerBound}`,
      `c${startIdx + 1}: ${terms} <= ${upperBound}`,
    ],
    nextIdx: startIdx + 2,
  };
}

/**
 * Bygg no-good cut för att exkludera tidigare produktuppsättning
 * 
 * För set S = {i | y_i = 1 i tidigare lösning}:
 * Minst en produkt måste vara annorlunda
 * 
 * Formulering: Σ_{i ∈ S} (1 - y_i) + Σ_{i ∉ S} y_i >= 1
 * Omskrivet: Σ_{i ∉ S} y_i - Σ_{i ∈ S} y_i >= 1 - |S|
 */
function buildNoGoodCut(
  previousY: number[],
  n: number,
  startIdx: number
): ConstraintSet {
  const inSet: number[] = [];
  const notInSet: number[] = [];
  
  for (let i = 0; i < n; i++) {
    if (previousY[i] === 1) {
      inSet.push(i);
    } else {
      notInSet.push(i);
    }
  }

  if (inSet.length === 0) {
    return { constraints: [], nextIdx: startIdx };
  }

  const terms: string[] = [];
  for (const i of notInSet) terms.push(`y${i}`);
  for (const i of inSet) terms.push(`- y${i}`);
  
  const rhs = 1 - inSet.length;
  
  return {
    constraints: [`c${startIdx}: ${terms.join(' + ')} >= ${rhs}`],
    nextIdx: startIdx + 1,
  };
}

// ============================================================================
// LP BUILDER
// ============================================================================

interface LPProblem {
  lpString: string;
  numProducts: number;
}

/**
 * Bygg komplett LP-problem i CPLEX-format
 */
function buildLPProblem(
  products: ScaledProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV8>
): LPProblem {
  const n = products.length;
  const allConstraints: string[] = [];
  let constraintIdx = 0;

  // === OBJECTIVE ===
  // Minimize cost (i öre för heltalsstabilitet)
  const objTerms = products.map((p, i) => `${p.priceOre} x${i}`).join(' + ');

  // === CONSTRAINTS ===
  
  // 1. Dos-koppling
  const doseResult = buildDoseConstraints(n, minDose, maxDose, constraintIdx);
  allConstraints.push(...doseResult.constraints);
  constraintIdx = doseResult.nextIdx;

  // 2. Max produkter
  const maxProdResult = buildMaxProductsConstraint(n, maxProducts, constraintIdx);
  allConstraints.push(...maxProdResult.constraints);
  constraintIdx = maxProdResult.nextIdx;

  // 3. Näringsconstraints (endast för aktiverade ämnen)
  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;

  if (mustFlags.mustN && targetN > 0) {
    const nResult = buildNConstraint(products, targetN, nToleranceKg, constraintIdx);
    allConstraints.push(...nResult.constraints);
    constraintIdx = nResult.nextIdx;
  }

  if (mustFlags.mustP && targetP > 0) {
    const pResult = buildPKSConstraint(
      products, 'P', targetP, config.PKS_MIN_PCT, config.PKS_MAX_PCT, constraintIdx
    );
    allConstraints.push(...pResult.constraints);
    constraintIdx = pResult.nextIdx;
  }

  if (mustFlags.mustK && targetK > 0) {
    const kResult = buildPKSConstraint(
      products, 'K', targetK, config.PKS_MIN_PCT, config.PKS_MAX_PCT, constraintIdx
    );
    allConstraints.push(...kResult.constraints);
    constraintIdx = kResult.nextIdx;
  }

  if (mustFlags.mustS && targetS > 0) {
    const sResult = buildPKSConstraint(
      products, 'S', targetS, config.PKS_MIN_PCT, config.PKS_MAX_PCT, constraintIdx
    );
    allConstraints.push(...sResult.constraints);
    constraintIdx = sResult.nextIdx;
  }

  // 4. No-good cuts
  for (const prevY of noGoodCuts) {
    if (prevY && prevY.length === n) {
      const cutResult = buildNoGoodCut(prevY, n, constraintIdx);
      allConstraints.push(...cutResult.constraints);
      constraintIdx = cutResult.nextIdx;
    }
  }

  // === BOUNDS ===
  const bounds: string[] = [];
  for (let i = 0; i < n; i++) {
    bounds.push(`0 <= x${i} <= ${maxDose}`);
    bounds.push(`0 <= y${i} <= 1`);
  }

  // === VARIABLE TYPES ===
  const generals = products.map((_, i) => `x${i}`);
  const binaries = products.map((_, i) => `y${i}`);

  // === ASSEMBLE LP ===
  const lp = [
    'Minimize',
    ` obj: ${objTerms}`,
    'Subject To',
    ...allConstraints.map(c => ` ${c}`),
    'Bounds',
    ...bounds.map(b => ` ${b}`),
    'General',
    ...generals.map(g => ` ${g}`),
    'Binary',
    ...binaries.map(b => ` ${b}`),
    'End',
  ].join('\n');

  return { lpString: lp, numProducts: n };
}

// ============================================================================
// MILP SOLVER
// ============================================================================

/**
 * Lös MILP-problem med HiGHS
 */
async function solveMILP(
  products: ScaledProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  noGoodCuts: number[][],
  config: Required<AlgorithmConfigV8>
): Promise<MILPResult> {
  
  if (products.length === 0) {
    return { status: 'infeasible', products: [], costSek: 0, achieved: { N: 0, P: 0, K: 0, S: 0 } };
  }

  const { lpString, numProducts } = buildLPProblem(
    products, targets, mustFlags, maxProducts, minDose, maxDose,
    nToleranceKg, noGoodCuts, config
  );

  if (process.env.DEBUG_LP === '1') {
    console.log('[v8] LP Problem:\n' + lpString.slice(0, 3000));
  }

  try {
    const highs = await getHiGHS();
    const result = highs.solve(lpString);

    if (result.Status !== 'Optimal') {
      console.log(`[v8] HiGHS status: ${result.Status}`);
      return { status: 'infeasible', products: [], costSek: 0, achieved: { N: 0, P: 0, K: 0, S: 0 } };
    }

    // Extrahera lösning
    const selectedProducts: Array<{ product: ScaledProduct; dose: number }> = [];
    let totalCostOre = 0;
    let nAch = 0, pAch = 0, kAch = 0, sAch = 0;

    for (let i = 0; i < numProducts; i++) {
      const xVal = Math.round(result.Columns[`x${i}`]?.Primal || 0);
      
      if (xVal > 0) {
        const p = products[i];
        selectedProducts.push({ product: p, dose: xVal });
        
        totalCostOre += xVal * p.priceOre;
        nAch += xVal * p.nFrac;
        pAch += xVal * p.pFrac;
        kAch += xVal * p.kFrac;
        sAch += xVal * p.sFrac;
      }
    }

    if (selectedProducts.length === 0) {
      return { status: 'infeasible', products: [], costSek: 0, achieved: { N: 0, P: 0, K: 0, S: 0 } };
    }

    return {
      status: 'optimal',
      products: selectedProducts,
      costSek: totalCostOre / 100,
      achieved: {
        N: Math.round(nAch * 100) / 100,
        P: Math.round(pAch * 100) / 100,
        K: Math.round(kAch * 100) / 100,
        S: Math.round(sAch * 100) / 100,
      },
    };

  } catch (error: any) {
    console.error('[v8] HiGHS error:', error?.message || error);
    return { status: 'error', products: [], costSek: 0, achieved: { N: 0, P: 0, K: 0, S: 0 } };
  }
}

// ============================================================================
// SINGLE NUTRIENT MODE
// ============================================================================

interface SingleProductSolution {
  product: ScaledProduct;
  dose: number;
  cost: number;
  achieved: { N: number; P: number; K: number; S: number };
  deviation: number;
}

/**
 * Single nutrient mode: hitta bästa enskilda produkter för ett ämne
 */
function solveSingleNutrient(
  products: ScaledProduct[],
  nutrient: 'N' | 'P' | 'K' | 'S',
  target: number,
  minDose: number,
  maxDose: number,
  nToleranceKg: number,
  config: Required<AlgorithmConfigV8>,
  numStrategies: number
): SingleProductSolution[] {
  
  const fracKey = `${nutrient.toLowerCase()}Frac` as 'nFrac' | 'pFrac' | 'kFrac' | 'sFrac';

  // Beräkna tillåtet intervall
  let lower: number, upper: number;
  if (nutrient === 'N') {
    lower = target;
    upper = target + nToleranceKg;
  } else {
    lower = (config.PKS_MIN_PCT / 100) * target;
    upper = (config.PKS_MAX_PCT / 100) * target;
  }

  const solutions: SingleProductSolution[] = [];

  for (const p of products) {
    const frac = p[fracKey];
    if (frac <= 0) continue;

    // Beräkna dos-intervall för att nå tillåtet näringsintervall
    let doseMin = Math.ceil(lower / frac);
    let doseMax = Math.floor(upper / frac);

    // Clampa till min/maxDose
    doseMin = Math.max(doseMin, minDose);
    doseMax = Math.min(doseMax, maxDose);

    if (doseMin > doseMax) continue;

    // Hitta dos med minsta avvikelse från exakt target
    let bestDose = doseMin;
    let bestDeviation = Infinity;

    for (let dose = doseMin; dose <= doseMax; dose++) {
      const achieved = dose * frac;
      const deviation = Math.abs(achieved - target) / target;
      if (deviation < bestDeviation) {
        bestDeviation = deviation;
        bestDose = dose;
      }
    }

    const cost = bestDose * (p.priceOre / 100);
    solutions.push({
      product: p,
      dose: bestDose,
      cost,
      achieved: {
        N: Math.round(bestDose * p.nFrac * 100) / 100,
        P: Math.round(bestDose * p.pFrac * 100) / 100,
        K: Math.round(bestDose * p.kFrac * 100) / 100,
        S: Math.round(bestDose * p.sFrac * 100) / 100,
      },
      deviation: bestDeviation,
    });
  }

  // Sortera: primärt kostnad, sekundärt avvikelse
  solutions.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.deviation - b.deviation;
  });

  return solutions.slice(0, numStrategies);
}

// ============================================================================
// HJÄLPFUNKTIONER
// ============================================================================

function calcPercentOfTarget(achieved: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((achieved / target) * 1000) / 10;
}

function generateWarnings(
  achieved: { N: number; P: number; K: number; S: number },
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV8>
): WarningItemV8[] {
  const warnings: WarningItemV8[] = [];
  const threshold = config.HIGH_LEVEL_THRESHOLD / 100;

  const check = (nutrient: 'N' | 'P' | 'K' | 'S', must: boolean, target: number, ach: number) => {
    if (!must && target > 0) {
      const ratio = ach / target;
      if (ratio > threshold) {
        warnings.push({
          nutrient,
          type: 'HIGH_LEVEL',
          threshold,
          valueKgHa: ach,
          ratio: Math.round(ratio * 100) / 100,
        });
      }
    }
  };

  check('N', mustFlags.mustN, targets.N || 0, achieved.N);
  check('P', mustFlags.mustP, targets.P || 0, achieved.P);
  check('K', mustFlags.mustK, targets.K || 0, achieved.K);
  check('S', mustFlags.mustS, targets.S || 0, achieved.S);

  return warnings;
}

function calcTotalDeviation(
  achieved: { N: number; P: number; K: number; S: number },
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean }
): number {
  let total = 0;
  
  if (mustFlags.mustN && (targets.N || 0) > 0) {
    total += Math.abs(achieved.N - (targets.N || 0)) / (targets.N || 1);
  }
  if (mustFlags.mustP && (targets.P || 0) > 0) {
    total += Math.abs(achieved.P - (targets.P || 0)) / (targets.P || 1);
  }
  if (mustFlags.mustK && (targets.K || 0) > 0) {
    total += Math.abs(achieved.K - (targets.K || 0)) / (targets.K || 1);
  }
  if (mustFlags.mustS && (targets.S || 0) > 0) {
    total += Math.abs(achieved.S - (targets.S || 0)) / (targets.S || 1);
  }

  return total;
}

function extractYVector(result: MILPResult, products: ScaledProduct[]): number[] {
  const y = new Array(products.length).fill(0);
  for (const pd of result.products) {
    const idx = products.findIndex(p => p.id === pd.product.id);
    if (idx >= 0) y[idx] = 1;
  }
  return y;
}

function validateInput(input: OptimizeV8Input): { valid: boolean; message?: string } {
  const { targets, mustFlags } = input;

  // Minst ett ämne aktiverat
  if (!mustFlags.mustN && !mustFlags.mustP && !mustFlags.mustK && !mustFlags.mustS) {
    return { valid: false, message: 'Minst ett näringsämne måste vara aktiverat' };
  }

  // För aktiverat ämne: target >= 1
  if (mustFlags.mustN && (targets.N || 0) < 1) {
    return { valid: false, message: 'N är aktiverat men targetN < 1 kg/ha' };
  }
  if (mustFlags.mustP && (targets.P || 0) < 1) {
    return { valid: false, message: 'P är aktiverat men targetP < 1 kg/ha' };
  }
  if (mustFlags.mustK && (targets.K || 0) < 1) {
    return { valid: false, message: 'K är aktiverat men targetK < 1 kg/ha' };
  }
  if (mustFlags.mustS && (targets.S || 0) < 1) {
    return { valid: false, message: 'S är aktiverat men targetS < 1 kg/ha' };
  }

  return { valid: true };
}

// ============================================================================
// BYGG STRATEGI-RESULTAT
// ============================================================================

function buildStrategy(
  result: MILPResult,
  rank: number,
  targets: NutrientNeed,
  mustFlags: { mustN: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV8>,
  nToleranceUsed: number
): StrategyResultV8 {
  
  const products: ProductAllocationV8[] = result.products.map(pd => ({
    artikelnr: pd.product.artikelnr,
    produkt: pd.product.name,
    doseKgHa: pd.dose,
    costSekHa: Math.round(pd.dose * (pd.product.priceOre / 100) * 100) / 100,
  }));

  return {
    rank,
    totalCostSekHa: Math.round(result.costSek * 100) / 100,
    products,
    achieved: result.achieved,
    percentOfTarget: {
      N: calcPercentOfTarget(result.achieved.N, targets.N || 0),
      P: calcPercentOfTarget(result.achieved.P, targets.P || 0),
      K: calcPercentOfTarget(result.achieved.K, targets.K || 0),
      S: calcPercentOfTarget(result.achieved.S, targets.S || 0),
    },
    mustFlags: {
      N: mustFlags.mustN,
      P: mustFlags.mustP,
      K: mustFlags.mustK,
      S: mustFlags.mustS,
    },
    warnings: generateWarnings(result.achieved, targets, mustFlags, config),
    nToleranceUsed: mustFlags.mustN ? nToleranceUsed : null,
  };
}

// ============================================================================
// HUVUDFUNKTION
// ============================================================================

export async function optimizeV8(
  products: Product[],
  input: OptimizeV8Input
): Promise<OptimizeV8Output> {
  
  // Återställ solver-instans för att undvika korruption från andra moduler
  resetSolverInstance();
  
  const startTime = Date.now();
  const { targets, mustFlags, maxProductsUser, minDoseKgHa, maxDoseKgHa } = input;

  // Merge config
  const config: Required<AlgorithmConfigV8> = { ...DEFAULT_CONFIG_V8, ...input.config };
  const hardCap = Math.min(4, config.MAX_PRODUCTS_HARD);

  // Validering
  const validation = validateInput(input);
  if (!validation.valid) {
    return { status: 'infeasible', usedMaxProducts: 0, strategies: [], message: validation.message };
  }

  // Skala produkter
  const scaledProducts = scaleProducts(products);
  if (scaledProducts.length === 0) {
    return { status: 'infeasible', usedMaxProducts: maxProductsUser, strategies: [], message: 'Inga optimerbara produkter' };
  }

  console.log(`[v8] ${scaledProducts.length} produkter, targets: N=${targets.N}, P=${targets.P}, K=${targets.K}, S=${targets.S}`);

  // Identifiera aktiva näringsämnen
  const activeNutrients: ('N' | 'P' | 'K' | 'S')[] = [];
  if (mustFlags.mustN && (targets.N || 0) > 0) activeNutrients.push('N');
  if (mustFlags.mustP && (targets.P || 0) > 0) activeNutrients.push('P');
  if (mustFlags.mustK && (targets.K || 0) > 0) activeNutrients.push('K');
  if (mustFlags.mustS && (targets.S || 0) > 0) activeNutrients.push('S');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SINGLE NUTRIENT MODE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (activeNutrients.length === 1) {
    const nutrient = activeNutrients[0];
    const target = targets[nutrient] || 0;

    console.log(`[v8] Single nutrient mode: ${nutrient} = ${target} kg/ha`);

    const solutions = solveSingleNutrient(
      scaledProducts, nutrient, target, minDoseKgHa, maxDoseKgHa,
      config.N_TOLERANCE_KG, config, config.NUM_STRATEGIES
    );

    if (solutions.length > 0) {
      const strategies: StrategyResultV8[] = solutions.map((sol, idx) => ({
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
          N: calcPercentOfTarget(sol.achieved.N, targets.N || 0),
          P: calcPercentOfTarget(sol.achieved.P, targets.P || 0),
          K: calcPercentOfTarget(sol.achieved.K, targets.K || 0),
          S: calcPercentOfTarget(sol.achieved.S, targets.S || 0),
        },
        mustFlags: { N: mustFlags.mustN, P: mustFlags.mustP, K: mustFlags.mustK, S: mustFlags.mustS },
        warnings: generateWarnings(sol.achieved, targets, mustFlags, config),
        nToleranceUsed: nutrient === 'N' ? config.N_TOLERANCE_KG : null,
      }));

      console.log(`[v8] ✅ Single nutrient: ${strategies.length} strategier, ${Date.now() - startTime}ms`);
      return { status: 'ok', usedMaxProducts: 1, strategies, nToleranceUsed: nutrient === 'N' ? config.N_TOLERANCE_KG : undefined };
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MILP MODE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log(`[v8] MILP mode: ${activeNutrients.join(', ')}`);

  let bestResult: MILPResult | null = null;
  let usedMaxProducts = Math.min(maxProductsUser, hardCap);
  let usedNTolerance = config.N_TOLERANCE_KG;

  // N-tolerans eskalering
  const nTolStart = config.N_TOLERANCE_KG;
  const nTolMax = config.N_MAX_TOLERANCE_KG;
  const tolerances = mustFlags.mustN
    ? Array.from({ length: nTolMax - nTolStart + 1 }, (_, i) => nTolStart + i)
    : [nTolStart];

  outerLoop:
  for (const nTol of tolerances) {
    usedNTolerance = nTol;

    // Timeout check
    if (Date.now() - startTime > config.TIMEOUT_MS) {
      console.log('[v8] ⚠️ Timeout');
      break;
    }

    // Prova med ökande antal produkter
    for (let mp = Math.min(maxProductsUser, hardCap); mp <= hardCap; mp++) {
      usedMaxProducts = mp;

      const result = await solveMILP(
        scaledProducts, targets, mustFlags, mp, minDoseKgHa, maxDoseKgHa,
        nTol, [], config
      );

      if (result.status === 'optimal') {
        bestResult = result;
        console.log(`[v8] ✅ Lösning: maxProducts=${mp}, nTolerance=${nTol}`);
        break outerLoop;
      }
    }

    if (mustFlags.mustN) {
      console.log(`[v8] Ingen lösning med N-tolerans +${nTol}, provar +${nTol + 1}...`);
    }
  }

  if (!bestResult) {
    return {
      status: 'infeasible',
      usedMaxProducts: hardCap,
      strategies: [],
      message: `Ingen lösning med upp till ${hardCap} produkter` +
               (mustFlags.mustN ? ` och N-tolerans +${config.N_MAX_TOLERANCE_KG}` : ''),
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BYGG PRISPALL (3 strategier via no-good cuts)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const strategies: StrategyResultV8[] = [];
  const noGoodCuts: number[][] = [];

  // Strategi 1
  strategies.push(buildStrategy(bestResult, 1, targets, mustFlags, config, usedNTolerance));
  noGoodCuts.push(extractYVector(bestResult, scaledProducts));

  // Strategi 2
  if (config.NUM_STRATEGIES >= 2) {
    const result2 = await solveMILP(
      scaledProducts, targets, mustFlags, usedMaxProducts, minDoseKgHa, maxDoseKgHa,
      usedNTolerance, noGoodCuts, config
    );

    if (result2.status === 'optimal') {
      strategies.push(buildStrategy(result2, 2, targets, mustFlags, config, usedNTolerance));
      noGoodCuts.push(extractYVector(result2, scaledProducts));

      // Strategi 3
      if (config.NUM_STRATEGIES >= 3) {
        const result3 = await solveMILP(
          scaledProducts, targets, mustFlags, usedMaxProducts, minDoseKgHa, maxDoseKgHa,
          usedNTolerance, noGoodCuts, config
        );

        if (result3.status === 'optimal') {
          strategies.push(buildStrategy(result3, 3, targets, mustFlags, config, usedNTolerance));
        }
      }
    }
  }

  // Sortera för tie-break
  strategies.sort((a, b) => {
    if (a.totalCostSekHa !== b.totalCostSekHa) return a.totalCostSekHa - b.totalCostSekHa;
    const devA = calcTotalDeviation(a.achieved, targets, mustFlags);
    const devB = calcTotalDeviation(b.achieved, targets, mustFlags);
    if (devA !== devB) return devA - devB;
    return a.products.length - b.products.length;
  });

  strategies.forEach((s, i) => s.rank = i + 1);

  console.log(`[v8] ✅ Klar: ${strategies.length} strategier, ${Date.now() - startTime}ms`);

  return {
    status: 'ok',
    usedMaxProducts,
    strategies,
    nToleranceUsed: mustFlags.mustN ? usedNTolerance : undefined,
  };
}

// ============================================================================
// ADAPTER FÖR BEFINTLIG API
// ============================================================================

export async function optimizeV8ToSolutions(
  products: Product[],
  need: NutrientNeed,
  options: {
    maxProducts?: number;
    requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
    minDose?: number;
    maxDose?: number;
    config?: AlgorithmConfigV8;
  } = {}
): Promise<Solution[]> {
  
  const requiredNutrients = options.requiredNutrients || [];

  const input: OptimizeV8Input = {
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

  const result = await optimizeV8(products, input);

  if (result.status === 'infeasible' || result.strategies.length === 0) {
    return [];
  }

  return result.strategies.map(strategy => ({
    products: strategy.products.map(p => ({
      productId: `prod-${p.artikelnr}`,
      name: p.produkt,
      kgPerHa: p.doseKgHa,
    })),
    supplied: strategy.achieved,
    deviation: {
      N: { kg: strategy.achieved.N - (need.N || 0), pct: (strategy.percentOfTarget.N || 100) - 100 },
      P: { kg: strategy.achieved.P - (need.P || 0), pct: (strategy.percentOfTarget.P || 0) - 100 },
      K: { kg: strategy.achieved.K - (need.K || 0), pct: (strategy.percentOfTarget.K || 0) - 100 },
      S: { kg: strategy.achieved.S - (need.S || 0), pct: (strategy.percentOfTarget.S || 0) - 100 },
    },
    costPerHa: strategy.totalCostSekHa,
    score: strategy.totalCostSekHa,
    notes: [
      ...strategy.warnings.map(w => `Varning: ${w.nutrient} är ${Math.round(w.ratio * 100)}% av behov (${w.valueKgHa} kg/ha)`),
      ...(strategy.nToleranceUsed && strategy.nToleranceUsed > 1 ? [`N-tolerans: +${strategy.nToleranceUsed} kg/ha`] : []),
    ],
  }));
}

export default optimizeV8;
