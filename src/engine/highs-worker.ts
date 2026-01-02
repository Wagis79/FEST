/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * HiGHS Worker Process
 * 
 * Körs som separat process för att isolera WASM-krascher.
 * Kommunicerar via stdin/stdout med JSON-meddelanden.
 * 
 * VIKTIGT: Denna fil använder console.log/console.error medvetet:
 * - console.log() = stdout = JSON-svar till huvudprocessen (IPC)
 * - console.error() = stderr = debug-loggning (fångas av highs-pool.ts → Winston)
 * 
 * Använd INTE winston/log direkt här - det skulle blanda ihop IPC-protokollet.
 * 
 * Användning:
 *   node --loader tsx highs-worker.ts
 *   
 * Input (JSON på stdin):
 *   { "type": "solve", "lp": "Minimize\n obj: ..." }
 *   
 * Output (JSON på stdout):
 *   { "type": "result", "status": "Optimal", "columns": {...} }
 *   { "type": "error", "message": "..." }
 */

import * as readline from 'readline';

interface SolveRequest {
  type: 'solve';
  lp: string;
  id?: string;
}

interface SolveResponse {
  type: 'result' | 'error';
  id?: string;
  status?: string;
  columns?: Record<string, { Primal: number }>;
  objectiveValue?: number;
  message?: string;
}

/** HiGHS solver interface */
interface HighsSolver {
  solve(lp: string): {
    Status: string;
    Columns: Record<string, { Primal: number }>;
    ObjectiveValue: number;
  };
}

let highs: HighsSolver | null = null;
let solveCount = 0;
const MAX_SOLVES_BEFORE_EXIT = 3; // Avsluta efter 3 solves - balans mellan stabilitet och 3 strategier

async function initHiGHS(): Promise<void> {
  if (highs) return;
  
  try {
    const highsModule = await import('highs');
    const loader = highsModule.default || highsModule;
    highs = await loader({}) as HighsSolver;
    console.error('[worker] HiGHS initialized'); // stderr för debug
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[worker] Failed to init HiGHS:', msg);
    process.exit(1);
  }
}

function solve(lp: string): SolveResponse {
  try {
    const result = highs!.solve(lp);
    solveCount++;
    
    return {
      type: 'result',
      status: result.Status,
      columns: result.Columns,
      objectiveValue: result.ObjectiveValue,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      type: 'error',
      message: msg,
    };
  }
}

async function main(): Promise<void> {
  await initHiGHS();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  
  rl.on('line', (line: string) => {
    try {
      const request: SolveRequest = JSON.parse(line);
      
      if (request.type === 'solve') {
        const response = solve(request.lp);
        response.id = request.id;
        
        // Skicka svar på stdout
        console.log(JSON.stringify(response));
        
        // Avsluta om vi nått gränsen
        if (solveCount >= MAX_SOLVES_BEFORE_EXIT) {
          console.error(`[worker] Reached ${MAX_SOLVES_BEFORE_EXIT} solves, exiting for memory cleanup`);
          process.exit(0);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorResponse: SolveResponse = {
        type: 'error',
        message: `Parse error: ${msg}`,
      };
      console.log(JSON.stringify(errorResponse));
    }
  });
  
  rl.on('close', () => {
    console.error('[worker] stdin closed, exiting');
    process.exit(0);
  });
  
  // Hantera SIGTERM gracefully
  process.on('SIGTERM', () => {
    console.error('[worker] SIGTERM received, exiting');
    process.exit(0);
  });
  
  console.error('[worker] Ready for requests');
}

main().catch((e) => {
  console.error('[worker] Fatal error:', e);
  process.exit(1);
});
