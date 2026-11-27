import { useEffect, useState, useCallback } from 'react';
import {
  FileText, Building2, Users, Plus, Pencil, Trash2,
  Download, X, ChevronDown, Save, Eye, Copy, Share2, ScrollText
} from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import InvoicePreview, { TemplateSelector, type PreviewInvoice } from '../components/invoices/InvoicePreview';
import ShareModal from '../components/invoices/ShareModal';
import AgreementsTab from '../components/invoices/AgreementsTab';
import EntityDetailDrawer from '../components/invoices/EntityDetailDrawer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MyCompany {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  vat_number?: string;
  bank_name?: string;
  bank_account?: string;
  bank_swift?: string;
  logo_url?: string;
}

interface Client {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  vat_number?: string;
  contact_person?: string;
}

interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  my_company_id: string;
  client_id: string;
  issue_date: string;
  due_date?: string;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  currency: string;
  notes?: string;
  tax_rate: number;
  discount: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  template_id?: number;
  company_name?: string;
  client_name?: string;
  items?: InvoiceItem[];
  access?: 'owner' | 'view' | 'edit';
  shared?: boolean;
  owner_name?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'invoices' | 'agreements' | 'companies' | 'clients';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'invoices',   label: 'Invoices',      icon: <FileText size={15} />  },
  { id: 'agreements', label: 'Agreements',    icon: <ScrollText size={15} /> },
  { id: 'companies',  label: 'My Companies',  icon: <Building2 size={15} /> },
  { id: 'clients',    label: 'Clients',       icon: <Users size={15} />     },
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
const STATUSES: Invoice['status'][] = ['draft', 'sent', 'paid', 'cancelled'];

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  paid:      'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue';
const selectCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue bg-white';

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function ModalOverlay({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] ${wide ? 'w-full max-w-4xl' : 'w-full max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="font-semibold text-gray-900 text-lg">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function CompanyModal({ company, onClose, onSaved }: {
  company: MyCompany | null;
  onClose: () => void;
  onSaved: (c: MyCompany) => void;
}) {
  const blank: Omit<MyCompany, 'id'> = {
    name: '', address: '', city: '', country: '', phone: '', email: '',
    vat_number: '', bank_name: '', bank_account: '', bank_swift: '', logo_url: '',
  };
  const [form, setForm] = useState<Omit<MyCompany, 'id'>>(company ? { ...company } : blank);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Company name is required'); return; }
    setSaving(true);
    try {
      const { data } = company
        ? await api.put(`/invoices/my-companies/${company.id}`, form)
        : await api.post('/invoices/my-companies', form);
      toast.success(company ? 'Company updated' : 'Company created');
      onSaved(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <ModalOverlay title={company ? 'Edit Company' : 'New Company'} onClose={onClose}>
      <div className="p-6 space-y-4">
        <Field label="Company Name *">
          <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Acme Corp" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email">
            <input className={inputCls} value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="billing@acme.com" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+1 555 000" />
          </Field>
        </div>
        <Field label="Address">
          <input className={inputCls} value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input className={inputCls} value={form.city || ''} onChange={e => set('city', e.target.value)} placeholder="New York" />
          </Field>
          <Field label="Country">
            <input className={inputCls} value={form.country || ''} onChange={e => set('country', e.target.value)} placeholder="USA" />
          </Field>
        </div>
        <Field label="VAT Number">
          <input className={inputCls} value={form.vat_number || ''} onChange={e => set('vat_number', e.target.value)} placeholder="US123456789" />
        </Field>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Bank Details</p>
          <div className="space-y-3">
            <Field label="Bank Name">
              <input className={inputCls} value={form.bank_name || ''} onChange={e => set('bank_name', e.target.value)} placeholder="First National Bank" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Account Number / IBAN">
                <input className={inputCls} value={form.bank_account || ''} onChange={e => set('bank_account', e.target.value)} placeholder="DE89 3704 0044 ..." />
              </Field>
              <Field label="SWIFT / BIC">
                <input className={inputCls} value={form.bank_swift || ''} onChange={e => set('bank_swift', e.target.value)} placeholder="COBADEFFXXX" />
              </Field>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function ClientModal({ client, onClose, onSaved }: {
  client: Client | null;
  onClose: () => void;
  onSaved: (c: Client) => void;
}) {
  const blank: Omit<Client, 'id'> = {
    name: '', address: '', city: '', country: '', phone: '', email: '', vat_number: '', contact_person: '',
  };
  const [form, setForm] = useState<Omit<Client, 'id'>>(client ? { ...client } : blank);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Client name is required'); return; }
    setSaving(true);
    try {
      const { data } = client
        ? await api.put(`/invoices/clients/${client.id}`, form)
        : await api.post('/invoices/clients', form);
      toast.success(client ? 'Client updated' : 'Client created');
      onSaved(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <ModalOverlay title={client ? 'Edit Client' : 'New Client'} onClose={onClose}>
      <div className="p-6 space-y-4">
        <Field label="Client Name *">
          <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Client Corp" />
        </Field>
        <Field label="Contact Person">
          <input className={inputCls} value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)} placeholder="Jane Smith" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email">
            <input className={inputCls} value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="client@example.com" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+1 555 000" />
          </Field>
        </div>
        <Field label="Address">
          <input className={inputCls} value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="456 Client Ave" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input className={inputCls} value={form.city || ''} onChange={e => set('city', e.target.value)} placeholder="London" />
          </Field>
          <Field label="Country">
            <input className={inputCls} value={form.country || ''} onChange={e => set('country', e.target.value)} placeholder="UK" />
          </Field>
        </div>
        <Field label="VAT Number">
          <input className={inputCls} value={form.vat_number || ''} onChange={e => set('vat_number', e.target.value)} placeholder="GB123456789" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60">
            <Save size={14} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function InvoiceModal({ invoice, companies, clients, onClose, onSaved }: {
  invoice: Invoice | null;
  companies: MyCompany[];
  clients: Client[];
  onClose: () => void;
  onSaved: (inv: Invoice) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const blankItem = (): InvoiceItem => ({ description: '', quantity: 1, unit_price: 0, amount: 0 });

  const [form, setForm] = useState({
    invoice_number: invoice?.invoice_number || '',
    my_company_id:  invoice?.my_company_id  || (companies[0]?.id ?? ''),
    client_id:      invoice?.client_id      || (clients[0]?.id  ?? ''),
    issue_date:     invoice?.issue_date     || today,
    due_date:       invoice?.due_date       || '',
    status:         invoice?.status         || 'draft' as Invoice['status'],
    currency:       invoice?.currency       || 'USD',
    notes:          invoice?.notes          || '',
    tax_rate:       invoice?.tax_rate       ?? 0,
    discount:       invoice?.discount       ?? 0,
    template_id:    invoice?.template_id    ?? 1,
  });

  const [items, setItems] = useState<InvoiceItem[]>(
    invoice?.items?.length ? invoice.items : [blankItem()]
  );
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Recalculate item amounts and totals
  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      updated.amount = updated.quantity * updated.unit_price;
      return updated;
    }));
  };

  const addItem = () => setItems(prev => [...prev, blankItem()]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const subtotal = items.reduce((s, it) => s + it.amount, 0);
  const discounted = subtotal - (form.discount || 0);
  const tax_amount = discounted * ((form.tax_rate || 0) / 100);
  const total = discounted + tax_amount;

  const fmtNum = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const setF = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.invoice_number.trim()) { toast.error('Invoice number is required'); return; }
    if (!form.my_company_id)         { toast.error('Select a company');            return; }
    if (!form.client_id)             { toast.error('Select a client');             return; }
    if (!form.issue_date)            { toast.error('Issue date is required');      return; }
    setSaving(true);
    try {
      const payload = { ...form, items, template_id: form.template_id };
      const { data } = invoice
        ? await api.put(`/invoices/${invoice.id}`, payload)
        : await api.post('/invoices', payload);
      toast.success(invoice ? 'Invoice updated' : 'Invoice created');
      onSaved(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  // Build a PreviewInvoice from current form state for inline preview
  const buildPreviewInvoice = (): PreviewInvoice => {
    const company = companies.find(c => c.id === form.my_company_id);
    const client  = clients.find(c => c.id === form.client_id);
    const subTotal = items.reduce((s, it) => s + it.amount, 0);
    const discounted = subTotal - (form.discount || 0);
    const taxAmt = discounted * ((form.tax_rate || 0) / 100);
    return {
      invoice_number: form.invoice_number || 'PREVIEW',
      issue_date:     form.issue_date,
      due_date:       form.due_date || undefined,
      status:         form.status,
      currency:       form.currency,
      notes:          form.notes || undefined,
      tax_rate:       form.tax_rate,
      discount:       form.discount,
      subtotal:       subTotal,
      tax_amount:     taxAmt,
      total:          discounted + taxAmt,
      template_id:    form.template_id,
      items,
      company: {
        name:         company?.name         || '',
        address:      company?.address      || '',
        city:         company?.city         || '',
        country:      company?.country      || '',
        phone:        company?.phone        || '',
        email:        company?.email        || '',
        vat_number:   company?.vat_number   || '',
        bank_name:    company?.bank_name    || '',
        bank_account: company?.bank_account || '',
        bank_swift:   company?.bank_swift   || '',
        logo_url:     company?.logo_url     || '',
      },
      client: {
        name:           client?.name           || '',
        address:        client?.address        || '',
        city:           client?.city           || '',
        country:        client?.country        || '',
        phone:          client?.phone          || '',
        email:          client?.email          || '',
        vat_number:     client?.vat_number     || '',
        contact_person: client?.contact_person || '',
      },
    };
  };

  const handleDownloadPdf = () => {
    // Open preview modal — user can print/save as PDF from there
    setPreviewing(true);
  };

  return (
    <ModalOverlay title={invoice ? `Edit Invoice ${invoice.invoice_number}` : 'New Invoice'} onClose={onClose} wide>
      <div className="p-6 space-y-5">
        {/* Top row */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Invoice Number *">
            <input className={inputCls} value={form.invoice_number}
              onChange={e => setF('invoice_number', e.target.value)} placeholder="INV-001" />
          </Field>
          <Field label="Status">
            <div className="relative">
              <select className={selectCls} value={form.status} onChange={e => setF('status', e.target.value as Invoice['status'])}>
                {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-gray-400" />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="My Company *">
            <div className="relative">
              <select className={selectCls} value={form.my_company_id} onChange={e => setF('my_company_id', e.target.value)}>
                <option value="">— select company —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-gray-400" />
            </div>
          </Field>
          <Field label="Client *">
            <div className="relative">
              <select className={selectCls} value={form.client_id} onChange={e => setF('client_id', e.target.value)}>
                <option value="">— select client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-gray-400" />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Issue Date *">
            <input type="date" className={inputCls} value={form.issue_date} onChange={e => setF('issue_date', e.target.value)} />
          </Field>
          <Field label="Due Date">
            <input type="date" className={inputCls} value={form.due_date} onChange={e => setF('due_date', e.target.value)} />
          </Field>
          <Field label="Currency">
            <div className="relative">
              <select className={selectCls} value={form.currency} onChange={e => setF('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-2.5 text-gray-400" />
            </div>
          </Field>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Line Items</p>
            <button onClick={addItem}
              className="flex items-center gap-1 text-xs text-monday-blue hover:underline">
              <Plus size={13} /> Add row
            </button>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_80px_110px_110px_36px] gap-0 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 px-3 py-2">
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit Price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_80px_110px_110px_36px] gap-0 border-b border-gray-100 last:border-b-0 px-2 py-1.5 items-center">
                <input
                  className="border-0 bg-transparent text-sm px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full"
                  value={item.description}
                  onChange={e => updateItem(idx, 'description', e.target.value)}
                  placeholder="Service description…"
                />
                <input
                  type="number" min="0" step="0.01"
                  className="border-0 bg-transparent text-sm text-right px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full"
                  value={item.quantity}
                  onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                />
                <input
                  type="number" min="0" step="0.01"
                  className="border-0 bg-transparent text-sm text-right px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full"
                  value={item.unit_price}
                  onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                />
                <div className="text-sm text-right text-gray-700 px-1 font-medium">
                  {fmtNum(item.amount)}
                </div>
                <button onClick={() => removeItem(idx)} disabled={items.length === 1}
                  className="text-gray-300 hover:text-red-400 p-1 rounded disabled:opacity-30">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Tax / discount / totals */}
        <div className="flex gap-6 items-start">
          <div className="flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tax Rate (%)">
                <input type="number" min="0" max="100" step="0.1" className={inputCls}
                  value={form.tax_rate}
                  onChange={e => setF('tax_rate', parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Discount (fixed amount)">
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={form.discount}
                  onChange={e => setF('discount', parseFloat(e.target.value) || 0)} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={`${inputCls} min-h-[72px] resize-y`}
                value={form.notes}
                onChange={e => setF('notes', e.target.value)}
                placeholder="Payment terms, thank-you message, etc." />
            </Field>
          </div>

          {/* Totals panel */}
          <div className="w-56 bg-gray-50 rounded-xl p-4 text-sm space-y-2 flex-shrink-0">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span><span className="font-medium text-gray-800">{fmtNum(subtotal)}</span>
            </div>
            {form.discount > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Discount</span><span className="text-red-500">- {fmtNum(form.discount)}</span>
              </div>
            )}
            {form.tax_rate > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Tax ({form.tax_rate}%)</span><span>{fmtNum(tax_amount)}</span>
              </div>
            )}
            <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900 text-base">
              <span>Total</span><span>{form.currency} {fmtNum(total)}</span>
            </div>
          </div>
        </div>

        {/* Template selector */}
        <TemplateSelector value={form.template_id} onChange={v => setF('template_id', v)} />

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex gap-2">
            <button onClick={() => setPreviewing(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
              <Eye size={14} /> Preview
            </button>
            {invoice && (
              <button onClick={handleDownloadPdf} disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-60">
                <Download size={14} /> {downloading ? 'Opening…' : 'Print / PDF'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60">
              <Save size={14} /> {saving ? 'Saving…' : 'Save Invoice'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview modal (rendered outside the scroll container via portal-like approach) */}
      {previewing && (
        <InvoicePreview
          invoice={buildPreviewInvoice()}
          onClose={() => setPreviewing(false)}
        />
      )}
    </ModalOverlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function InvoicesTab({ companies, clients }: { companies: MyCompany[]; clients: Client[] }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Invoice | null | 'new'>(null);
  const [previewInvoice, setPreviewInvoice] = useState<PreviewInvoice | null>(null);
  const [shareFor, setShareFor] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/invoices');
      setInvoices(data);
    } catch { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this invoice?')) return;
    try {
      await api.delete(`/invoices/${id}`);
      setInvoices(prev => prev.filter(inv => inv.id !== id));
      toast.success('Invoice deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleEdit = async (id: string) => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setModal(data);
    } catch { toast.error('Failed to load invoice'); }
  };

  const handleCopy = async (id: string) => {
    try {
      const { data } = await api.post(`/invoices/${id}/duplicate`);
      setInvoices(prev => [data, ...prev]);
      setModal(data); // open the copy for editing right away
      toast.success('Invoice copied');
    } catch { toast.error('Failed to copy invoice'); }
  };

  const handlePreview = async (inv: Invoice) => {
    try {
      // Load full invoice detail (with items + company/client detail)
      const { data } = await api.get(`/invoices/${inv.id}`);
      const company = companies.find(c => c.id === data.my_company_id);
      const client  = clients.find(c => c.id === data.client_id);
      const preview: PreviewInvoice = {
        invoice_number: data.invoice_number,
        issue_date:     data.issue_date,
        due_date:       data.due_date || undefined,
        status:         data.status,
        currency:       data.currency,
        notes:          data.notes || undefined,
        tax_rate:       data.tax_rate,
        discount:       data.discount,
        subtotal:       data.subtotal,
        tax_amount:     data.tax_amount,
        total:          data.total,
        template_id:    data.template_id ?? 1,
        items:          data.items || [],
        company: {
          name:         company?.name         || data.company_name || '',
          address:      company?.address      || '',
          city:         company?.city         || '',
          country:      company?.country      || '',
          phone:        company?.phone        || '',
          email:        company?.email        || '',
          vat_number:   company?.vat_number   || '',
          bank_name:    company?.bank_name    || '',
          bank_account: company?.bank_account || '',
          bank_swift:   company?.bank_swift   || '',
          logo_url:     company?.logo_url     || '',
        },
        client: {
          name:           client?.name           || data.client_name || '',
          address:        client?.address        || '',
          city:           client?.city           || '',
          country:        client?.country        || '',
          phone:          client?.phone          || '',
          email:          client?.email          || '',
          vat_number:     client?.vat_number     || '',
          contact_person: client?.contact_person || '',
        },
      };
      setPreviewInvoice(preview);
    } catch { toast.error('Failed to load invoice'); }
  };

  const handleDownload = async (inv: Invoice) => {
    // Open preview so user can print/save as PDF
    await handlePreview(inv);
  };

  const handleSaved = (saved: Invoice) => {
    setInvoices(prev => {
      const exists = prev.find(i => i.id === saved.id);
      return exists ? prev.map(i => i.id === saved.id ? saved : i) : [saved, ...prev];
    });
    setModal(null);
  };

  if (loading) return (
    <div className="p-8 space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="animate-pulse h-12 bg-gray-100 rounded-xl" />
      ))}
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600">
          <Plus size={15} /> New Invoice
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No invoices yet</p>
          <p className="text-sm mt-1">Create your first invoice to get started</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Number</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Company</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, idx) => (
                <tr key={inv.id} className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${idx % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <span>{inv.invoice_number}</span>
                      {inv.shared && <span className="text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full" title={`Shared with you (${inv.access})`}>shared · {inv.access}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{inv.client_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{inv.company_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.issue_date}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {inv.currency} {inv.total?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handlePreview(inv)}
                        className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg" title="Preview">
                        <Eye size={14} />
                      </button>
                      {inv.access !== 'view' && (
                        <button onClick={() => handleEdit(inv.id)}
                          className="p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg" title="Edit">
                          <Pencil size={14} />
                        </button>
                      )}
                      {(inv.access ?? 'owner') === 'owner' && (
                        <button onClick={() => handleCopy(inv.id)}
                          className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Copy / Duplicate">
                          <Copy size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDownload(inv)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Print / Save PDF">
                        <Download size={14} />
                      </button>
                      {(inv.access ?? 'owner') === 'owner' && (
                        <button onClick={() => setShareFor(inv)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Share">
                          <Share2 size={14} />
                        </button>
                      )}
                      {(inv.access ?? 'owner') === 'owner' && (
                        <button onClick={() => handleDelete(inv.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <InvoiceModal
          invoice={modal === 'new' ? null : modal}
          companies={companies}
          clients={clients}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {previewInvoice && (
        <InvoicePreview
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
      )}

      {shareFor && (
        <ShareModal base="/invoices" id={shareFor.id} title={`Invoice ${shareFor.invoice_number}`} onClose={() => setShareFor(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANIES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function CompaniesTab({ companies, setCompanies, onOpenDetail }: {
  companies: MyCompany[];
  setCompanies: React.Dispatch<React.SetStateAction<MyCompany[]>>;
  onOpenDetail: (e: { type: 'client' | 'company'; id: string; name: string }) => void;
}) {
  const [modal, setModal] = useState<MyCompany | null | 'new'>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this company?')) return;
    try {
      await api.delete(`/invoices/my-companies/${id}`);
      setCompanies(prev => prev.filter(c => c.id !== id));
      toast.success('Company deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleSaved = (saved: MyCompany) => {
    setCompanies(prev => {
      const exists = prev.find(c => c.id === saved.id);
      return exists ? prev.map(c => c.id === saved.id ? saved : c) : [...prev, saved];
    });
    setModal(null);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{companies.length} compan{companies.length !== 1 ? 'ies' : 'y'}</p>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600">
          <Plus size={15} /> Add Company
        </button>
      </div>

      {companies.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No companies yet</p>
          <p className="text-sm mt-1">Add your company profile to start issuing invoices</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.map(c => (
            <div key={c.id} onClick={() => onOpenDetail({ type: 'company', id: c.id, name: c.name })}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-monday-blue flex items-center justify-center flex-shrink-0">
                  <Building2 size={18} className="text-white" />
                </div>
                <div className="flex gap-1">
                  <button onClick={e => { e.stopPropagation(); setModal(c); }}
                    className="p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg">
                    <Pencil size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="font-semibold text-gray-900 text-sm mb-1">{c.name}</p>
              {(c.city || c.country) && (
                <p className="text-xs text-gray-500">{[c.city, c.country].filter(Boolean).join(', ')}</p>
              )}
              {c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}
              {c.vat_number && <p className="text-xs text-gray-400 mt-0.5">VAT: {c.vat_number}</p>}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <CompanyModal
          company={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ClientsTab({ clients, setClients, onOpenDetail }: {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  onOpenDetail: (e: { type: 'client' | 'company'; id: string; name: string }) => void;
}) {
  const [modal, setModal] = useState<Client | null | 'new'>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this client?')) return;
    try {
      await api.delete(`/invoices/clients/${id}`);
      setClients(prev => prev.filter(c => c.id !== id));
      toast.success('Client deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleSaved = (saved: Client) => {
    setClients(prev => {
      const exists = prev.find(c => c.id === saved.id);
      return exists ? prev.map(c => c.id === saved.id ? saved : c) : [...prev, saved];
    });
    setModal(null);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600">
          <Plus size={15} /> Add Client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No clients yet</p>
          <p className="text-sm mt-1">Add clients to include them on invoices</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(c => (
            <div key={c.id} onClick={() => onOpenDetail({ type: 'client', id: c.id, name: c.name })}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <Users size={18} className="text-purple-600" />
                </div>
                <div className="flex gap-1">
                  <button onClick={e => { e.stopPropagation(); setModal(c); }}
                    className="p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg">
                    <Pencil size={13} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="font-semibold text-gray-900 text-sm mb-1">{c.name}</p>
              {c.contact_person && <p className="text-xs text-gray-500">{c.contact_person}</p>}
              {(c.city || c.country) && (
                <p className="text-xs text-gray-500">{[c.city, c.country].filter(Boolean).join(', ')}</p>
              )}
              {c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}
              {c.vat_number && <p className="text-xs text-gray-400 mt-0.5">VAT: {c.vat_number}</p>}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ClientModal
          client={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function InvoicePage() {
  const [tab, setTab] = useState<Tab>('invoices');
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [clients, setClients]     = useState<Client[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [detail, setDetail] = useState<{ type: 'client' | 'company'; id: string; name: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/invoices/my-companies'),
      api.get('/invoices/clients'),
    ]).then(([comp, cli]) => {
      setCompanies(comp.data);
      setClients(cli.data);
    }).catch(() => toast.error('Failed to load data'))
      .finally(() => setLoadingMeta(false));
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-8 pt-6 pb-0 flex-shrink-0">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-monday-blue flex items-center justify-center">
            <FileText size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
            <p className="text-xs text-gray-500">Manage invoices, companies and clients</p>
          </div>
        </div>

        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
                tab === t.id
                  ? 'border-monday-blue text-monday-blue bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
              ].join(' ')}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingMeta ? (
          <div className="p-8 space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="animate-pulse h-10 bg-gray-100 rounded-xl" />)}
          </div>
        ) : (
          <>
            {tab === 'invoices'   && <InvoicesTab companies={companies} clients={clients} />}
            {tab === 'agreements' && <AgreementsTab companies={companies} clients={clients} />}
            {tab === 'companies'  && <CompaniesTab companies={companies} setCompanies={setCompanies} onOpenDetail={setDetail} />}
            {tab === 'clients'    && <ClientsTab clients={clients} setClients={setClients} onOpenDetail={setDetail} />}
          </>
        )}
      </div>

      {detail && (
        <EntityDetailDrawer entity={detail} companies={companies} clients={clients} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
