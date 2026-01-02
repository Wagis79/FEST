/**
 * FEST - Fertilizer Decision Support System
 * Copyright (c) 2025 Johan Wågstam <wagis79@gmail.com>
 * All rights reserved.
 */

/*
  Smoke test for admin security without opening a TCP port.
  This avoids terminal/tooling limitations where background servers get interrupted.

  It simulates HTTP requests directly against the Express app.
*/

import app from './server';

type SimResult = {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
};

/** Minimal request-like object for testing */
interface MockRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query: Record<string, string>;
  ip: string;
  socket: { remoteAddress: string };
}

/** Minimal response-like object for testing */
interface MockResponse {
  statusCode: number;
  _headers: Record<string, string | string[]>;
  _body: string;
  setHeader(name: string, value: string | string[]): void;
  getHeader(name: string): string | string[] | undefined;
  status(code: number): MockResponse;
  json(obj: unknown): void;
  send(payload: unknown): void;
  end(): void;
}

function simulate(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<SimResult> {
  return new Promise((resolve) => {
    const req: MockRequest = {
      method,
      url: path,
      path,
      headers: Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      ),
      body,
      query: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };

    const res: MockResponse = {
      statusCode: 200,
      _headers: {} as Record<string, string | string[]>,
      _body: '' as string,
      setHeader(name: string, value: string | string[]) {
        this._headers[name.toLowerCase()] = value;
      },
      getHeader(name: string) {
        return this._headers[name.toLowerCase()];
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(obj: unknown) {
        this.setHeader('content-type', 'application/json');
        this._body = JSON.stringify(obj);
        resolve({ status: this.statusCode, headers: this._headers, body: this._body });
      },
      send(payload: unknown) {
        this._body = typeof payload === 'string' ? payload : String(payload);
        resolve({ status: this.statusCode, headers: this._headers, body: this._body });
      },
      end() {
        resolve({ status: this.statusCode, headers: this._headers, body: this._body });
      },
    };
    try {
      // Express apps are callable request handlers
      (app as unknown as (req: MockRequest, res: MockResponse) => void)(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resolve({
        status: 500,
        headers: res._headers,
        body: `simulate() crash: ${msg}`,
      });
    }
  });
}

(async () => {
  const r1 = await simulate('GET', '/health');
  console.log('GET /health ->', r1.status, r1.body);

  const r2 = await simulate('GET', '/admin.html');
  console.log('GET /admin.html (no auth) ->', r2.status, 'www-authenticate:', r2.headers['www-authenticate']);

  const r3 = await simulate('GET', '/api/admin/products');
  console.log('GET /api/admin/products (no api key) ->', r3.status, r3.body);

  // If you want to test api key success, set X-API-Key to process.env.ADMIN_API_KEY
  // but that requires a live Supabase connection, so we don't do it here.
})();
