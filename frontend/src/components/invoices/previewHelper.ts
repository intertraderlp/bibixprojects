import type { PreviewInvoice } from './InvoicePreview';

type Company = { id: string; name: string; address?: string; city?: string; country?: string; phone?: string; email?: string; vat_number?: string; bank_name?: string; bank_account?: string; bank_swift?: string; logo_url?: string };
type Client = { id: string; name: string; address?: string; city?: string; country?: string; phone?: string; email?: string; vat_number?: string; contact_person?: string };

// Build the InvoicePreview payload from a full invoice record + the known
// companies/clients (falls back to the names embedded on the invoice).
export function buildPreviewInvoice(data: Record<string, unknown>, companies: Company[], clients: Client[]): PreviewInvoice {
  const company = companies.find(c => c.id === data.my_company_id);
  const client = clients.find(c => c.id === data.client_id);
  return {
    invoice_number: data.invoice_number as string,
    issue_date: data.issue_date as string,
    due_date: (data.due_date as string) || undefined,
    status: data.status as PreviewInvoice['status'],
    currency: data.currency as string,
    notes: (data.notes as string) || undefined,
    tax_rate: data.tax_rate as number,
    discount: data.discount as number,
    subtotal: data.subtotal as number,
    tax_amount: data.tax_amount as number,
    total: data.total as number,
    template_id: (data.template_id as number) ?? 1,
    items: (data.items as PreviewInvoice['items']) || [],
    company: {
      name: company?.name || (data.company_name as string) || '',
      address: company?.address || '', city: company?.city || '', country: company?.country || '',
      phone: company?.phone || '', email: company?.email || '', vat_number: company?.vat_number || '',
      bank_name: company?.bank_name || '', bank_account: company?.bank_account || '', bank_swift: company?.bank_swift || '',
      logo_url: company?.logo_url || '',
    },
    client: {
      name: client?.name || (data.client_name as string) || '',
      address: client?.address || '', city: client?.city || '', country: client?.country || '',
      phone: client?.phone || '', email: client?.email || '', vat_number: client?.vat_number || '',
      contact_person: client?.contact_person || '',
    },
  };
}
