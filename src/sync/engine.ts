import { mapContactToBuki, mapInvoiceToBuki, mapPaymentToBuki, IngestionError } from '../buki/mappers.js';
import type { SageClient } from '../sage/client.js';
import { SageContactSchema, SagePaymentSchema, SageSalesInvoiceSchema } from '../sage/schemas.js';
import type { BukiStore } from './store.js';

export interface SyncResult {
  contacts: number;
  invoices: number;
  payments: number;
  skipped: number;
  highWaterMark: string | null;
}

export class SyncEngine {
  private highWaterMark: string | null = null;

  constructor(
    private client: SageClient,
    private store: BukiStore,
    private opts: { monthsBack?: number; logger?: Pick<Console, 'log' | 'error'> } = {},
  ) {}

  getHighWaterMark() { return this.highWaterMark; }
  setHighWaterMark(v: string | null) { this.highWaterMark = v; }

  private sinceDate(): string | undefined {
    // Historical scope assumption (PROOF.md): active accounts, past 12 months,
    // unless we already have a high-water mark — then incremental only.
    if (this.highWaterMark) return this.highWaterMark;
    const months = this.opts.monthsBack ?? 12;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString();
  }

  private touch(updatedAt: string) {
    if (!this.highWaterMark || updatedAt > this.highWaterMark) this.highWaterMark = updatedAt;
  }

  async runFullSync(): Promise<SyncResult> {
    const since = this.sinceDate();
    const result: SyncResult = { contacts: 0, invoices: 0, payments: 0, skipped: 0, highWaterMark: this.highWaterMark };

    for await (const page of this.client.paginate('/contacts', since)) {
      for (const raw of page) {
        const parsed = SageContactSchema.safeParse(raw);
        if (!parsed.success) { result.skipped++; this.store.logError('Invalid Sage contact', { issues: parsed.error.issues }); continue; }
        // Historical scope: active only on first sync
        if (!this.highWaterMark && (parsed.data.status_id ?? '').toUpperCase() === 'INACTIVE') continue;
        this.store.upsertAccount(mapContactToBuki(parsed.data));
        this.touch(parsed.data.updated_at);
        result.contacts++;
      }
    }

    for await (const page of this.client.paginate('/sales_invoices', since)) {
      for (const raw of page) {
        const parsed = SageSalesInvoiceSchema.safeParse(raw);
        if (!parsed.success) { result.skipped++; this.store.logError('Invalid Sage invoice', { issues: parsed.error.issues }); continue; }
        try {
          this.store.upsertLedger(mapInvoiceToBuki(parsed.data));
          this.touch(parsed.data.updated_at);
          result.invoices++;
        } catch (e) {
          if (e instanceof IngestionError) { result.skipped++; this.store.logError(e.message, e.context); continue; }
          throw e;
        }
      }
    }

    // Payments endpoint name varies by Sage region; sales_invoices payments
    // are also covered via contact_payments in the full API. Keep it isolated
    // so a 404 here doesn't kill contacts/invoices sync.
    try {
      for await (const page of this.client.paginate('/contact_payments', since)) {
        for (const raw of page) {
          const parsed = SagePaymentSchema.safeParse(raw);
          if (!parsed.success) { result.skipped++; continue; }
          this.store.upsertLedger(mapPaymentToBuki(parsed.data));
          this.touch(parsed.data.updated_at);
          result.payments++;
        }
      }
    } catch (e: any) {
      if (e?.status !== 404) throw e;
      // Optional endpoint in some tenants — not an ingestion error
      console.log('[sync] contact_payments not available in this Sage tenant — skipped');
    }

    result.highWaterMark = this.highWaterMark;
    return result;
  }
}
