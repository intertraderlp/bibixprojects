import { useEffect, useState } from 'react';
import { X, Users, User as UserIcon, Trash2, Share2, Loader2 } from 'lucide-react';
import api from '../../api/client';
import toast from 'react-hot-toast';

interface Share {
  id: string;
  subject_type: 'user' | 'group';
  subject_id: string;
  access: 'view' | 'edit';
  subject_name: string;
  subject_email?: string | null;
}
interface Targets {
  users: { id: string; name: string; email: string }[];
  groups: { id: string; name: string }[];
}

// Generic share manager for an invoice or an agreement.
// `base` is the API base path, e.g. '/invoices' or '/agreements'.
export default function ShareModal({ base, id, title, onClose }: {
  base: string; id: string; title: string; onClose: () => void;
}) {
  const [targets, setTargets] = useState<Targets>({ users: [], groups: [] });
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState('');          // "user:<id>" | "group:<id>"
  const [access, setAccess] = useState<'view' | 'edit'>('view');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`${base}/share-targets`),
      api.get(`${base}/${id}/shares`),
    ]).then(([t, s]) => { setTargets(t.data); setShares(s.data); })
      .catch(() => toast.error('Failed to load sharing'))
      .finally(() => setLoading(false));
  }, [base, id]);

  const add = async () => {
    if (!pick) return;
    const [subject_type, subject_id] = pick.split(':');
    setSaving(true);
    try {
      const { data } = await api.post(`${base}/${id}/shares`, { subject_type, subject_id, access });
      setShares(data);
      setPick('');
      toast.success('Shared');
    } catch (e) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to share');
    } finally { setSaving(false); }
  };

  const changeAccess = async (shareId: string, newAccess: 'view' | 'edit') => {
    try { const { data } = await api.put(`${base}/${id}/shares/${shareId}`, { access: newAccess }); setShares(data); }
    catch { toast.error('Failed to update'); }
  };

  const remove = async (shareId: string) => {
    try { const { data } = await api.delete(`${base}/${id}/shares/${shareId}`); setShares(data); }
    catch { toast.error('Failed to remove'); }
  };

  // Only offer targets that aren't already shared with.
  const sharedKeys = new Set(shares.map(s => `${s.subject_type}:${s.subject_id}`));

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Share2 size={18} /> Share “{title}”</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-8 justify-center"><Loader2 className="animate-spin" size={18} /> Loading…</div>
          ) : (
            <>
              {/* Add a share */}
              <div className="flex gap-2 mb-5">
                <select value={pick} onChange={e => setPick(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-monday-blue">
                  <option value="">Add a user or group…</option>
                  {targets.groups.filter(g => !sharedKeys.has(`group:${g.id}`)).length > 0 && (
                    <optgroup label="Groups">
                      {targets.groups.filter(g => !sharedKeys.has(`group:${g.id}`)).map(g => (
                        <option key={g.id} value={`group:${g.id}`}>👥 {g.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {targets.users.filter(u => !sharedKeys.has(`user:${u.id}`)).length > 0 && (
                    <optgroup label="Users">
                      {targets.users.filter(u => !sharedKeys.has(`user:${u.id}`)).map(u => (
                        <option key={u.id} value={`user:${u.id}`}>{u.name} ({u.email})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <select value={access} onChange={e => setAccess(e.target.value as 'view' | 'edit')}
                  className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-monday-blue">
                  <option value="view">View</option>
                  <option value="edit">Edit</option>
                </select>
                <button onClick={add} disabled={!pick || saving}
                  className="px-3 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50">
                  Share
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-3">View = can see, print and download. Edit = can also change it.</p>

              {/* Current shares */}
              {shares.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Not shared with anyone yet.</p>
              ) : (
                <div className="space-y-2">
                  {shares.map(s => (
                    <div key={s.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.subject_type === 'group' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                        {s.subject_type === 'group' ? <Users size={15} /> : <UserIcon size={15} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{s.subject_name}</div>
                        {s.subject_email && <div className="text-xs text-gray-400 truncate">{s.subject_email}</div>}
                      </div>
                      <select value={s.access} onChange={e => changeAccess(s.id, e.target.value as 'view' | 'edit')}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white">
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button onClick={() => remove(s.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
