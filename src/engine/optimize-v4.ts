/**
 * FEST Gödseloptimering v4 - PKS först, N sist
 * 
 * STRATEGI:
 * 1. Bygg PKS-bas först (0-K produkter med 10 kg steg)
 * 2. Toppa upp N exakt sist (1 kg steg)
 * 3. N är ALLTID exakt (ingen tolerans)
 * 4. PKS tolerans: -10% till +20%
 * 5. Fler produkter bara om billigare
 */

import { Product } from '../models/Product';
import { NutrientNeed } from '../models/NutrientNeed';
import { Solution, NutrientDeviations } from '../models/Solution';
import { Tolerances } from '../models/Tolerances';

// ============================================================================
// KONFIGURATION
// ============================================================================

const MAX_DOSE_KG = 400; // Max dos per produkt (minskat från 600)
const PKS_DOSE_STEP = 20; // PKS-produkter: 20 kg steg (ökad från 10 för färre kombinationer)
const N_DOSE_STEP = 1;    // N-topup: 1 kg steg (exakt)

// PKS toleranser
const PKS_MIN_RATIO = 0.90;  // -10%
const PKS_TARGET_MAX = 1.20; // +20% (börjar penalty)

// Penalty weights
const UNDER_PENALTY_WEIGHT = 10.0; // Under behov är dyrt
const OVER_PENALTY_WEIGHT = 0.5;   // Över behov är OK (förrådsgödsling)

// Max kombinationer att testa (säkerhet mot stack overflow)
const MAX_COMBINATIONS_PER_SIZE = 50000;

// ============================================================================
// TYPER
// ============================================================================

interface ProductWithMetrics extends Product {
  n: number;  // Faktor 0-1
  p: number;
  k: number;
  s: number;
  costPerKgN: number;
  costPerKgP: number;
  costPerKgK: number;
  costPerKgS: number;
  price: number;
}

interface DoseAllocation {
  productId: string;
  name: string;
  dose: number; // kg/ha
}

interface Candidate {
  products: DoseAllocation[];
  totalN: number;
  totalP: number;
  totalK: number;
  totalS: number;
  cost: number;
  penalty: number;
  productCount: number;
}

export interface OptimizeOptions {
  maxProducts: number;
  maxSolutions: number;
  tolerances: Tolerances;
  requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
}

// ============================================================================
// PREPROCESSING
// ============================================================================

function prepareProducts(products: Product[]): ProductWithMetrics[] {
  return products
    .filter(p => p.id && p.pricePerKg !== undefined)
    .map(p => {
      const n = (p.nutrients.N || 0) / 100;
      const pVal = (p.nutrients.P || 0) / 100;
      const k = (p.nutrients.K || 0) / 100;
      const s = (p.nutrients.S || 0) / 100;
      const price = p.pricePerKg || 0;

      return {
        ...p,
        n,
        p: pVal,
        k,
        s,
        price,
        costPerKgN: n > 0 ? price / n : Infinity,
        costPerKgP: pVal > 0 ? price / pVal : Infinity,
        costPerKgK: k > 0 ? price / k : Infinity,
        costPerKgS: s > 0 ? price / s : Infinity,
      };
    });
}

// ============================================================================
// CANDIDATE POOL
// ============================================================================

function buildCandidatePool(products: ProductWithMetrics[]): ProductWithMetrics[] {
  const pool = new Set<string>();
  const productMap = new Map<string, ProductWithMetrics>();

  products.forEach(p => productMap.set(p.id, p));

  // Top 20 cheapest by N
  const byN = [...products].filter(p => p.n > 0).sort((a, b) => a.costPerKgN - b.costPerKgN);
  byN.slice(0, 20).forEach(p => pool.add(p.id));

  // Top 15 cheapest by P
  const byP = [...products].filter(p => p.p > 0).sort((a, b) => a.costPerKgP - b.costPerKgP);
  byP.slice(0, 15).forEach(p => pool.add(p.id));

  // Top 15 cheapest by K
  const byK = [...products].filter(p => p.k > 0).sort((a, b) => a.costPerKgK - b.costPerKgK);
  byK.slice(0, 15).forEach(p => pool.add(p.id));

  // Top 15 cheapest by S
  const byS = [...products].filter(p => p.s > 0).sort((a, b) => a.costPerKgS - b.costPerKgS);
  byS.slice(0, 15).forEach(p => pool.add(p.id));

  // Top 20 multi-nutrient (>=2 av PKS)
  const multi = products.filter(p => {
    const count = (p.p > 0 ? 1 : 0) + (p.k > 0 ? 1 : 0) + (p.s > 0 ? 1 : 0);
    return count >= 2;
  }).sort((a, b) => a.price - b.price);
  multi.slice(0, 20).forEach(p => pool.add(p.id));

  return Array.from(pool).map(id => productMap.get(id)!);
}

