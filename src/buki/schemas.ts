import { z } from 'zod';

// Buki-side records — intentionally simpler and finance-team shaped.
// Amounts stay in minor units (pence/cents) to avoid float drift in the ledger.
export const BukiAccountSchema = z.object({
  externalId: z.string(), // Sage contact id
  source: z.literal('sage'),
  name: z.string(),
  email: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  currency: z.string().length(3),
  balanceMinor: z.number().int(),
  creditLimitMinor: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type BukiAccount = z.infer<typeof BukiAccountSchema>;

export const BukiLedgerEntrySchema = z.object({
  externalId: z.string(),
  source: z.literal('sage'),
  accountExternalId: z.string(),
  kind: z.enum(['invoice', 'payment']),
  date: z.string(),
  dueDate: z.string().nullable(),
  reference: z.string().nullable(),
  status: z.string(),
  currency: z.string().length(3),
  netMinor: z.number().int(),
  taxMinor: z.number().int().nullable(),
  totalMinor: z.number().int(),
  outstandingMinor: z.number().int(),
  updatedAt: z.string(),
});
export type BukiLedgerEntry = z.infer<typeof BukiLedgerEntrySchema>;

export function toMinor(amount: number): number {
  // Sage amounts have 2dp precision; round, don't truncate.
  return Math.round(amount * 100);
}
