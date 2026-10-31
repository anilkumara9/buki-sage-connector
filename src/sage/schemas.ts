import { z } from 'zod';

// Sage Accounting v3.1 shapes, trimmed to what Buki syncs.
// Money comes back as strings/floats depending on endpoint version —
// coerce to number and keep the raw currency code alongside.

const money = z.coerce.number();

export const SageContactSchema = z.object({
  id: z.string(),
  displayed_as: z.string(),
  contact_type_ids: z.array(z.string()).default([]),
  is_customer: z.boolean().optional(),
  is_supplier: z.boolean().optional(),
  status_id: z.string().optional(), // ACTIVE / INACTIVE in Sage
  email: z.string().email().nullable().optional(),
  main_address: z
    .object({
      city: z.string().nullable().optional(),
      country_id: z.string().nullable().optional(),
      postal_code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  credit_limit: money.nullable().optional(),
  credit_days: z.coerce.number().nullable().optional(),
  // balance is present on ledger views; treat missing as 0, never crash
  balance: money.default(0),
  currency_id: z.string().default('GBP'),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SageContact = z.infer<typeof SageContactSchema>;

export const SageInvoiceLineSchema = z.object({
  id: z.string().optional(),
  description: z.string().default(''),
  quantity: z.coerce.number().default(1),
  unit_price: money.default(0),
  tax_rate_id: z.string().nullable().optional(),
  // The proof test deliberately sends a line/invoice with no tax —
  // that must be a logged validation error, not a crash.
  tax_amount: money.nullable().optional(),
  net_amount: money.nullable().optional(),
  total_amount: money.nullable().optional(),
});

export const SageSalesInvoiceSchema = z.object({
  id: z.string(),
  contact_id: z.string(),
  date: z.string(),
  due_date: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  status_id: z.string().default('DRAFT'),
  currency_id: z.string().default('GBP'),
  net_amount: money.default(0),
  tax_amount: money.nullable().optional(), // missing tax -> validation path
  total_amount: money.default(0),
  amount_paid: money.default(0),
  amount_outstanding: money.default(0),
  invoice_lines: z.array(SageInvoiceLineSchema).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SageSalesInvoice = z.infer<typeof SageSalesInvoiceSchema>;

export const SagePaymentSchema = z.object({
  id: z.string(),
  contact_id: z.string(),
  date: z.string(),
  reference: z.string().nullable().optional(),
  total_amount: money,
  currency_id: z.string().default('GBP'),
  payment_method_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SagePayment = z.infer<typeof SagePaymentSchema>;

// Sage list responses: $items + pagination links. We support both the
// documented cursor style ($next) and items-per-page fallback.
export const SageListSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    $total: z.coerce.number().optional(),
    $page: z.coerce.number().optional(),
    $next: z.string().nullable().optional(),
    $back: z.string().nullable().optional(),
    $items: z.array(item),
  });
