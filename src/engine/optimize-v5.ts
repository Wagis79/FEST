/**
 * FEST Gödseloptimering v5 - MILP-baserad ILP-solver
 * 
 * SPECIFIKATION:
 * - Heltalsoptimering (ILP) för doser
 * - N MÅSTE nå target, max +1 kg/ha över
 * - P/K/S (om ikryssade): 85%-125% av target
 * - Minimera ENBART produktkostnad (SEK/ha)
 * - Prispall med 3 strategier (via no-good cuts)
 * - Autoökning av maxProducts vid infeasible (upp till 5)
 * - Heltalsskalning för numerisk stabilitet
 */

import { Product } from '../models/Product';
import { NutrientNeed } from '../models/NutrientNeed';
// @ts-ignore - javascript-lp-solver har inga TypeScript-typer
import Solver from 'javascript-lp-solver';

// ============================================================================
// TYPER
// ============================================================================

export interface OptimizeV5Input {
  targets: NutrientNeed;           // kg/ha för N, P, K, S
  mustFlags: {
    mustN?: boolean;               // Om N måste inkluderas (default: true om ej specificerat)
    mustP: boolean;
    mustK: boolean;
    mustS: boolean;
  };
  maxProductsUser: number;         // Användarens val (1-5)
  minDoseKgHa: number;             // Default 100
  maxDoseKgHa: number;             // Default 600
  /** Valfri algoritm-konfiguration från databas */
  config?: AlgorithmConfigV5;
}

export interface ProductAllocationV5 {
  artikelnr: number;
  produkt: string;
  doseKgHa: number;
  costSekHa: number;
}

/**
 * Algoritm-konfiguration som kan laddas från databas
 */
export interface AlgorithmConfigV5 {
  /** N-tolerans i kg/ha (default: 1) */
  N_TOLERANCE_KG?: number;
  /** PKS min-procent (default: 85) */
  PKS_MIN_PCT?: number;
  /** PKS max-procent (default: 125) */
  PKS_MAX_PCT?: number;
  /** Varningströskel för okryssade ämnen i % (default: 150) */
  HIGH_LEVEL_THRESHOLD?: number;
  /** Max antal produkter (default: 5) */
  MAX_PRODUCTS_HARD?: number;
  /** Antal strategier att returnera (default: 3) */
  NUM_STRATEGIES?: number;
}

/**
 * Default-värden för algoritm-konfiguration
 */
export const DEFAULT_ALGORITHM_CONFIG: Required<AlgorithmConfigV5> = {
  N_TOLERANCE_KG: 1,
  PKS_MIN_PCT: 85,
  PKS_MAX_PCT: 125,
  HIGH_LEVEL_THRESHOLD: 150,
  MAX_PRODUCTS_HARD: 5,
  NUM_STRATEGIES: 3,
};

export interface StrategyResult {
  rank: number;
  totalCostSekHa: number;
  products: ProductAllocationV5[];
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
    P: boolean;
    K: boolean;
    S: boolean;
  };
  warnings: WarningItem[];
}

export interface WarningItem {
  nutrient: 'P' | 'K' | 'S';
  type: 'HIGH_LEVEL';
  threshold: number;
  valueKgHa: number;
  ratio: number;
}

export interface OptimizeV5Output {
  status: 'ok' | 'infeasible';
  usedMaxProducts: number;
  strategies: StrategyResult[];
  message?: string;
}

interface PreparedProduct {
  id: string;
  artikelnr: number;
  name: string;
  price: number;        // SEK/kg
  priceOre: number;     // Öre/kg (heltal)
  n: number;            // Faktor 0-1
  p: number;
  k: number;
  s: number;
  n10: number;          // Tiondels-procent som heltal (15.5% -> 155)
  p10: number;
  k10: number;
  s10: number;
}

// ============================================================================
// HJÄLPFUNKTIONER
// ============================================================================