// ============================================================================
// COMBINATION GENERATOR
// ============================================================================

function* generateCombinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > arr.length) return;

  for (let i = 0; i <= arr.length - k; i++) {
    const first = arr[i];
    for (const rest of generateCombinations(arr.slice(i + 1), k - 1)) {
      yield [first, ...rest];
    }
  }
}

// ============================================================================
// DOSE ITERATION
// ============================================================================

function* generateDoseCombinations(
  products: ProductWithMetrics[],
  step: number
): Generator<number[]> {
  if (products.length === 0) {
    yield [];
    return;
  }

  const maxDoses = products.map(() => Math.floor(MAX_DOSE_KG / step));

  function* recurse(index: number, current: number[]): Generator<number[]> {
    if (index === products.length) {
      yield [...current];
      return;
    }

    for (let i = 0; i <= maxDoses[index]; i++) {
      current[index] = i * step;
      yield* recurse(index + 1, current);
    }
  }

  yield* recurse(0, new Array(products.length).fill(0));
}

// ============================================================================
// PENALTY CALCULATION
// ============================================================================

function calculatePenalty(
  nutrient: 'P' | 'K' | 'S',
  total: number,
  need: number,
  required: boolean
): { valid: boolean; penalty: number } {
  if (need === 0) return { valid: true, penalty: 0 };

  const ratio = total / need;

  // Under minimum
  if (ratio < PKS_MIN_RATIO) {
    if (required) {
      return { valid: false, penalty: 0 };
    }
    const deficit = need - total;
    return { valid: true, penalty: deficit * UNDER_PENALTY_WEIGHT };
  }

  // Målzon: 90-120%
  if (ratio <= PKS_TARGET_MAX) {
    return { valid: true, penalty: 0 };
  }

  // Över 120%: penalty för övergödsling
  const excess = total - need * PKS_TARGET_MAX;
  return { valid: true, penalty: excess * OVER_PENALTY_WEIGHT };
}

// ============================================================================
// MAIN OPTIMIZATION
// ============================================================================

