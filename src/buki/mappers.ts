import type { SageContact, SagePayment, SageSalesInvoice } from '../sage/schemas.js';
import { toMinor, type BukiAccount, type BukiLedgerEntry } from './schemas.js';

export function mapContactToBuki(c: SageContact): BukiAccount {
  const inactive = (c.status_id ?? '').toUpperCase() === 'INACTIVE';
  return {
    externalId: c.id,
    source: 'sage',
    name: c.displayed_as,
    email: c.email ?? null,
    status: inactive ? 'inactive' : 'active',
    currency: c.currency_id || 'GBP',
    balanceMinor: toMinor(c.balance ?? 0),
    creditLimitMinor: c.credit_limit == null ? null : toMinor(c.credit_limit),
    updatedAt: c.updated_at,
  };
}

export class IngestionError extends Error {
  constructor(
    message: string,
    public context: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

export function mapInvoiceToBuki(inv: SageSalesInvoice): BukiLedgerEntry {
  // Missing tax is a data quality problem Buki should surface, not swallow
  // and not crash on. Caller logs this and skips the single record.
  if (inv.tax_amount === null || inv.tax_amount === undefined) {
    throw new IngestionError(
      `Sage sales invoice ${inv.id} is missing tax_amount — cannot reconcile net + tax = total for Buki ledger`,
      { invoiceId: inv.id, contactId: inv.contact_id, net: inv.net_amount, total: inv.total_amount },
    );
  }
  return {
    externalId: inv.id,
    source: 'sage',
    accountExternalId: inv.contact_id,
    kind: 'invoice',
    date: inv.date,
    dueDate: inv.due_date ?? null,
    reference: inv.reference ?? null,
    status: inv.status_id.toLowerCase(),
    currency: inv.currency_id,
    netMinor: toMinor(inv.net_amount),
    taxMinor: toMinor(inv.tax_amount),
    totalMinor: toMinor(inv.total_amount),
    outstandingMinor: toMinor(inv.amount_outstanding),
    updatedAt: inv.updated_at,
  };
}

export function mapPaymentToBuki(p: SagePayment): BukiLedgerEntry {
  return {
    externalId: p.id,
    source: 'sage',
    accountExternalId: p.contact_id,
    kind: 'payment',
    date: p.date,
    dueDate: null,
    reference: p.reference ?? null,
    status: 'paid',
    currency: p.currency_id,
    netMinor: toMinor(p.total_amount),
    taxMinor: 0,
    totalMinor: toMinor(p.total_amount),
    outstandingMinor: 0,
    updatedAt: p.updated_at,
  };
}
