import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Instagram, Linkedin, Facebook, Music2, Plus, Trash2, RotateCcw, Link2, Unlink,
  Image as ImageIcon, Film, Send, Sparkles, Shield, MessageSquare, X, Tag, Upload,
  CheckCircle2, AlertCircle, Ban, PlugZap,
} from 'lucide-react';
import api from '../api/client';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';

// ── Types ─────────────────────────────────────────────────────────────────────
type Platform = 'instagram' | 'linkedin' | 'tiktok' | 'facebook';
type Tab = 'integrations' | 'media' | 'inbox';

interface Account {
  id: string; platform: Platform; handle: string; display_name: string | null;
  disclosure_label: string; status: 'connected' | 'disconnected' | 'error';
  avatar_url: string | null; has_token: boolean; deleted_at: string | null; created_at: string;
}
interface Media {
  id: string; account_id: string; kind: 'image' | 'video'; src: string;
  title: string | null; tags: string[]; caption: string | null; created_at: string;
}
interface Conversation {
  id: string; account_id: string; platform: Platform; handle: string; display_name: string | null;
  contact_name: string | null; contact_handle: string | null; opted_out: number;
  status: 'open' | 'closed'; last_preview: string | null; last_message_at: string | null;
  unread_count: number;
}
interface Message {
  id: string; direction: 'in' | 'out'; text: string | null; source: string | null;
  status: string; created_at: string; media_src?: string | null; media_kind?: string | null;
  media_title?: string | null;
}

// ── Platform meta ───────────────────────────────────────────────────────────
const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'instagram', label: 'Instagram', icon: <Instagram size={16} />, color: 'text-pink-600 bg-pink-50' },
  { id: 'linkedin',  label: 'LinkedIn',  icon: <Linkedin size={16} />,  color: 'text-blue-700 bg-blue-50' },
  { id: 'tiktok',    label: 'TikTok',    icon: <Music2 size={16} />,    color: 'text-gray-900 bg-gray-100' },
  { id: 'facebook',  label: 'Facebook',  icon: <Facebook size={16} />,  color: 'text-blue-600 bg-blue-50' },
];
const platMeta = (p: Platform) => PLATFORMS.find(x => x.id === p)!;

const STATUS_BADGE: Record<Account['status'], { cls: string; label: string; icon: React.ReactNode }> = {
  connected:    { cls: 'bg-green-100 text-green-700', label: 'Connected',    icon: <CheckCircle2 size={12} /> },
  disconnected: { cls: 'bg-gray-100 text-gray-600',   label: 'Disconnected', icon: <Unlink size={12} /> },
  error:        { cls: 'bg-red-100 text-red-700',     label: 'Error',        icon: <AlertCircle size={12} /> },
};

