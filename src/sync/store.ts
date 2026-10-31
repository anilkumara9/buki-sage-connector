import type { BukiAccount, BukiLedgerEntry } from '../buki/schemas.js';

// In-memory Buki store for staging / tests. Production replaces this
// with Buki's real ledger API / DB behind the same two methods.
export class BukiStore {
  accounts = new Map<string, BukiAccount>();
  ledger = new Map<string, BukiLedgerEntry>();
  errors: Array<{ at: string; message: string; context: Record<string, unknown> }> = [];

  upsertAccount(a: BukiAccount) { this.accounts.set(a.externalId, a); }
  upsertLedger(e: BukiLedgerEntry) { this.ledger.set(`${e.kind}:${e.externalId}`, e); }
  logError(message: string, context: Record<string, unknown>) {
    const entry = { at: new Date().toISOString(), message, context };
    this.errors.push(entry);
    console.error('[ingestion]', message, context);
  }
}