export function optimizeNutrients(
  need: NutrientNeed,
  products: Product[],
  options: OptimizeOptions
): Solution[] {
  console.log('\n🎯 === OPTIMIZER V4 START (PKS först, N sist) ===');
  console.log(`Behov: N=${need.N || 0}, P=${need.P || 0}, K=${need.K || 0}, S=${need.S || 0}`);
  console.log(`Max produkter: ${options.maxProducts}, Max resultat: ${options.maxSolutions}`);
  console.log(`Krävda näringsämnen: ${options.requiredNutrients?.join(', ') || 'N'}`);

  const needN = need.N || 0;
  const needP = need.P || 0;
  const needK = need.K || 0;
  const needS = need.S || 0;

  const reqP = options.requiredNutrients?.includes('P') || false;
  const reqK = options.requiredNutrients?.includes('K') || false;
  const reqS = options.requiredNutrients?.includes('S') || false;

  // Preprocessing
  const prepared = prepareProducts(products);
  console.log(`📦 Förberedda produkter: ${prepared.length}`);

  if (prepared.length === 0) {
    console.log('❌ Inga produkter att optimera med');
    return [];
  }

  // Build candidate pool
  const pool = buildCandidatePool(prepared);
  console.log(`🎯 Kandidatpool: ${pool.length} produkter`);

  // Separate N-products (for top-up)
  const nProducts = pool.filter(p => p.n > 0).sort((a, b) => a.costPerKgN - b.costPerKgN);
  console.log(`💧 N-topup kandidater: ${nProducts.length}`);

  const allCandidates: Candidate[] = [];
  const bestCostByCount = new Map<number, number>();

  // ============================================================================
  // MAIN LOOP: productCount = 1 to maxProducts
  // ============================================================================

  for (let productCount = 1; productCount <= options.maxProducts; productCount++) {
    console.log(`\n🔹 Testar ${productCount} produkter...`);

    const baseProductCount = productCount - 1;
    let tested = 0;
    let found = 0;

    // Case 1: Only N-product (no PKS base)
    if (baseProductCount === 0) {
      for (const nProd of nProducts) {
        tested++;

        // Calculate exact N dose
        const doseN = needN / nProd.n;
        const doseNRounded = Math.round(doseN);

        if (doseNRounded < 0 || doseNRounded > MAX_DOSE_KG) continue;

        const totalN = nProd.n * doseNRounded;
        if (Math.abs(totalN - needN) > 1e-6) continue;

        const totalP = nProd.p * doseNRounded;
        const totalK = nProd.k * doseNRounded;
        const totalS = nProd.s * doseNRounded;

        // PKS validation
        const penaltyP = calculatePenalty('P', totalP, needP, reqP);
        if (!penaltyP.valid) continue;

        const penaltyK = calculatePenalty('K', totalK, needK, reqK);
        if (!penaltyK.valid) continue;

        const penaltyS = calculatePenalty('S', totalS, needS, reqS);
        if (!penaltyS.valid) continue;

        const penalty = penaltyP.penalty + penaltyK.penalty + penaltyS.penalty;
        const cost = nProd.price * doseNRounded;

        allCandidates.push({
          products: [{ productId: nProd.id, name: nProd.name, dose: doseNRounded }],
          totalN,
          totalP,
          totalK,
          totalS,
          cost,
          penalty,
          productCount: 1
        });
        found++;
      }
    } else {
      // Case 2: PKS base + N top-up
      let combinationCount = 0;
      
      for (const baseCombo of generateCombinations(pool, baseProductCount)) {
        for (const doses of generateDoseCombinations(baseCombo, PKS_DOSE_STEP)) {
          tested++;
          combinationCount++;
          
          // Säkerhetsgräns: stoppa om för många kombinationer
          if (combinationCount > MAX_COMBINATIONS_PER_SIZE) {
            console.log(`   ⚠️  Nådde max ${MAX_COMBINATIONS_PER_SIZE} kombinationer, stoppar`);
            break;
          }

          // Calculate PKS base
          let nBase = 0, pBase = 0, kBase = 0, sBase = 0, costBase = 0;
          for (let i = 0; i < baseCombo.length; i++) {
            const prod = baseCombo[i];
            const dose = doses[i];
            nBase += prod.n * dose;
            pBase += prod.p * dose;
            kBase += prod.k * dose;
            sBase += prod.s * dose;
            costBase += prod.price * dose;
          }

          // HARD RULE: N_base cannot exceed needN
          if (nBase > needN) continue;

          // PKS hard checks (if required)
          if (reqP && needP > 0 && pBase < PKS_MIN_RATIO * needP) continue;
          if (reqK && needK > 0 && kBase < PKS_MIN_RATIO * needK) continue;
          if (reqS && needS > 0 && sBase < PKS_MIN_RATIO * needS) continue;

          // Try N top-up products
          for (const nProd of nProducts) {
            if (nProd.n === 0) continue;

            const nMissing = needN - nBase;
            if (nMissing < 0) continue;

            const doseN = nMissing / nProd.n;
            const doseNRounded = Math.round(doseN);

            if (doseNRounded < 0 || doseNRounded > MAX_DOSE_KG) continue;

            // Recalculate totals
            const totalN = nBase + nProd.n * doseNRounded;
            if (Math.abs(totalN - needN) > 1e-6) continue;

            const totalP = pBase + nProd.p * doseNRounded;
            const totalK = kBase + nProd.k * doseNRounded;
            const totalS = sBase + nProd.s * doseNRounded;

            // PKS validation
            const penaltyP = calculatePenalty('P', totalP, needP, reqP);
            if (!penaltyP.valid) continue;

            const penaltyK = calculatePenalty('K', totalK, needK, reqK);
            if (!penaltyK.valid) continue;

            const penaltyS = calculatePenalty('S', totalS, needS, reqS);
            if (!penaltyS.valid) continue;

            const penalty = penaltyP.penalty + penaltyK.penalty + penaltyS.penalty;
            const cost = costBase + nProd.price * doseNRounded;

            // Build product list
            const productList: DoseAllocation[] = [];
            for (let i = 0; i < baseCombo.length; i++) {
              if (doses[i] > 0) {
                productList.push({
                  productId: baseCombo[i].id,
                  name: baseCombo[i].name,
                  dose: doses[i]
                });
              }
            }
            productList.push({
              productId: nProd.id,
              name: nProd.name,
              dose: doseNRounded
            });

            allCandidates.push({
              products: productList,
              totalN,
              totalP,
              totalK,
              totalS,
              cost,
              penalty,
              productCount
            });
            found++;
          }
        }
        
        // Bryt yttre loop om vi nådde max
        if (combinationCount > MAX_COMBINATIONS_PER_SIZE) break;
      }
    }

    console.log(`   Testade ${tested} kombinationer, hittade ${found} kandidater`);

    // Filter: Only keep if cheaper than previous count
    if (productCount > 1) {
      const prevBest = bestCostByCount.get(productCount - 1);
      if (prevBest !== undefined) {
        const currentBest = Math.min(...allCandidates.filter(c => c.productCount === productCount).map(c => c.cost), Infinity);
        if (currentBest >= prevBest) {
          console.log(`   ⚠️  ${productCount} produkter ej billigare än ${productCount - 1} → skippar`);
          continue;
        }
      }
    }

    // Update best cost for this count
    const candidates = allCandidates.filter(c => c.productCount === productCount);
    if (candidates.length > 0) {
      const minCost = Math.min(...candidates.map(c => c.cost));
      bestCostByCount.set(productCount, minCost);
    }
  }

  // ============================================================================
  // SORTING & OUTPUT
  // ============================================================================

  allCandidates.sort((a, b) => {
    if (Math.abs(a.cost - b.cost) > 0.01) return a.cost - b.cost;
    if (Math.abs(a.penalty - b.penalty) > 0.01) return a.penalty - b.penalty;
    return a.productCount - b.productCount;
  });

  const topCandidates = allCandidates.slice(0, options.maxSolutions);
  const solutions: Solution[] = topCandidates.map(c => convertToSolution(c, need));

  console.log(`✅ === OPTIMIZER V4 KLAR ===`);
  console.log(`Returnerar ${solutions.length} lösningar`);

  return solutions;
}

