// Mock Sage server as a fetch function — no network, no real credentials.
export function makeContact(i: number) {
  return {
    id: `contact-${i}`,
    displayed_as: `Customer ${i}`,
    contact_type_ids: ['CUSTOMER'],
    is_customer: true,
    status_id: 'ACTIVE',
    email: `customer${i}@example.com`,
    balance: 100 + i,
    currency_id: 'GBP',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

export function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    contact_id: 'contact-1',
    date: '2026-10-01',
    due_date: '2026-10-31',
    reference: 'INV-001',
    status_id: 'PAID',
    currency_id: 'GBP',
    net_amount: 100,
    tax_amount: 20,
    total_amount: 120,
    amount_paid: 120,
    amount_outstanding: 0,
    invoice_lines: [{ description: 'Service', quantity: 1, unit_price: 100, tax_amount: 20 }],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function tokenResponse(access = 'fresh-token') {
  return jsonResponse({ access_token: access, refresh_token: 'refresh-2', token_type: 'Bearer', expires_in: 3600 });
}