function fmt(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('integrations');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);

  const loadAccounts = async () => {
    try {
      const { data } = await api.get(`/marketing/accounts${showDeleted ? '?include_deleted=1' : ''}`);
      setAccounts(data);
    } catch { toast.error('Failed to load accounts'); }
  };
  useEffect(() => { loadAccounts(); }, [showDeleted]);

  const activeAccounts = accounts.filter(a => !a.deleted_at);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Marketing</h1>
        <p className="text-sm text-gray-500">Connect accounts, manage your media, and reply to DMs with an AI-assisted inbox.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {([
          ['integrations', 'Integrations', <PlugZap size={15} key="i" />],
          ['media', 'Media Library', <ImageIcon size={15} key="m" />],
          ['inbox', 'Inbox', <MessageSquare size={15} key="x" />],
        ] as [Tab, string, React.ReactNode][]).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-monday-blue text-monday-blue' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'integrations' && (
        <IntegrationsTab
          accounts={accounts} activeAccounts={activeAccounts}
          showDeleted={showDeleted} setShowDeleted={setShowDeleted} reload={loadAccounts}
        />
      )}
      {tab === 'media' && <MediaTab accounts={activeAccounts} />}
      {tab === 'inbox' && <InboxTab accounts={activeAccounts} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════
function IntegrationsTab({ accounts, activeAccounts, showDeleted, setShowDeleted, reload }: {
  accounts: Account[]; activeAccounts: Account[]; showDeleted: boolean;
  setShowDeleted: (v: boolean) => void; reload: () => void;
}) {
  const [adding, setAdding] = useState<Platform | null>(null);

  const act = async (fn: () => Promise<any>, ok: string) => {
    try { await fn(); toast.success(ok); reload(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Action failed'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-blue-900">
          <Shield size={16} className="mt-0.5 flex-shrink-0" />
          <span>Every account is labelled as a disclosed <strong>brand/creator</strong> account. Connecting a live platform
            (Instagram, LinkedIn, TikTok, Facebook) requires that platform's own API credentials.</span>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
          Show removed accounts
        </label>
      </div>

      <div className="space-y-5">
        {PLATFORMS.map(p => {
          const list = accounts.filter(a => a.platform === p.id);
          return (
            <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${p.color}`}>{p.icon}</span>
                  {p.label}
                  <span className="text-xs font-normal text-gray-400">
                    {list.filter(a => !a.deleted_at).length} connected
                  </span>
                </div>
                <button onClick={() => setAdding(p.id)}
                  className="flex items-center gap-1.5 text-sm text-monday-blue hover:bg-blue-50 px-3 py-1.5 rounded-lg">
                  <Plus size={15} /> Add account
                </button>
              </div>

              {list.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-400 text-center">No {p.label} accounts yet.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {list.map(a => {
                    const b = STATUS_BADGE[a.status];
                    const removed = !!a.deleted_at;
                    return (
                      <div key={a.id} className={`flex items-center gap-3 px-4 py-3 ${removed ? 'opacity-60' : ''}`}>
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${p.color}`}>{p.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">
                              {a.display_name || a.handle}
                            </span>
                            <span className="text-xs text-gray-400 truncate">@{a.handle.replace(/^@/, '')}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400">{a.disclosure_label}</span>
                            {a.has_token && <span className="text-xs text-gray-300">· token stored</span>}
                          </div>
                        </div>
                        {removed ? (
                          <span className="text-xs text-gray-400 italic mr-2">removed</span>
                        ) : (
                          <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${b.cls}`}>
                            {b.icon} {b.label}
                          </span>
                        )}
                        <div className="flex items-center gap-1">
                          {removed ? (
                            <button title="Restore" onClick={() => act(() => api.post(`/marketing/accounts/${a.id}/restore`), 'Account restored')}
                              className="p-1.5 text-gray-400 hover:text-green-600 rounded"><RotateCcw size={15} /></button>
                          ) : (
                            <>
                              {a.status === 'connected' ? (
                                <button title="Disconnect" onClick={() => act(() => api.post(`/marketing/accounts/${a.id}/disconnect`), 'Disconnected')}
                                  className="p-1.5 text-gray-400 hover:text-amber-600 rounded"><Unlink size={15} /></button>
                              ) : (
                                <button title="Mark connected" onClick={() => act(() => api.patch(`/marketing/accounts/${a.id}`, { status: 'connected' }), 'Marked connected')}
                                  className="p-1.5 text-gray-400 hover:text-green-600 rounded"><Link2 size={15} /></button>
                              )}
                              <button title="Remove" onClick={() => { if (confirm('Remove this account? (soft delete — you can restore it)')) act(() => api.delete(`/marketing/accounts/${a.id}`), 'Account removed'); }}
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={15} /></button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {adding && <AddAccountModal platform={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); reload(); }} />}
    </div>
  );
}

function AddAccountModal({ platform, onClose, onSaved }: { platform: Platform; onClose: () => void; onSaved: () => void }) {
  const p = platMeta(platform);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [disclosure, setDisclosure] = useState('Brand/creator account');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!handle.trim()) { toast.error('Handle is required'); return; }
    setSaving(true);
    try {
      await api.post('/marketing/accounts', {
        platform, handle: handle.trim(), display_name: displayName.trim() || null,
        disclosure_label: disclosure.trim() || 'Brand/creator account', access_token: token.trim() || null,
      });
      toast.success('Account added'); onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed to add'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Add ${p.label} account`} onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <Field label="Handle / username *">
          <input autoFocus value={handle} onChange={e => setHandle(e.target.value)} placeholder="@yourbrand"
            className="inp" />
        </Field>
        <Field label="Display name">
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your Brand"
            className="inp" />
        </Field>
        <Field label="Disclosure label (shown so people know who they're talking to)">
          <input value={disclosure} onChange={e => setDisclosure(e.target.value)} className="inp" />
        </Field>
        <Field label="Access token (optional — stored server-side, never shown again)">
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the platform API token"
            type="password" className="inp" />
          <p className="text-xs text-gray-400 mt-1">Leave empty to add the account now and connect credentials later.</p>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEDIA LIBRARY
// ═══════════════════════════════════════════════════════════════════════════
function MediaTab({ accounts }: { accounts: Account[] }) {
  const [accountId, setAccountId] = useState<string>('');
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts]);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try { const { data } = await api.get(`/marketing/accounts/${accountId}/media`); setMedia(data); }
    catch { toast.error('Failed to load media'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [accountId]);

  const del = async (id: string) => {
    if (!confirm('Remove this media item?')) return;
    try { await api.delete(`/marketing/media/${id}`); setMedia(m => m.filter(x => x.id !== id)); toast.success('Removed'); }
    catch { toast.error('Failed'); }
  };

  if (!accounts.length) return <EmptyHint text="Add an account under Integrations first, then build its media library here." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm bg-monday-blue text-white px-3 py-2 rounded-lg hover:bg-blue-600">
          <Upload size={15} /> Add media
        </button>
      </div>

      {loading ? <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
        : media.length === 0 ? <EmptyHint text="No media yet. Upload images or videos this account can send in replies." />
        : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {media.map(m => (
              <div key={m.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden group">
                <div className="aspect-square bg-gray-100 relative">
                  {m.kind === 'video'
                    ? <video src={m.src} className="w-full h-full object-cover" muted />
                    : <img src={m.src} alt={m.title || ''} className="w-full h-full object-cover" />}
                  <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                    {m.kind === 'video' ? <Film size={11} /> : <ImageIcon size={11} />} {m.kind}
                  </span>
                  <button onClick={() => del(m.id)}
                    className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-600">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="p-2.5">
                  <div className="text-sm font-medium text-gray-800 truncate">{m.title || 'Untitled'}</div>
                  {m.caption && <div className="text-xs text-gray-400 truncate">{m.caption}</div>}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {m.tags.map(t => (
                      <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <Tag size={9} /> {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      {adding && <AddMediaModal accountId={accountId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddMediaModal({ accountId, onClose, onSaved }: { accountId: string; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!file && !url.trim()) { toast.error('Choose a file or paste a URL'); return; }
    setSaving(true);
    try {
      const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);
      const fd = new FormData();
      if (file) fd.append('file', file);
      if (url.trim()) { fd.append('url', url.trim()); fd.append('kind', /\.(mp4|mov|webm)$/i.test(url) ? 'video' : 'image'); }
      fd.append('title', title); fd.append('caption', caption); fd.append('tags', JSON.stringify(tagArr));
      await api.post(`/marketing/accounts/${accountId}/media`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Media added'); onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Upload failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Add media" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <Field label="Upload image or video">
          <input ref={fileRef} type="file" accept="image/*,video/*"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-monday-blue" />
        </Field>
        <div className="text-center text-xs text-gray-400">— or —</div>
        <Field label="External URL">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="inp" />
        </Field>
        <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} className="inp" /></Field>
        <Field label="Caption"><input value={caption} onChange={e => setCaption(e.target.value)} className="inp" /></Field>
        <Field label="Tags (comma-separated)">
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="product, summer, promo" className="inp" />
        </Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  INBOX
// ═══════════════════════════════════════════════════════════════════════════
function InboxTab({ accounts }: { accounts: Account[] }) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<string>(''); // account_id
  const [activeId, setActiveId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [composer, setComposer] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachMedia, setAttachMedia] = useState<Media | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = convs.find(c => c.id === activeId) || null;

  const loadConvs = async () => {
    try {
      const { data } = await api.get(`/marketing/conversations${filter ? `?account_id=${filter}` : ''}`);
      setConvs(data);
      if (data.length && !data.find((c: Conversation) => c.id === activeId)) setActiveId(data[0].id);
    } catch { toast.error('Failed to load inbox'); }
  };
  useEffect(() => { loadConvs(); }, [filter]);

  const loadMessages = async () => {
    if (!activeId) { setMessages([]); return; }
    try { const { data } = await api.get(`/marketing/conversations/${activeId}/messages`); setMessages(data); }
    catch { toast.error('Failed to load messages'); }
  };
  useEffect(() => { loadMessages(); setAttachMedia(null); setComposer(''); }, [activeId]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const draft = async () => {
    if (!activeId) return;
    setDrafting(true);
    try { const { data } = await api.post(`/marketing/conversations/${activeId}/draft`, {}); setComposer(data.draft || ''); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'Draft failed'); }
    finally { setDrafting(false); }
  };

  const send = async () => {
    if (!activeId || (!composer.trim() && !attachMedia)) return;
    setSending(true);
    try {
      await api.post(`/marketing/conversations/${activeId}/send`, {
        text: composer.trim() || null, media_id: attachMedia?.id || null,
      });
      setComposer(''); setAttachMedia(null);
      await loadMessages(); await loadConvs();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Send blocked'); }
    finally { setSending(false); }
  };

  const toggleOptOut = async () => {
    if (!active) return;
    try {
      await api.post(`/marketing/conversations/${activeId}/opt-out`, { opted_out: !active.opted_out });
      await loadConvs();
      toast.success(active.opted_out ? 'Opt-out removed' : 'Marked opted-out — sending blocked');
    } catch { toast.error('Failed'); }
  };

  if (!accounts.length) return <EmptyHint text="Add an account under Integrations first to use the inbox." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{platMeta(a.platform).label} · @{a.handle.replace(/^@/, '')}</option>)}
        </select>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 text-sm text-monday-blue hover:bg-blue-50 px-3 py-2 rounded-lg">
          <Plus size={15} /> Import conversation
        </button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[420px]">
        {/* Conversation list */}
        <div className="w-72 flex-shrink-0 bg-white border border-gray-200 rounded-xl overflow-y-auto">
          {convs.length === 0 ? <div className="p-5 text-sm text-gray-400 text-center">No conversations yet.</div> : convs.map(c => {
            const p = platMeta(c.platform);
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 ${activeId === c.id ? 'bg-blue-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${p.color}`}>{p.icon}</span>
                  <span className="font-medium text-sm text-gray-900 truncate flex-1">{c.contact_name || c.contact_handle || 'Unknown'}</span>
                  {c.unread_count > 0 && <span className="bg-monday-blue text-white text-xs rounded-full px-1.5 min-w-[18px] text-center">{c.unread_count}</span>}
                </div>
                <div className="text-xs text-gray-400 truncate mt-0.5 pl-8">{c.last_preview || 'No messages'}</div>
                <div className="flex items-center gap-2 pl-8 mt-0.5">
                  <span className="text-xs text-gray-300">@{c.handle.replace(/^@/, '')}</span>
                  {!!c.opted_out && <span className="text-xs text-red-500 flex items-center gap-0.5"><Ban size={10} /> opted out</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Thread */}
        <div className="flex-1 bg-white border border-gray-200 rounded-xl flex flex-col min-w-0">
          {!active ? <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Select a conversation</div> : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{active.contact_name || active.contact_handle}</div>
                  <div className="text-xs text-gray-400">{platMeta(active.platform).label} · replying as @{active.handle.replace(/^@/, '')}</div>
                </div>
                <button onClick={toggleOptOut}
                  className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${active.opted_out ? 'bg-red-50 text-red-600' : 'text-gray-500 hover:bg-gray-100'}`}>
                  <Ban size={12} /> {active.opted_out ? 'Opted out' : 'Mark opt-out'}
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                      m.direction === 'out' ? 'bg-monday-blue text-white' : 'bg-white border border-gray-200 text-gray-800'
                    }`}>
                      {m.media_src && (m.media_kind === 'video'
                        ? <video src={m.media_src} controls className="rounded-lg mb-1 max-h-48" />
                        : <img src={m.media_src} className="rounded-lg mb-1 max-h-48" />)}
                      {m.text}
                      <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-white/70' : 'text-gray-400'}`}>
                        {m.source === 'ai' ? 'AI-assisted · ' : ''}{fmt(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <div className="text-center text-sm text-gray-400 py-8">No messages in this conversation yet.</div>}
              </div>

              {/* Composer */}
              <div className="border-t border-gray-100 p-3">
                {active.opted_out && (
                  <div className="mb-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                    <Ban size={13} /> This contact opted out. Sending is disabled.
                  </div>
                )}
                {attachMedia && (
                  <div className="mb-2 flex items-center gap-2 bg-gray-100 rounded-lg px-2 py-1.5 text-xs">
                    {attachMedia.kind === 'video' ? <Film size={13} /> : <ImageIcon size={13} />}
                    <span className="truncate flex-1">{attachMedia.title || 'media'}</span>
                    <button onClick={() => setAttachMedia(null)} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
                  </div>
                )}
                <textarea value={composer} onChange={e => setComposer(e.target.value)} rows={2}
                  placeholder="Write a reply, or draft one with AI…" disabled={!!active.opted_out}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-monday-blue disabled:bg-gray-50" />
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={draft} disabled={drafting || !!active.opted_out}
                    className="flex items-center gap-1.5 text-sm text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    <Sparkles size={14} /> {drafting ? 'Drafting…' : 'Draft with AI'}
                  </button>
                  <button onClick={() => setAttachOpen(true)} disabled={!!active.opted_out}
                    className="flex items-center gap-1.5 text-sm text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    <ImageIcon size={14} /> Attach
                  </button>
                  <div className="flex-1" />
                  <button onClick={send} disabled={sending || !!active.opted_out || (!composer.trim() && !attachMedia)}
                    className="flex items-center gap-1.5 text-sm bg-monday-blue text-white px-4 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50">
                    <Send size={14} /> {sending ? 'Sending…' : 'Approve & send'}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
                  <Sparkles size={11} /> AI only drafts suggestions — nothing sends until you approve it.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {showNew && <ImportConversationModal accounts={accounts} defaultAccount={filter || accounts[0]?.id}
        onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadConvs(); }} />}
      {attachOpen && active && <AttachMediaModal accountId={active.account_id}
        onClose={() => setAttachOpen(false)} onPick={m => { setAttachMedia(m); setAttachOpen(false); }} />}
    </div>
  );
}

function ImportConversationModal({ accounts, defaultAccount, onClose, onSaved }: {
  accounts: Account[]; defaultAccount?: string; onClose: () => void; onSaved: () => void;
}) {
  const [accountId, setAccountId] = useState(defaultAccount || accounts[0]?.id || '');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [firstMsg, setFirstMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() && !handle.trim()) { toast.error('Enter a contact name or handle'); return; }
    setSaving(true);
    try {
      await api.post(`/marketing/accounts/${accountId}/conversations`, {
        contact_name: name.trim() || null, contact_handle: handle.trim() || null, first_message: firstMsg.trim() || null,
      });
      toast.success('Conversation added'); onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Import a conversation" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <p className="text-xs text-gray-500">Record an inbound DM thread so you can reply to it here. (When a live platform
          adapter is connected, threads import automatically.)</p>
        <Field label="Account">
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="inp">
            {accounts.map(a => <option key={a.id} value={a.id}>{platMeta(a.platform).label} · @{a.handle.replace(/^@/, '')}</option>)}
          </select>
        </Field>
        <Field label="Contact name"><input value={name} onChange={e => setName(e.target.value)} className="inp" /></Field>
        <Field label="Contact handle"><input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@customer" className="inp" /></Field>
        <Field label="Their first message"><textarea value={firstMsg} onChange={e => setFirstMsg(e.target.value)} rows={3} className="inp resize-none" /></Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AttachMediaModal({ accountId, onClose, onPick }: { accountId: string; onClose: () => void; onPick: (m: Media) => void }) {
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get(`/marketing/accounts/${accountId}/media`).then(({ data }) => setMedia(data))
      .catch(() => toast.error('Failed to load media')).finally(() => setLoading(false));
  }, [accountId]);

  return (
    <Modal title="Attach from media library" onClose={onClose} size="lg">
      <div className="p-6">
        {loading ? <div className="text-sm text-gray-400 text-center py-8">Loading…</div>
          : media.length === 0 ? <div className="text-sm text-gray-400 text-center py-8">No media for this account yet.</div>
          : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {media.map(m => (
                <button key={m.id} onClick={() => onPick(m)}
                  className="border border-gray-200 rounded-lg overflow-hidden hover:ring-2 hover:ring-monday-blue">
                  <div className="aspect-square bg-gray-100">
                    {m.kind === 'video' ? <video src={m.src} className="w-full h-full object-cover" muted />
                      : <img src={m.src} className="w-full h-full object-cover" />}
                  </div>
                  <div className="text-xs text-gray-700 truncate px-1.5 py-1">{m.title || m.kind}</div>
                </button>
              ))}
            </div>
          )}
      </div>
    </Modal>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
function AccountSelect({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
      {accounts.map(a => <option key={a.id} value={a.id}>{platMeta(a.platform).label} · @{a.handle.replace(/^@/, '')}</option>)}
    </select>
  );
}
function EmptyHint({ text }: { text: string }) {
  return <div className="bg-white border border-dashed border-gray-300 rounded-xl py-12 text-center text-sm text-gray-400">{text}</div>;
}
