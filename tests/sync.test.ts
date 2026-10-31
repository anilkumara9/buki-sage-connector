import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SageOAuth } from '../src/auth/oauth.js';
import { MemoryTokenStore } from '../src/auth/tokenStore.js';
import { SageClient } from '../src/sage/client.js';
import { BukiStore } from '../src/sync/store.js';
import { SyncEngine } from '../src/sync/engine.js';
import { jsonResponse, makeContact, makeInvoice, tokenResponse } from './mockSage.js';

function setup(fetchFn: typeof fetch, sleep = async (_ms: number) => {}) {
  const config = loadConfig({ SAGE_CLIENT_ID: 'test-id', SAGE_CLIENT_SECRET: 'test-secret', SAGE_TOKEN_URL: 'https://oauth.example/token', SAGE_API_BASE: 'https://api.accounting.sage.com/v3.1' } as any);
  const store = new MemoryTokenStore();
  // Start with a token that looks locally valid
  store.save({ access_token: 'stale-token', refresh_token: 'refresh-1', token_type: 'Bearer', expires_at: Date.now() + 3_600_000 });
  const oauth = new SageOAuth(config, store, fetchFn);
  const client = new SageClient(config, oauth, { fetchFn, sleep, baseDelayMs: 10, maxRetries: 5 });
  const buki = new BukiStore();
  const engine = new SyncEngine(client, buki);
  return { config, store, oauth, client, buki, engine };
}

const emptyInvoices = () => jsonResponse({ $items: [], $next: null });
const notFound = () => jsonResponse({ error: 'not found' }, 404);

describe('Proof test list', () => {
  it('1. invalid Sage OAuth token → 401 triggers refresh handshake and retry succeeds', async () => {
    let apiCalls = 0;
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('oauth.example')) { tokenCalls++; return tokenResponse('fresh-token'); }
      apiCalls++;
      if (apiCalls === 1) return jsonResponse({ error: 'invalid_token' }, 401);
      return jsonResponse({ ok: true, data: 'ledger' });
    }) as unknown as typeof fetch;

    const { client } = setup(fetchFn);
    const result = await client.getJson('/contacts');
    expect(result).toEqual({ ok: true, data: 'ledger' });
    expect(tokenCalls).toBe(1);
    expect(apiCalls).toBe(2);
  });

  it('2. query 100 Sage customers → Buki mirrors customer counts exactly', async () => {
    const customers = Array.from({ length: 100 }, (_, i) => makeContact(i + 1));
    const fetchFn = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('oauth.example')) return tokenResponse();
      if (u.includes('/contacts')) return jsonResponse({ $items: customers, $next: null, $total: 100 });
      if (u.includes('/sales_invoices')) return emptyInvoices();
      if (u.includes('/contact_payments')) return notFound();
      return notFound();
    }) as unknown as typeof fetch;

    const { engine, buki } = setup(fetchFn);
    const result = await engine.runFullSync();
    expect(result.contacts).toBe(100);
    expect(buki.accounts.size).toBe(100);
    expect(buki.accounts.get('contact-42')?.name).toBe('Customer 42');
    expect(buki.accounts.get('contact-42')?.balanceMinor).toBe(14200);
  });

  it('3. invoice payload with missing tax field → logs descriptive error without crashing', async () => {
    const badInvoice = makeInvoice({ tax_amount: null });
    const fetchFn = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('oauth.example')) return tokenResponse();
      if (u.includes('/contacts')) return jsonResponse({ $items: [makeContact(1)], $next: null });
      if (u.includes('/sales_invoices')) return jsonResponse({ $items: [badInvoice], $next: null });
      if (u.includes('/contact_payments')) return notFound();
      return notFound();
    }) as unknown as typeof fetch;

    const { engine, buki } = setup(fetchFn);
    const result = await engine.runFullSync(); // must not throw
    expect(result.invoices).toBe(0);
    expect(result.skipped).toBe(1);
    expect(buki.errors).toHaveLength(1);
    expect(buki.errors[0].message).toMatch(/missing tax_amount/);
    expect(buki.errors[0].context.invoiceId).toBe('inv-1');
    // Other data still syncs
    expect(buki.accounts.size).toBe(1);
  });

  it('4. Sage 429 rate limit → exponential backoff delays and completes on retry', async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => { delays.push(ms); };
    let apiCalls = 0;
    const fetchFn = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('oauth.example')) return tokenResponse();
      apiCalls++;
      if (apiCalls <= 2) return jsonResponse({ error: 'rate_limited' }, 429);
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const { client } = setup(fetchFn, sleep);
    const result = await client.getJson('/contacts');
    expect(result).toEqual({ ok: true });
    expect(apiCalls).toBe(3);
    expect(delays).toHaveLength(2);
    // Exponential: second delay > first (base 10ms, jitter <100 — check growth trend via base component)
    expect(delays[1]).toBeGreaterThanOrEqual(20);
  });
});
