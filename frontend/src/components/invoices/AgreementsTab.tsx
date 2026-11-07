import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Download, Pencil, Trash2, Share2, X, Loader2, Upload, Building2, Users } from 'lucide-react';
import api from '../../api/client';
import toast from 'react-hot-toast';
import ShareModal from './ShareModal';

export interface Agreement {
  id: string;
  title: string;
  client_id?: string | null;
  my_company_id?: string | null;
  original_name: string;
  mime_type: string;
  size: number;
  notes?: string | null;
  created_at: string;
  client_name?: string | null;
  company_name?: string | null;
  owner_name?: string | null;
  access: 'owner' | 'edit' | 'view';
  shared?: boolean;
}
type Named = { id: string; name: string };

const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export async function downloadAgreement(a: { id: string; original_name: string; title: string }) {
  const tid = toast.loading('Downloading…');
  try {
    const res = await api.get(`/agreements/${a.id}/file`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const el = document.createElement('a');
    el.href = url; el.download = a.original_name || a.title;
    document.body.appendChild(el); el.click(); el.remove();
    URL.revokeObjectURL(url);
    toast.success('Downloaded', { id: tid });
  } catch { toast.error('Download failed', { id: tid }); }
}

// ── Upload / edit modal ─────────────────────────────────────────────────────
function AgreementModal({ agreement, companies, clients, onClose, onSaved }: {
  agreement: Agreement | null; companies: Named[]; clients: Named[];
  onClose: () => void; onSaved: (a: Agreement) => void;
}) {
  const editing = !!agreement;
  const [title, setTitle] = useState(agreement?.title || '');
  const [notes, setNotes] = useState(agreement?.notes || '');
  const [link, setLink] = useState(
    agreement?.client_id ? `client:${agreement.client_id}` :
    agreement?.my_company_id ? `company:${agreement.my_company_id}` : ''
  );
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast.error('Title is required');
    if (!link) return toast.error('Link the agreement to a client or company');
    if (!editing && !file) return toast.error('Choose a file to upload');
    const [kind, refId] = link.split(':');
    setSaving(true);
    try {
      let data;
      if (editing) {
        ({ data } = await api.put(`/agreements/${agreement!.id}`, {
          title, notes,
          client_id: kind === 'client' ? refId : '',
          my_company_id: kind === 'company' ? refId : '',
        }));
      } else {
        const fd = new FormData();
        fd.append('title', title);
        fd.append('notes', notes);
        if (kind === 'client') fd.append('client_id', refId);
        if (kind === 'company') fd.append('my_company_id', refId);
        fd.append('file', file!);
        ({ data } = await api.post('/agreements', fd));
      }
      onSaved(data);
      toast.success(editing ? 'Agreement updated' : 'Agreement uploaded');
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{editing ? 'Edit agreement' : 'Upload agreement'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. NDA 2026"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Linked to</label>
            <select value={link} onChange={e => setLink(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-monday-blue">
              <option value="">Select a client or company…</option>
              {clients.length > 0 && <optgroup label="Clients">{clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup>}
              {companies.length > 0 && <optgroup label="My Companies">{companies.map(c => <option key={c.id} value={`company:${c.id}`}>{c.name}</option>)}</optgroup>}
            </select>
          </div>
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">File</label>
              <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-3 text-sm text-gray-500 cursor-pointer hover:border-monday-blue">
                <Upload size={16} />
                <span className="truncate">{file ? file.name : 'Choose a file (PDF, image, doc — up to 25 MB)'}</span>
                <input type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} {editing ? 'Save' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgreementsTab({ companies, clients }: { companies: Named[]; clients: Named[] }) {
  const [rows, setRows] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Agreement | null | 'new'>(null);
  const [shareFor, setShareFor] = useState<Agreement | null>(null);

  const load = useCallback(async () => {
    try { const { data } = await api.get('/agreements'); setRows(data); }
    catch { toast.error('Failed to load agreements'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSaved = (saved: Agreement) => {
    setRows(prev => prev.find(a => a.id === saved.id) ? prev.map(a => a.id === saved.id ? saved : a) : [saved, ...prev]);
    setModal(null);
  };
  const handleDelete = async (a: Agreement) => {
    if (!confirm(`Delete “${a.title}”? This removes the file permanently.`)) return;
    try { await api.delete(`/agreements/${a.id}`); setRows(prev => prev.filter(x => x.id !== a.id)); toast.success('Deleted'); }
    catch { toast.error('Failed to delete'); }
  };

  if (loading) return <div className="p-8 space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="animate-pulse h-12 bg-gray-100 rounded-xl" />)}</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm text-gray-500">{rows.length} agreement{rows.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600">
          <Plus size={15} /> Upload Agreement
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No agreements yet</p>
          <p className="text-sm mt-1">Upload contracts and link them to a client or company</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Linked to</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Size</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a, idx) => (
                <tr key={a.id} className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${idx % 2 ? 'bg-gray-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <FileText size={15} className="text-gray-400 flex-shrink-0" />
                      <span>{a.title}</span>
                      {a.shared && <span className="text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">shared · {a.access}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {a.client_name ? <span className="inline-flex items-center gap-1"><Users size={12} /> {a.client_name}</span>
                      : a.company_name ? <span className="inline-flex items-center gap-1"><Building2 size={12} /> {a.company_name}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtSize(a.size)}</td>
                  <td className="px-4 py-3 text-gray-500">{(a.created_at || '').slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => downloadAgreement(a)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Download"><Download size={14} /></button>
                      {a.access !== 'view' && (
                        <button onClick={() => setModal(a)} className="p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg" title="Edit"><Pencil size={14} /></button>
                      )}
                      {a.access === 'owner' && (
                        <button onClick={() => setShareFor(a)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Share"><Share2 size={14} /></button>
                      )}
                      {a.access === 'owner' && (
                        <button onClick={() => handleDelete(a)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 size={14} /></button>
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
        <AgreementModal
          agreement={modal === 'new' ? null : modal}
          companies={companies} clients={clients}
          onClose={() => setModal(null)} onSaved={handleSaved}
        />
      )}
      {shareFor && <ShareModal base="/agreements" id={shareFor.id} title={shareFor.title} onClose={() => setShareFor(null)} />}
    </div>
  );
}