// ============================================================================
// CONVERT TO SOLUTION
// ============================================================================

function convertToSolution(candidate: Candidate, need: NutrientNeed): Solution {
  const needN = need.N || 0;
  const needP = need.P || 0;
  const needK = need.K || 0;
  const needS = need.S || 0;

  const deviations: NutrientDeviations = {};

  if (needN > 0) {
    const kg = candidate.totalN - needN;
    const pct = (kg / needN) * 100;
    deviations.N = { kg, pct };
  }

  if (needP > 0) {
    const kg = candidate.totalP - needP;
    const pct = (kg / needP) * 100;
    deviations.P = { kg, pct };
  }

  if (needK > 0) {
    const kg = candidate.totalK - needK;
    const pct = (kg / needK) * 100;
    deviations.K = { kg, pct };
  }

  if (needS > 0) {
    const kg = candidate.totalS - needS;
    const pct = (kg / needS) * 100;
    deviations.S = { kg, pct };
  }

  return {
    products: candidate.products.map(p => ({
      productId: p.productId,
      name: p.name,
      kgPerHa: p.dose
    })),
    supplied: {
      N: candidate.totalN,
      P: candidate.totalP,
      K: candidate.totalK,
      S: candidate.totalS
    },
    deviation: deviations,
    costPerHa: candidate.cost,
    score: candidate.cost + candidate.penalty,
    notes: []
  };
}
