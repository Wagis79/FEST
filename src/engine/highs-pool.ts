/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/**
 * HiGHS Worker Pool
 * 
 * Hanterar en pool av HiGHS worker-processer för crash isolation.
 * Varje worker körs i sin egen process så WASM-krascher inte påverkar servern.
 * 
 * Features:
 * - Automatisk spawning av workers vid behov
 * - Timeout-hantering för långsamma solve
 * - Automatisk restart av kraschade workers
 * - Kö-hantering för concurrent requests
 */

import { spawn, fork, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as readline from 'readline';

export interface HighsResult {
  status: string;
  columns: Record<string, { Primal: number }>;
  objectiveValue?: number;
}

interface PendingRequest {
  id: string;
  resolve: (result: HighsResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface WorkerInfo {
  process: ChildProcess;
  rl: readline.Interface;
  busy: boolean;
  solveCount: number;
  pendingRequests: Map<string, PendingRequest>;
}

class HighsPool extends EventEmitter {
  private workers: WorkerInfo[] = [];
  private readonly maxWorkers: number;
  private readonly solveTimeout: number;
  private readonly maxSolvesPerWorker: number;
  private requestQueue: Array<{ lp: string; resolve: (result: HighsResult) => void; reject: (error: Error) => void }> = [];
  private requestIdCounter = 0;
  private isShuttingDown = false;

  constructor(options: {
    maxWorkers?: number;
    solveTimeout?: number;
    maxSolvesPerWorker?: number;
  } = {}) {
    super();
    this.maxWorkers = options.maxWorkers ?? 2;
    this.solveTimeout = options.solveTimeout ?? 30000; // 30 sekunder default
    this.maxSolvesPerWorker = options.maxSolvesPerWorker ?? 50;
  }

  /**
   * Spawna en ny worker-process
   */
  private spawnWorker(): WorkerInfo {
    // Hitta worker-filen relativt till cwd (projektroten)
    const workerPath = path.join(process.cwd(), 'src', 'engine', 'highs-worker.ts');
    
    // Hitta npx/tsx path
    const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    
    // Använd npx tsx för att köra TypeScript (utan shell för säkerhet)
    const proc = spawn(npxPath, ['tsx', workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    const rl = readline.createInterface({
      input: proc.stdout!,
      terminal: false,
    });

    const worker: WorkerInfo = {
      process: proc,
      rl,
      busy: false,
      solveCount: 0,
      pendingRequests: new Map(),
    };

    // Hantera svar från worker
    rl.on('line', (line: string) => {
      try {
        const response = JSON.parse(line);
        const pending = worker.pendingRequests.get(response.id);
        
        if (pending) {
          clearTimeout(pending.timeout);
          worker.pendingRequests.delete(response.id);
          worker.busy = false;
          
          if (response.type === 'result') {
            pending.resolve({
              status: response.status,
              columns: response.columns,
              objectiveValue: response.objectiveValue,
            });
            // Processa nästa request i kön
            this.processQueue();
          } else {
            // WASM-fel - döda workern så nästa request får en färsk instans
            const isWasmError = response.message?.includes('memory access') ||
                                response.message?.includes('Aborted') ||
                                response.message?.includes('null function');
            if (isWasmError) {
              console.log(`[pool] WASM error detected, killing worker ${worker.process.pid}`);
              worker.process.kill('SIGKILL');
            }
            pending.reject(new Error(response.message || 'Unknown error'));
            // Processa nästa request i kön (spawnar ny worker om behövs)
            this.processQueue();
          }
        }
      } catch (e) {
        console.error('[pool] Failed to parse worker response:', line);
      }
    });

    // Hantera stderr (debug output)
    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[worker-${proc.pid}]`, data.toString().trim());
    });

    // Hantera worker-krasch
    proc.on('exit', (code, signal) => {
      console.error(`[pool] Worker ${proc.pid} exited (code=${code}, signal=${signal})`);
      
      // Reject alla pending requests
      for (const [id, pending] of worker.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Worker crashed (code=${code})`));
      }
      
      // Ta bort från pool
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) {
        this.workers.splice(idx, 1);
      }
      
      // Processa kön (spawnar ny worker vid behov)
      if (!this.isShuttingDown) {
        this.processQueue();
      }
    });

    this.workers.push(worker);
    console.log(`[pool] Spawned worker ${proc.pid} (total: ${this.workers.length})`);
    
    return worker;
  }

  /**
   * Hitta en ledig worker eller skapa ny
   */
  private getAvailableWorker(): WorkerInfo | null {
    // Hitta ledig worker som inte nått sin gräns
    for (const worker of this.workers) {
      if (!worker.busy && worker.solveCount < this.maxSolvesPerWorker) {
        return worker;
      }
    }
    
    // Spawna ny om vi inte nått max
    if (this.workers.length < this.maxWorkers) {
      return this.spawnWorker();
    }
    
    return null;
  }

  /**
   * Processa requests från kön
   */
  private processQueue(): void {
    while (this.requestQueue.length > 0) {
      const worker = this.getAvailableWorker();
      if (!worker) break;
      
      const request = this.requestQueue.shift()!;
      this.executeOnWorker(worker, request.lp)
        .then(request.resolve)
        .catch(request.reject);
    }
  }

  /**
   * Kör solve på en specifik worker
   */
  private async executeOnWorker(worker: WorkerInfo, lp: string): Promise<HighsResult> {
    return new Promise((resolve, reject) => {
      const id = `req-${++this.requestIdCounter}`;
      
      const timeout = setTimeout(() => {
        worker.pendingRequests.delete(id);
        worker.busy = false;
        
        // Döda worker vid timeout
        console.error(`[pool] Killing worker ${worker.process.pid} due to timeout`);
        worker.process.kill('SIGKILL');
        
        reject(new Error('Solve timeout'));
      }, this.solveTimeout);

      const pending: PendingRequest = { id, resolve, reject, timeout };
      worker.pendingRequests.set(id, pending);
      worker.busy = true;
      worker.solveCount++;

      // Skicka request till worker
      const request = JSON.stringify({ type: 'solve', lp, id });
      worker.process.stdin?.write(request + '\n');
    });
  }

  /**
   * Lös ett LP-problem
   */
  async solve(lp: string): Promise<HighsResult> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    // Försök hitta ledig worker
    const worker = this.getAvailableWorker();
    
    if (worker) {
      return this.executeOnWorker(worker, lp);
    }
    
    // Lägg i kö
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ lp, resolve, reject });
    });
  }

  /**
   * Stäng av poolen
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // Reject alla requests i kön
    for (const req of this.requestQueue) {
      req.reject(new Error('Pool shutdown'));
    }
    this.requestQueue = [];
    
    // Stäng alla workers
    for (const worker of this.workers) {
      worker.process.kill('SIGTERM');
    }
    
    // Vänta på att alla stängs
    await Promise.all(
      this.workers.map(w => new Promise<void>(resolve => {
        w.process.on('exit', () => resolve());
        setTimeout(() => {
          w.process.kill('SIGKILL');
          resolve();
        }, 5000);
      }))
    );
    
    this.workers = [];
    console.log('[pool] Shutdown complete');
  }

  /**
   * Hämta statistik
   */
  getStats(): { workers: number; queueLength: number; totalSolves: number } {
    return {
      workers: this.workers.length,
      queueLength: this.requestQueue.length,
      totalSolves: this.workers.reduce((sum, w) => sum + w.solveCount, 0),
    };
  }

  /**
   * Synkron cleanup för process exit handlers
   */
  cleanup(): void {
    this.isShuttingDown = true;
    
    // Reject alla requests i kön
    for (const req of this.requestQueue) {
      req.reject(new Error('Pool cleanup'));
    }
    this.requestQueue = [];
    
    // Döda alla workers
    for (const worker of this.workers) {
      worker.process.kill('SIGKILL');
    }
    
    this.workers = [];
  }
}

// Singleton-instans
let poolInstance: HighsPool | null = null;

export function getHighsPool(): HighsPool {
  if (!poolInstance) {
    poolInstance = new HighsPool({
      maxWorkers: 2,
      solveTimeout: 30000,
      maxSolvesPerWorker: 50,
    });
  }
  return poolInstance;
}

export async function shutdownHighsPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
}