/**
 * Förbered produkter för optimering
 * - Filtrera bara "Optimeringsbar" produkter
 * - Skala näringshalter till heltal (tiondelsprocent)
 * - Skala pris till öre
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

      // Extrahera artikelnr från id (format: "prod-12345")
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
        // Skala till tiondelsprocent (multiplicera med 10 för att få heltal)
        n10: Math.round((p.nutrients.N || 0) * 10),
        p10: Math.round((p.nutrients.P || 0) * 10),
        k10: Math.round((p.nutrients.K || 0) * 10),
        s10: Math.round((p.nutrients.S || 0) * 10),
      };
    })
    .filter(p => p.n10 > 0 || p.p10 > 0 || p.k10 > 0 || p.s10 > 0); // Minst ett näringsämne
}

/**
 * Beräkna percent of target
 */
function calcPercentOfTarget(achieved: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((achieved / target) * 1000) / 10; // En decimal
}

/**
 * Generera varningar för okryssade ämnen med hög nivå
 */
function generateWarnings(
  achieved: { N: number; P: number; K: number; S: number },
  targets: NutrientNeed,
  mustFlags: { mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV5>
): WarningItem[] {
  const warnings: WarningItem[] = [];
  const highLevelThreshold = config.HIGH_LEVEL_THRESHOLD / 100; // Konvertera från % till ratio

  // P varning
  if (!mustFlags.mustP && (targets.P || 0) > 0) {
    const ratio = achieved.P / (targets.P || 1);
    if (ratio > highLevelThreshold) {
      warnings.push({
        nutrient: 'P',
        type: 'HIGH_LEVEL',
        threshold: highLevelThreshold,
        valueKgHa: achieved.P,
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }

  // K varning
  if (!mustFlags.mustK && (targets.K || 0) > 0) {
    const ratio = achieved.K / (targets.K || 1);
    if (ratio > highLevelThreshold) {
      warnings.push({
        nutrient: 'K',
        type: 'HIGH_LEVEL',
        threshold: highLevelThreshold,
        valueKgHa: achieved.K,
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }

  // S varning
  if (!mustFlags.mustS && (targets.S || 0) > 0) {
    const ratio = achieved.S / (targets.S || 1);
    if (ratio > highLevelThreshold) {
      warnings.push({
        nutrient: 'S',
        type: 'HIGH_LEVEL',
        threshold: highLevelThreshold,
        valueKgHa: achieved.S,
        ratio: Math.round(ratio * 100) / 100,
      });
    }
  }

  return warnings;
}

// ============================================================================
// MILP SOLVER
// ============================================================================

interface SolverSolution {
  feasible: boolean;
  products: Array<{
    product: PreparedProduct;
    dose: number;
  }>;
  cost: number;
  achieved: {
    N: number;
    P: number;
    K: number;
    S: number;
  };
}

/**
 * Lös MILP-problemet med javascript-lp-solver
 * 
 * OBS: javascript-lp-solver stödjer inte riktigt MIP med binära variabler
 * på ett robust sätt. Vi använder därför en kombinatorisk approach:
 * - Förfiltrera produkter baserat på behov
 * - Testa kombinationer av produkter upp till maxProducts
 * - För varje kombination, lös LP-relaxationen
 * - Avrunda till heltal och verifiera feasibility
 */
function solveMILP(
  products: PreparedProduct[],
  targets: NutrientNeed,
  mustFlags: { mustN?: boolean; mustP: boolean; mustK: boolean; mustS: boolean },
  maxProducts: number,
  minDose: number,
  maxDose: number,
  excludedSets: Set<string>[] = [],
  config: Required<AlgorithmConfigV5> = DEFAULT_ALGORITHM_CONFIG
): SolverSolution | null {
  
  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;

  // SNABBVÄG: Om endast ETT näringsämne krävs (N, P, K eller S), använd enkel greedy-algoritm
  // mustN är default true (bakåtkompatibelt) om ej explicit satt till false
  const mustN = mustFlags.mustN !== false && targetN > 0;
  
  const activeNutrients: ('N' | 'P' | 'K' | 'S')[] = [];
  if (mustN) activeNutrients.push('N');
  if (mustFlags.mustP && targetP > 0) activeNutrients.push('P');
  if (mustFlags.mustK && targetK > 0) activeNutrients.push('K');
  if (mustFlags.mustS && targetS > 0) activeNutrients.push('S');
  
  const singleNutrientRequired = activeNutrients.length === 1;
  
  if (singleNutrientRequired) {
    const nutrient = activeNutrients[0];
    const targetValue = nutrient === 'N' ? targetN : nutrient === 'P' ? targetP : nutrient === 'K' ? targetK : targetS;
    const nutrientKey = nutrient.toLowerCase() as 'n' | 'p' | 'k' | 's';
    
    // console.log(`⚡ V5: Endast ${nutrient} krävs (${targetValue} kg/ha) - använder snabb greedy-algoritm`);
    
    // Exkludera produkter som redan använts i tidigare lösningar
    const excludedIds = new Set<string>();
    for (const excludedSet of excludedSets) {
      excludedSet.forEach(id => excludedIds.add(id));
    }
    
    // Filtrera produkter med det aktuella näringsämnet och sortera efter kostnad per kg
    const relevantProducts = products
      .filter(p => p[nutrientKey] > 0 && !excludedIds.has(p.id))
      .map(p => ({
        ...p,
        costPerNutrient: p.price / p[nutrientKey]
      }))
      .sort((a, b) => a.costPerNutrient - b.costPerNutrient);
    
    if (relevantProducts.length === 0) return null;
    
    // Ta den billigaste produkten som kan täcka behovet
    const bestProduct = relevantProducts[0];
    const doseNeeded = targetValue / bestProduct[nutrientKey];
    const dose = Math.min(Math.max(doseNeeded, minDose), maxDose);
    const totalCost = dose * bestProduct.price;
    
    // Beräkna alla levererade näringsämnen
    const suppliedN = dose * bestProduct.n;
    const suppliedP = dose * bestProduct.p;
    const suppliedK = dose * bestProduct.k;
    const suppliedS = dose * bestProduct.s;
    
    return {
      feasible: true,
      products: [{ product: bestProduct, dose }],
      cost: totalCost,
      achieved: { N: suppliedN, P: suppliedP, K: suppliedK, S: suppliedS }
    };
  }

  // Räkna antal aktiva krav för att anpassa kandidatantal
  // Räkna antal aktiva krav för att anpassa kandidatantal
  const numRequirements = [mustN, mustFlags.mustP, mustFlags.mustK, mustFlags.mustS].filter(Boolean).length;
  
  // Färre krav = färre kandidater behövs = snabbare
  // Fler krav = behöver fler olika produkttyper
  const BASE_CANDIDATES = maxProducts >= 4 ? 15 : 20;
  const MAX_TOTAL_CANDIDATES = maxProducts >= 4 ? 20 : 25;

  // Aggressiv förfiltrering: Behåll bara produkter som kan bidra till krävda näringsämnen
  let relevantProducts = products.filter(p => {
    // Produkten måste ha minst ett av de näringsämnen som krävs
    if (mustN && p.n > 0) return true;
    if (mustFlags.mustP && p.p > 0) return true;
    if (mustFlags.mustK && p.k > 0) return true;
    if (mustFlags.mustS && p.s > 0) return true;
    // Om inget krav är satt (ska inte hända), tillåt alla med något näringsämne
    if (!mustN && !mustFlags.mustP && !mustFlags.mustK && !mustFlags.mustS) {
      return p.n > 0 || p.p > 0 || p.k > 0 || p.s > 0;
    }
    return false;
  });

  // Sortera efter kostnad per primärt näringsämne (det första som krävs)
  const primaryNutrient = mustN ? 'n' : mustFlags.mustP ? 'p' : mustFlags.mustK ? 'k' : 's';
  relevantProducts.sort((a, b) => {
    const costPerA = a[primaryNutrient] > 0 ? a.price / a[primaryNutrient] : Infinity;
    const costPerB = b[primaryNutrient] > 0 ? b.price / b[primaryNutrient] : Infinity;
    return costPerA - costPerB;
  });

  // Begränsa till de billigaste produkterna
  if (relevantProducts.length > BASE_CANDIDATES) {
    relevantProducts = relevantProducts.slice(0, BASE_CANDIDATES);
  }

  // Lägg till produkter med hög P/K/S om de behövs (färre per kategori)
  // OBS: Vi måste använda Set med id:n, inte objekt-referens
  const EXTRA_PER_CATEGORY = 8; // Ökat för att säkerställa tillräckligt med kandidater
  const includedIds = new Set(relevantProducts.map(p => p.id));
  
  if (mustFlags.mustP && targetP > 0) {
    const pProducts = products
      .filter(p => p.p > 0.01 && !includedIds.has(p.id)) // Minst 1% P, ej redan inkluderad
      .sort((a, b) => (b.p / a.price) - (a.p / b.price))
      .slice(0, EXTRA_PER_CATEGORY);
    pProducts.forEach(p => {
      relevantProducts.push(p);
      includedIds.add(p.id);
    });
  }
  if (mustFlags.mustK && targetK > 0) {
    const kProducts = products
      .filter(p => p.k > 0.01 && !includedIds.has(p.id)) // Minst 1% K, ej redan inkluderad
      .sort((a, b) => (b.k / a.price) - (a.k / b.price))
      .slice(0, EXTRA_PER_CATEGORY);
    kProducts.forEach(p => {
      relevantProducts.push(p);
      includedIds.add(p.id);
    });
  }
  if (mustFlags.mustS && targetS > 0) {
    const sProducts = products
      .filter(p => p.s > 0.01 && !includedIds.has(p.id)) // Minst 1% S, ej redan inkluderad
      .sort((a, b) => (b.s / a.price) - (a.s / b.price))
      .slice(0, EXTRA_PER_CATEGORY);
    sProducts.forEach(p => {
      relevantProducts.push(p);
      includedIds.add(p.id);
    });
  }

  // Hård gräns på totalt antal kandidater - höjd för att säkerställa att P/K/S-produkter inkluderas
  const adjustedMaxCandidates = Math.max(MAX_TOTAL_CANDIDATES, numRequirements * 15);
  if (relevantProducts.length > adjustedMaxCandidates) {
    relevantProducts = relevantProducts.slice(0, adjustedMaxCandidates);
  }

  // Debug: Visa produkter med P och K (endast vid felsökning)
  // console.log(`🔍 V5: Förfiltrerade till ${relevantProducts.length} kandidater (${numRequirements} krav) - ${withP.length} med P, ${withK.length} med K`);

  if (relevantProducts.length === 0) {
    return null;
  }

  let bestSolution: SolverSolution | null = null;
  let solutionsChecked = 0;
  const MAX_SOLUTIONS_TO_CHECK = 10000; // Säkerhetsgräns

  // Generera kombinationer av produkter (1 till maxProducts)
  for (let numProducts = 1; numProducts <= maxProducts; numProducts++) {
    const combinations = getCombinations(relevantProducts, numProducts);
    // console.log(`🔍 V5: Testar ${combinations.length} kombinationer med ${numProducts} produkter`);

    for (const combo of combinations) {
      solutionsChecked++;
      
      // Säkerhetsgräns för att undvika hängning
      if (solutionsChecked > MAX_SOLUTIONS_TO_CHECK) {
        // console.log(`⚠️ V5: Nådde säkerhetsgräns (${MAX_SOLUTIONS_TO_CHECK} kombinationer testade)`);
        break;
      }

      // Kolla om denna kombination är excluded (no-good cut)
      // En kombination är excluded om den innehåller ALLA produkter från en tidigare lösning
      const comboIds = new Set(combo.map(p => p.id));
      const isExcluded = excludedSets.some(excludedSet => {
        // Om alla produkter i excludedSet finns i denna kombination, exkludera
        for (const excludedId of excludedSet) {
          if (!comboIds.has(excludedId)) {
            return false; // Minst en produkt saknas, inte excluded
          }
        }
        return true; // Alla produkter i excludedSet finns i combo
      });
      if (isExcluded) continue;

      // Lös LP för denna kombination
      const solution = solveForCombination(
        combo,
        targetN,
        targetP,
        targetK,
        targetS,
        mustN,
        mustFlags,
        minDose,
        maxDose,
        config
      );

      if (solution && solution.feasible) {
        if (!bestSolution || solution.cost < bestSolution.cost) {
          bestSolution = solution;
        }
      }
    }
    
    // Om vi nått säkerhetsgränsen, avbryt helt
    if (solutionsChecked > MAX_SOLUTIONS_TO_CHECK) {
      break;
    }
  }

  // if (bestSolution) {
  //   console.log(`✅ V5: Hittade lösning efter ${solutionsChecked} kombinationer`);
  // }

  return bestSolution;
}

/**
 * Generera alla kombinationer av storlek k
 */
function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  if (k > arr.length) return [];

  const result: T[][] = [];
  
  // Begränsa antal kombinationer för prestanda
  // Med 30 produkter: C(30,5) = 142506 - fortfarande hanterbart
  const maxCombinations = 50000;
  let count = 0;

  function combine(start: number, current: T[]) {
    if (count >= maxCombinations) return;
    
    if (current.length === k) {
      result.push([...current]);
      count++;
      return;
    }

    for (let i = start; i < arr.length && count < maxCombinations; i++) {
      current.push(arr[i]);
      combine(i + 1, current);
      current.pop();
    }
  }

  combine(0, []);
  return result;
}

/**
 * Lös LP för en specifik produktkombination och avrunda till heltal
 */
function solveForCombination(
  combo: PreparedProduct[],
  targetN: number,
  targetP: number,
  targetK: number,
  targetS: number,
  mustN: boolean,
  mustFlags: { mustP: boolean; mustK: boolean; mustS: boolean },
  minDose: number,
  maxDose: number,
  config: Required<AlgorithmConfigV5>
): SolverSolution | null {
  
  // Extrahera config-värden
  const nToleranceKg = config.N_TOLERANCE_KG;
  const pksMinRatio = config.PKS_MIN_PCT / 100;  // 85% -> 0.85
  const pksMaxRatio = config.PKS_MAX_PCT / 100;  // 125% -> 1.25
  
  // Bygg LP-modell
  const model: any = {
    optimize: 'cost',
    opType: 'min',
    constraints: {},
    variables: {},
    ints: {} // Heltalskrav
  };

  // Skapa variabler för varje produkt
  combo.forEach((p, idx) => {
    const varName = `x${idx}`;
    model.variables[varName] = {
      cost: p.priceOre, // Kostnad i öre
      nSupply: p.n10,   // N-bidrag i tiondelsprocent * dos
      pSupply: p.p10,
      kSupply: p.k10,
      sSupply: p.s10,
    };
    model.ints[varName] = 1; // Heltalsrestriktion
  });

  // N-constraint: targetN*1000 <= N10_ach <= (targetN+1)*1000
  // N10_ach = sum(x_i * n10_i)
  // Omräkning: x_i är dos i kg, n10_i är tiondelsprocent
  // Leverans kg = x_i * (n10_i/10) / 100 = x_i * n10_i / 1000
  // Så N_kg = sum(x_i * n10_i) / 1000
  // Constraint: targetN <= N_kg <= targetN + nToleranceKg
  // => targetN * 1000 <= sum(x_i * n10_i) <= (targetN + nToleranceKg) * 1000
  
  // N constraint (om mustN)
  if (mustN && targetN > 0) {
    const targetN10 = Math.round(targetN * 1000);
    const targetN10Max = Math.round((targetN + nToleranceKg) * 1000);
    
    model.constraints['nMin'] = { min: targetN10 };
    model.constraints['nMax'] = { max: targetN10Max };

    // Lägg till N-bidrag i constraints
    combo.forEach((p, idx) => {
      const varName = `x${idx}`;
      model.variables[varName]['nMin'] = p.n10;
      model.variables[varName]['nMax'] = p.n10;
    });
  }

  // P constraint (om mustP)
  if (mustFlags.mustP && targetP > 0) {
    const pMin10 = Math.ceil(pksMinRatio * targetP * 1000);
    const pMax10 = Math.floor(pksMaxRatio * targetP * 1000);
    
    model.constraints['pMin'] = { min: pMin10 };
    model.constraints['pMax'] = { max: pMax10 };
    
    combo.forEach((p, idx) => {
      const varName = `x${idx}`;
      model.variables[varName]['pMin'] = p.p10;
      model.variables[varName]['pMax'] = p.p10;
    });
  }

  // K constraint (om mustK)
  if (mustFlags.mustK && targetK > 0) {
    const kMin10 = Math.ceil(pksMinRatio * targetK * 1000);
    const kMax10 = Math.floor(pksMaxRatio * targetK * 1000);
    
    model.constraints['kMin'] = { min: kMin10 };
    model.constraints['kMax'] = { max: kMax10 };
    
    combo.forEach((p, idx) => {
      const varName = `x${idx}`;
      model.variables[varName]['kMin'] = p.k10;
      model.variables[varName]['kMax'] = p.k10;
    });
  }

  // S constraint (om mustS)
  if (mustFlags.mustS && targetS > 0) {
    const sMin10 = Math.ceil(pksMinRatio * targetS * 1000);
    const sMax10 = Math.floor(pksMaxRatio * targetS * 1000);
    
    model.constraints['sMin'] = { min: sMin10 };
    model.constraints['sMax'] = { max: sMax10 };
    
    combo.forEach((p, idx) => {
      const varName = `x${idx}`;
      model.variables[varName]['sMin'] = p.s10;
      model.variables[varName]['sMax'] = p.s10;
    });
  }

  // Dos-constraints per produkt: 0 <= x_i <= maxDose
  // OBS: Vi sätter INTE minDose i LP-modellen - produkter kan ha dos=0 (ej använda)
  // Vi filtrerar bort produkter med 0 < dos < minDose efter lösning
  combo.forEach((p, idx) => {
    const varName = `x${idx}`;
    model.constraints[`dose_max_${idx}`] = { max: maxDose };
    model.variables[varName][`dose_max_${idx}`] = 1;
  });

  // Lös
  let result;
  try {
    result = Solver.Solve(model);
  } catch (e) {
    return null;
  }

  // Debug: Logga första misslyckade lösning (bara vid problem)
  if (!result || !result.feasible) {
    return null;
  }

  // Extrahera doser och avrunda till heltal
  // Om dos är under minDose, behandla som 0 (produkten används inte)
  const doses: number[] = [];
  let totalCostOre = 0;
  let nAch10 = 0;
  let pAch10 = 0;
  let kAch10 = 0;
  let sAch10 = 0;

  combo.forEach((p, idx) => {
    const varName = `x${idx}`;
    const rawValue = result[varName];
    let dose = Math.round(typeof rawValue === 'number' ? rawValue : 0);
    
    // Om dosen är under minDose, sätt till 0 (använd inte produkten)
    if (dose > 0 && dose < minDose) {
      dose = 0;
    }
    // Om dosen är över maxDose, sätt till maxDose
    if (dose > maxDose) {
      dose = maxDose;
    }
    
    doses.push(dose);

    if (dose > 0) {
      totalCostOre += dose * p.priceOre;
      nAch10 += dose * p.n10;
      pAch10 += dose * p.p10;
      kAch10 += dose * p.k10;
      sAch10 += dose * p.s10;
    }
  });

  // Verifiera feasibility med heltalsdoser
  const nKg = nAch10 / 1000;
  const pKg = pAch10 / 1000;
  const kKg = kAch10 / 1000;
  const sKg = sAch10 / 1000;

  // N-krav (endast om mustN)
  if (mustN && targetN > 0) {
    if (nKg < targetN || nKg > targetN + nToleranceKg) {
      return null;
    }
  }

  // P-krav
  if (mustFlags.mustP && targetP > 0) {
    if (pKg < pksMinRatio * targetP || pKg > pksMaxRatio * targetP) {
      return null;
    }
  }

  // K-krav
  if (mustFlags.mustK && targetK > 0) {
    if (kKg < pksMinRatio * targetK || kKg > pksMaxRatio * targetK) {
      return null;
    }
  }

  // S-krav
  if (mustFlags.mustS && targetS > 0) {
    if (sKg < pksMinRatio * targetS || sKg > pksMaxRatio * targetS) {
      return null;
    }
  }

  // Dos-krav tas redan om hand ovan (under minDose -> 0, över maxDose -> maxDose)
  // Ingen extra verifiering behövs

  // Bygg lösning
  const productDoses = combo
    .map((p, idx) => ({
      product: p,
      dose: doses[idx],
    }))
    .filter(pd => pd.dose > 0);

  if (productDoses.length === 0) {
    return null;
  }

  return {
    feasible: true,
    products: productDoses,
    cost: totalCostOre / 100, // Tillbaka till SEK
    achieved: {
      N: Math.round(nKg * 100) / 100,
      P: Math.round(pKg * 100) / 100,
      K: Math.round(kKg * 100) / 100,
      S: Math.round(sKg * 100) / 100,
    },
  };
}

// ============================================================================
// HUVUDFUNKTION
// ============================================================================

/**
 * Optimera gödselstrategi med MILP
 * 
 * @param products - Alla tillgängliga produkter
 * @param input - Optimeringsinput (targets, mustFlags, config, etc.)
 * @returns OptimizeV5Output med 1-3 strategier
 */
export function optimizeV5(
  products: Product[],
  input: OptimizeV5Input
): OptimizeV5Output {
  
  const { targets, mustFlags, maxProductsUser, minDoseKgHa, maxDoseKgHa } = input;
  
  // Merge input config med defaults
  const config: Required<AlgorithmConfigV5> = {
    ...DEFAULT_ALGORITHM_CONFIG,
    ...input.config,
  };
  
  const maxProductsHard = config.MAX_PRODUCTS_HARD;
  const numStrategies = config.NUM_STRATEGIES;
  
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

  // Validera att minst ett näringsämne är aktivt
  const targetN = targets.N || 0;
  const targetP = targets.P || 0;
  const targetK = targets.K || 0;
  const targetS = targets.S || 0;
  
  // Räkna aktiva näringsämnen baserat på mustFlags och targets
  const mustN = mustFlags.mustN !== false; // default true om ej explicit false
  const activeCount = [
    mustN && targetN > 0,
    mustFlags.mustP && targetP > 0,
    mustFlags.mustK && targetK > 0,
    mustFlags.mustS && targetS > 0,
  ].filter(Boolean).length;
  
  if (activeCount === 0) {
    // Inga näringsämnen är ibockade - returnera tom strategi med kostnad 0
    return {
      status: 'ok',
      usedMaxProducts: 0,
      strategies: [{
        rank: 1,
        totalCostSekHa: 0,
        products: [],
        achieved: { N: 0, P: 0, K: 0, S: 0 },
        percentOfTarget: { N: null, P: null, K: null, S: null },
        mustFlags: { P: mustFlags.mustP, K: mustFlags.mustK, S: mustFlags.mustS },
        warnings: [],
      }],
      message: 'Inga näringsämnen valda - ingen gödsling krävs',
    };
  }

  // Autoökning vid infeasible
  let currentMaxProducts = maxProductsUser;
  let solution: SolverSolution | null = null;

  while (currentMaxProducts <= maxProductsHard) {
    solution = solveMILP(
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
      usedMaxProducts: maxProductsHard,
      strategies: [],
      message: `Ingen lösning hittades även med ${maxProductsHard} produkter. Kontrollera att behovet är rimligt och att produkter finns med rätt näringsinnehåll.`,
    };
  }

  // Bygg strategier med no-good cuts
  const strategies: StrategyResult[] = [];
  const excludedSets: Set<string>[] = [];

  // Strategi 1
  strategies.push(buildStrategyResult(solution, 1, targets, mustFlags, config));
  excludedSets.push(new Set(solution.products.map(p => p.product.id)));

  // Strategi 2 (om numStrategies >= 2)
  if (numStrategies >= 2) {
    const solution2 = solveMILP(
      preparedProducts,
      targets,
      mustFlags,
      currentMaxProducts,
      minDoseKgHa,
      maxDoseKgHa,
      excludedSets,
      config
    );

    if (solution2) {
      strategies.push(buildStrategyResult(solution2, 2, targets, mustFlags, config));
      excludedSets.push(new Set(solution2.products.map(p => p.product.id)));

      // Strategi 3 (om numStrategies >= 3)
      if (numStrategies >= 3) {
        const solution3 = solveMILP(
          preparedProducts,
          targets,
          mustFlags,
          currentMaxProducts,
          minDoseKgHa,
          maxDoseKgHa,
          excludedSets,
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
 * Bygg StrategyResult från SolverSolution
 */
function buildStrategyResult(
  solution: SolverSolution,
  rank: number,
  targets: NutrientNeed,
  mustFlags: { mustP: boolean; mustK: boolean; mustS: boolean },
  config: Required<AlgorithmConfigV5>
): StrategyResult {
  
  const products: ProductAllocationV5[] = solution.products.map(pd => ({
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
      P: mustFlags.mustP,
      K: mustFlags.mustK,
      S: mustFlags.mustS,
    },
    warnings,
  };
}

// ============================================================================
// ADAPTER FÖR BEFINTLIG API
// ============================================================================

/**
 * Adapter för att använda optimize-v5 med befintlig Solution-typ
 */
export function optimizeV5ToSolutions(
  products: Product[],
  need: NutrientNeed,
  options: {
    maxProducts?: number;
    requiredNutrients?: Array<'N' | 'P' | 'K' | 'S'>;
    minDose?: number;
    maxDose?: number;
    /** Algoritm-konfiguration från databas */
    config?: AlgorithmConfigV5;
  } = {}
): import('../models/Solution').Solution[] {
  
  const requiredNutrients = options.requiredNutrients || [];
  
  // Om requiredNutrients är tom array, N är implicit required (bakåtkompatibelt)
  // Om requiredNutrients har värden, N är bara required om 'N' finns i listan
  const mustN = requiredNutrients.length === 0 ? true : requiredNutrients.includes('N');
  
  const input: OptimizeV5Input = {
    targets: need,
    mustFlags: {
      mustN,
      mustP: requiredNutrients.includes('P'),
      mustK: requiredNutrients.includes('K'),
      mustS: requiredNutrients.includes('S'),
    },
    maxProductsUser: options.maxProducts || 2,
    minDoseKgHa: options.minDose || 100,
    maxDoseKgHa: options.maxDose || 600,
    config: options.config,
  };

  const result = optimizeV5(products, input);

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
    score: strategy.totalCostSekHa, // Lägre kostnad = bättre
    notes: strategy.warnings.map(w => 
      `Varning: ${w.nutrient} är ${Math.round(w.ratio * 100)}% av behov (${w.valueKgHa} kg/ha)`
    ),
  }));
}

export default optimizeV5;
