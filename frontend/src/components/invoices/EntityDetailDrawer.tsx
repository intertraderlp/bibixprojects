import { useEffect, useState } from 'react';
import { X, FileText, Eye, Download, Loader2, Building2, Users } from 'lucide-react';
import api from '../../api/client';
import toast from 'react-hot-toast';
import InvoicePreview, { type PreviewInvoice } from './InvoicePreview';
import { buildPreviewInvoice } from './previewHelper';
import { downloadAgreement, type Agreement } from './AgreementsTab';

type Company = { id: string; name: string };
type Client = { id: string; name: string };
interface InvoiceRow {
  id: string; invoice_number: string; issue_date: string; status: string; currency: string; total: number;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-600',
};

// Shows all invoices + agreements linked to one client or company.
export default function EntityDetailDrawer({ entity, companies, clients, onClose }: {
  entity: { type: 'client' | 'company'; id: string; name: string };
  companies: Company[]; clients: Client[]; onClose: () => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewInvoice | null>(null);

  const q = entity.type === 'client' ? `client_id=${entity.id}` : `my_company_id=${entity.id}`;

  useEffect(() => {
    Promise.all([api.get(`/invoices?${q}`), api.get(`/agreements?${q}`)])
      .then(([inv, agr]) => { setInvoices(inv.data); setAgreements(agr.data); })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, [q]);

  const openPreview = async (id: string) => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setPreview(buildPreviewInvoice(data, companies as never, clients as never));
    } catch { toast.error('Failed to load invoice'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-gray-50 w-full max-w-2xl h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${entity.type === 'client' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-monday-blue'}`}>
              {entity.type === 'client' ? <Users size={18} /> : <Building2 size={18} />}
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">{entity.name}</h2>
              <p className="text-xs text-gray-500">{entity.type === 'client' ? 'Client' : 'Company'} · invoices & agreements</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Loading…</div>
          ) : (
            <>
              {/* Invoices */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Invoices ({invoices.length})</h3>
                {invoices.length === 0 ? (
                  <p className="text-sm text-gray-400">No invoices.</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <tbody>
                        {invoices.map(inv => (
                          <tr key={inv.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-medium text-gray-900">{inv.invoice_number}</td>
                            <td className="px-4 py-2.5 text-gray-500">{inv.issue_date}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{inv.currency} {inv.total?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button onClick={() => openPreview(inv.id)} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg" title="Preview / print"><Eye size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Agreements */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Agreements ({agreements.length})</h3>
                {agreements.length === 0 ? (
                  <p className="text-sm text-gray-400">No agreements.</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <tbody>
                        {agreements.map(a => (
                          <tr key={a.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-medium text-gray-900">
                              <span className="flex items-center gap-2"><FileText size={14} className="text-gray-400" /> {a.title}</span>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500">{(a.created_at || '').slice(0, 10)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button onClick={() => downloadAgreement(a)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Download"><Download size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      {preview && <InvoicePreview invoice={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
