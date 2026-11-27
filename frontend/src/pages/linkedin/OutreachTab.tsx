import { useEffect, useMemo, useState } from 'react';
import {
  Plus, ArrowLeft, Trash2, ExternalLink, Users, LayoutGrid, ClipboardPaste, UserPlus2,
  Sparkles, Eye, Check, X, Send, UserPlus, RefreshCw, Shuffle, Filter as FilterIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────
type Status = 'queued' | 'invited' | 'accepted' | 'messaged' | 'replied' | 'skipped' | 'failed';

interface Step { id?: string; step_index?: number; delay_days: number; variants: string[]; }
interface Target {
  id: string; name: string | null; headline: string | null; company: string | null;
  linkedin_url: string | null; source: string; status: Status; next_step: number;
  invited_at: string | null; accepted_at: string | null; messaged_at: string | null;
}
interface Campaign {
  id: string; name: string; status: 'draft' | 'active' | 'paused';
  connect_note: string; note_variants: string[]; follow_too: number;
  message_mode: 'single' | 'sequence'; daily_limit: number; ai_instruction: string | null;
  counts?: Record<string, number>; total?: number;
  steps?: Step[]; targets?: Target[];
}
interface Candidate {
  id: number; full_name: string | null; first_name: string | null; last_name: string | null;
  headline: string | null; company: string | null; linkedin_url: string | null;
}

const STATUS_STYLE: Record<Status, string> = {
  queued: 'bg-gray-100 text-gray-600', invited: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700', messaged: 'bg-purple-100 text-purple-700',
  replied: 'bg-emerald-100 text-emerald-700', skipped: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};
const STATUS_ORDER: Status[] = ['queued', 'invited', 'accepted', 'messaged', 'replied'];
const TOKENS = ['{{Name}}', '{{FirstName}}', '{{Company}}', '{{Headline}}'];

export default function OutreachTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCampaigns = async () => {
    setLoading(true);
    try { const r = await api.get('/outreach/campaigns'); setCampaigns(r.data.data || []); }
    catch { toast.error('Failed to load campaigns'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadCampaigns(); }, []);

  const createCampaign = async () => {
    const name = prompt('Campaign name?', 'New outreach');
    if (!name) return;
    try {
      const r = await api.post('/outreach/campaigns', {
        name,
        note_variants: ['Hi {{FirstName}}, I came across your profile and would love to connect.'],
        message_mode: 'single',
        steps: [{ delay_days: 0, variants: ['Thanks for connecting, {{FirstName}}! [[AI: write one friendly sentence referencing their role]]'] }],
      });
      await loadCampaigns();
      setOpenId(r.data.data.id);
    } catch { toast.error('Could not create campaign'); }
  };

  if (openId) return <CampaignDetail id={openId} onBack={() => { setOpenId(null); loadCampaigns(); }} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Outreach campaigns</h2>
          <p className="text-sm text-gray-500">Connect with prospects, then message the ones who accept.</p>
        </div>
        <button onClick={createCampaign}
          className="flex items-center gap-2 bg-[#0a66c2] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#004182]">
          <Plus size={16} /> New campaign
        </button>
      </div>

      {loading ? <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
        : campaigns.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
            <UserPlus size={28} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 mb-4">No campaigns yet. Create one, add prospects, and start connecting.</p>
            <button onClick={createCampaign} className="text-sm text-[#0a66c2] font-medium">+ New campaign</button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map(c => (
              <button key={c.id} onClick={() => setOpenId(c.id)}
                className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-[#0a66c2]/40 transition">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-800 truncate">{c.name}</span>
                  <StatusPill status={c.status} />
                </div>
                <div className="text-xs text-gray-500 mb-3">{c.total || 0} prospect{(c.total || 0) !== 1 ? 's' : ''}</div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_ORDER.map(s => (c.counts?.[s] ? (
                    <span key={s} className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[s]}`}>{c.counts[s]} {s}</span>
                  ) : null))}
                </div>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', active: 'bg-green-100 text-green-700', paused: 'bg-amber-100 text-amber-700',
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${map[status] || map.draft}`}>{status}</span>;
}

// ── Campaign detail ─────────────────────────────────────────────────────────
function CampaignDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [c, setC] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [addMode, setAddMode] = useState<null | 'candidates' | 'board' | 'paste' | 'person'>(null);

  const load = async () => {
    try { const r = await api.get(`/outreach/campaigns/${id}`); setC(r.data.data); }
    catch { toast.error('Failed to load campaign'); }
  };
  useEffect(() => { load(); }, [id]);

  if (!c) return <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>;

  const update = (patch: Partial<Campaign>) => setC(prev => prev ? { ...prev, ...patch } : prev);
  const updateStep = (i: number, patch: Partial<Step>) =>
    setC(prev => prev ? { ...prev, steps: (prev.steps || []).map((s, j) => j === i ? { ...s, ...patch } : s) } : prev);
  const addStep = () => setC(prev => prev ? { ...prev, steps: [...(prev.steps || []), { delay_days: 2, variants: [''] }] } : prev);
  const removeStep = (i: number) => setC(prev => prev ? { ...prev, steps: (prev.steps || []).filter((_, j) => j !== i) } : prev);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/outreach/campaigns/${id}`, {
        name: c.name, status: c.status, note_variants: c.note_variants, follow_too: c.follow_too,
        message_mode: c.message_mode, daily_limit: c.daily_limit, ai_instruction: c.ai_instruction,
        steps: c.message_mode === 'single' ? (c.steps || []).slice(0, 1) : c.steps,
      });
      toast.success('Saved');
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!confirm(`Delete campaign "${c.name}" and all its prospects?`)) return;
    await api.delete(`/outreach/campaigns/${id}`);
    toast.success('Deleted');
    onBack();
  };

  const steps = c.message_mode === 'single' ? (c.steps || []).slice(0, 1) : (c.steps || []);

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={16} /> All campaigns
        </button>
        <div className="flex items-center gap-2">
          <select value={c.status} onChange={e => update({ status: e.target.value as any })}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <button onClick={save} disabled={saving}
            className="text-sm bg-[#0a66c2] text-white px-4 py-1.5 rounded-lg hover:bg-[#004182] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={del} className="text-sm text-red-600 hover:bg-red-50 p-1.5 rounded-lg"><Trash2 size={16} /></button>
        </div>
      </div>

      <input value={c.name} onChange={e => update({ name: e.target.value })}
        className="text-xl font-bold text-gray-900 w-full outline-none border-b border-transparent focus:border-gray-300 pb-1" />

      {/* Connect note */}
      <Section title="Connection request note"
        subtitle="Sent with the invite. Add several variants — Bibix rotates them so it doesn't look automated. LinkedIn limits free-account notes to ~200 chars.">
        <VariantList variants={c.note_variants?.length ? c.note_variants : ['']}
          onChange={v => update({ note_variants: v })} maxChars={200} />
        <label className="flex items-center gap-2 text-sm text-gray-600 mt-3">
          <input type="checkbox" checked={!!c.follow_too} onChange={e => update({ follow_too: e.target.checked ? 1 : 0 })} />
          Also follow each prospect (optional — following doesn't enable messaging)
        </label>
      </Section>

      {/* Messages */}
      <Section title="Messages after they accept"
        subtitle="Only sent once a prospect accepts your connection. Multiple variants per message rotate to avoid detection.">
        <div className="flex gap-2 mb-3">
          {(['single', 'sequence'] as const).map(m => (
            <button key={m} onClick={() => update({ message_mode: m })}
              className={`text-sm px-3 py-1.5 rounded-lg border ${c.message_mode === m ? 'border-[#0a66c2] bg-[#0a66c2]/5 text-[#0a66c2]' : 'border-gray-300 text-gray-600'}`}>
              {m === 'single' ? 'Single message' : 'Sequence'}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">Message {i + 1}</span>
                <div className="flex items-center gap-3">
                  {(c.message_mode === 'sequence') && (
                    <label className="text-xs text-gray-500 flex items-center gap-1">
                      wait
                      <input type="number" min={0} value={s.delay_days}
                        onChange={e => updateStep(i, { delay_days: Number(e.target.value) })}
                        className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs" />
                      days {i === 0 ? 'after accept' : 'after previous'}
                    </label>
                  )}
                  {c.message_mode === 'sequence' && steps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
              </div>
              <VariantList variants={s.variants?.length ? s.variants : ['']}
                onChange={v => updateStep(i, { variants: v })} withAi />
            </div>
          ))}
          {c.message_mode === 'sequence' && (
            <button onClick={addStep} className="text-sm text-[#0a66c2] flex items-center gap-1"><Plus size={14} /> Add step</button>
          )}
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-gray-500">AI style guidance (used by [[AI: …]] blocks)</label>
          <input value={c.ai_instruction || ''} onChange={e => update({ ai_instruction: e.target.value })}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 mt-1"
            placeholder="e.g. warm, concise, no emojis, mention our analytics service when relevant" />
        </div>
      </Section>

      {/* Throttle */}
      <Section title="Sending limits" subtitle="Keeps your account safe. The extension (coming next) obeys these.">
        <label className="text-sm text-gray-600 flex items-center gap-2">
          Max invites per day
          <input type="number" min={1} max={100} value={c.daily_limit}
            onChange={e => update({ daily_limit: Number(e.target.value) })}
            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
        </label>
        <p className="text-xs text-amber-600 mt-2">Tip: keep this ≤ 25/day. LinkedIn caps invites (~100–200/week) and restricts accounts that exceed it.</p>
      </Section>

      {/* Prospects */}
      <Section title={`Prospects (${c.targets?.length || 0})`}
        subtitle="Add from your saved candidates, a board (with group + filters), a pasted list, or one by one.">
        <div className="flex flex-wrap gap-2 mb-4">
          <AddBtn icon={<Users size={14} />} label="From Candidates" active={addMode === 'candidates'} onClick={() => setAddMode(addMode === 'candidates' ? null : 'candidates')} />
          <AddBtn icon={<LayoutGrid size={14} />} label="From a board" active={addMode === 'board'} onClick={() => setAddMode(addMode === 'board' ? null : 'board')} />
          <AddBtn icon={<ClipboardPaste size={14} />} label="Paste a list" active={addMode === 'paste'} onClick={() => setAddMode(addMode === 'paste' ? null : 'paste')} />
          <AddBtn icon={<UserPlus2 size={14} />} label="Add person" active={addMode === 'person'} onClick={() => setAddMode(addMode === 'person' ? null : 'person')} />
          <button onClick={load} className="ml-auto text-sm text-gray-500 flex items-center gap-1 hover:text-gray-800">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {addMode === 'candidates' && <AddFromCandidates campaignId={id} onDone={() => { setAddMode(null); load(); }} onCancel={() => setAddMode(null)} />}
        {addMode === 'board' && <AddFromBoard campaignId={id} onDone={() => { setAddMode(null); load(); }} onCancel={() => setAddMode(null)} />}
        {addMode === 'paste' && <AddFromPaste campaignId={id} onDone={() => { setAddMode(null); load(); }} onCancel={() => setAddMode(null)} />}
        {addMode === 'person' && <AddPerson campaignId={id} onDone={() => { setAddMode(null); load(); }} onCancel={() => setAddMode(null)} />}

        <TargetsTable campaign={c} onChanged={load} />
      </Section>
    </div>
  );
}

// ── Variant list editor (rotating templates) ─────────────────────────────────
function VariantList({ variants, onChange, withAi, maxChars }:
  { variants: string[]; onChange: (v: string[]) => void; withAi?: boolean; maxChars?: number }) {
  const set = (i: number, val: string) => onChange(variants.map((v, j) => j === i ? val : v));
  const insert = (i: number, tok: string) => set(i, (variants[i] || '') + tok);
  const add = () => onChange([...variants, '']);
  const remove = (i: number) => onChange(variants.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {variants.map((v, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1">
              {variants.length > 1 && <Shuffle size={11} />} Variant {i + 1}{variants.length > 1 ? ` of ${variants.length}` : ''}
            </span>
            {variants.length > 1 && (
              <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-500"><X size={13} /></button>
            )}
          </div>
          <TokenBar onInsert={tok => insert(i, tok)} withAi={withAi} />
          <textarea value={v} onChange={e => set(i, e.target.value)} rows={3}
            className="w-full text-sm border border-gray-300 rounded-lg p-2.5 resize-y"
            placeholder="Hi {{FirstName}}, …" />
          {maxChars && (
            <div className={`text-xs mt-0.5 ${(v || '').length > maxChars ? 'text-red-500' : 'text-gray-400'}`}>
              {(v || '').length}/{maxChars} chars
            </div>
          )}
        </div>
      ))}
      <button onClick={add} className="text-sm text-[#0a66c2] flex items-center gap-1"><Plus size={13} /> Add variant</button>
    </div>
  );
}

// ── Prospects table ───────────────────────────────────────────────────────────
function TargetsTable({ campaign, onChanged }: { campaign: Campaign; onChanged: () => void }) {
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const targets = campaign.targets || [];

  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = targets.length > 0 && sel.size === targets.length;

  const setStatus = async (t: Target, status: Status) => {
    try { await api.put(`/outreach/targets/${t.id}`, { status }); onChanged(); }
    catch { toast.error('Update failed'); }
  };
  const del = async (t: Target) => { await api.delete(`/outreach/targets/${t.id}`); onChanged(); };
  const bulkDelete = async () => {
    if (!sel.size || !confirm(`Remove ${sel.size} prospect(s) from this campaign?`)) return;
    for (const id of sel) await api.delete(`/outreach/targets/${id}`);
    setSel(new Set()); onChanged();
  };

  const showPreview = async (t: Target, kind: 'note' | 'message') => {
    const tid = toast.loading('Generating…');
    try {
      const r = await api.post(`/outreach/targets/${t.id}/preview`, { kind, step_index: 0 });
      toast.dismiss(tid);
      const vc = r.data.variant_count > 1 ? ` (1 of ${r.data.variant_count} variants)` : '';
      setPreview({ title: `${kind === 'note' ? 'Connection note' : 'First message'}${vc} — ${t.name || 'prospect'}`, text: r.data.text || '(empty template)' });
    } catch (e: any) { toast.dismiss(tid); toast.error(e?.response?.data?.error || 'Preview failed'); }
  };

  if (targets.length === 0) return <div className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No prospects yet.</div>;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {sel.size > 0 && (
        <div className="flex items-center gap-3 bg-[#0a66c2]/5 px-3 py-2 text-sm">
          <span className="font-medium text-gray-700">{sel.size} selected</span>
          <button onClick={bulkDelete} className="text-red-600 flex items-center gap-1 hover:underline"><Trash2 size={13} /> Remove</button>
          <button onClick={() => setSel(new Set())} className="text-gray-500 hover:underline ml-auto">Clear</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr>
            <th className="w-8 px-3 py-2"><input type="checkbox" checked={allOn}
              onChange={() => setSel(allOn ? new Set() : new Set(targets.map(t => t.id)))} /></th>
            <th className="text-left font-medium px-3 py-2">Prospect</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
            <th className="text-right font-medium px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(t => (
            <tr key={t.id} className="border-t border-gray-100">
              <td className="px-3 py-2"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>
              <td className="px-3 py-2">
                <div className="font-medium text-gray-800">{t.name || '—'}</div>
                <div className="text-xs text-gray-400 truncate max-w-[280px]">{[t.headline, t.company].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="px-3 py-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status]}`}>{t.status}</span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  {t.linkedin_url && (
                    <a href={t.linkedin_url} target="_blank" rel="noreferrer" title="Open profile"
                      className="p-1.5 text-gray-400 hover:text-[#0a66c2] hover:bg-gray-100 rounded"><ExternalLink size={14} /></a>
                  )}
                  <button title="Preview connection note" onClick={() => showPreview(t, 'note')}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"><Eye size={14} /></button>
                  <button title="Preview first message" onClick={() => showPreview(t, 'message')}
                    className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-gray-100 rounded"><Sparkles size={14} /></button>
                  {t.status === 'queued' && (
                    <button title="Mark invited" onClick={() => setStatus(t, 'invited')}
                      className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"><UserPlus size={14} /></button>
                  )}
                  {t.status === 'invited' && (
                    <button title="Mark accepted" onClick={() => setStatus(t, 'accepted')}
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check size={14} /></button>
                  )}
                  {(t.status === 'accepted') && (
                    <button title="Mark messaged" onClick={() => setStatus(t, 'messaged')}
                      className="p-1.5 text-purple-600 hover:bg-purple-50 rounded"><Send size={14} /></button>
                  )}
                  <button title="Remove" onClick={() => del(t)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-gray-100 rounded"><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">{preview.title}</h3>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-5">
              <div className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 rounded-lg p-4">{preview.text}</div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { navigator.clipboard.writeText(preview.text); toast.success('Copied'); }}
                className="text-sm bg-[#0a66c2] text-white px-3 py-1.5 rounded-lg hover:bg-[#004182]">Copy</button>
              <button onClick={() => setPreview(null)} className="text-sm text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add: single person ───────────────────────────────────────────────────────
function AddPerson({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', linkedin_url: '', company: '', headline: '' });
  const add = async () => {
    if (!f.name.trim() && !f.linkedin_url.trim()) { toast.error('Enter a name or LinkedIn URL'); return; }
    const r = await api.post(`/outreach/campaigns/${campaignId}/targets`, { from: 'manual', rows: [f] });
    toast.success(r.data.added ? 'Added' : 'Already in campaign');
    onDone();
  };
  return (
    <AddPanel title="Add one person" onCancel={onCancel} onAdd={add} addLabel="Add person">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" placeholder="Jane Doe" /></Field>
        <Field label="LinkedIn URL"><input value={f.linkedin_url} onChange={e => setF({ ...f, linkedin_url: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" placeholder="https://linkedin.com/in/…" /></Field>
        <Field label="Company (optional)"><input value={f.company} onChange={e => setF({ ...f, company: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" /></Field>
        <Field label="Headline (optional)"><input value={f.headline} onChange={e => setF({ ...f, headline: e.target.value })} className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2" /></Field>
      </div>
    </AddPanel>
  );
}

// ── Add: from saved candidates ───────────────────────────────────────────────
function AddFromCandidates({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const [cands, setCands] = useState<Candidate[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/contacts').then(r => setCands(r.data.data || [])).catch(() => {}); }, []);
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return cands.filter(c => !s || [c.full_name, c.headline, c.company].some(x => (x || '').toLowerCase().includes(s)));
  }, [cands, q]);
  const allOn = filtered.length > 0 && filtered.every(c => sel.has(c.id));
  const add = async () => {
    if (sel.size === 0) return;
    const r = await api.post(`/outreach/campaigns/${campaignId}/targets`, { from: 'candidates', ids: [...sel] });
    toast.success(`Added ${r.data.added}${r.data.skipped ? ` · ${r.data.skipped} already in` : ''}`);
    onDone();
  };
  return (
    <AddPanel title="Add from saved Candidates" onCancel={onCancel} onAdd={add} addLabel={`Add ${sel.size || ''}`}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search candidates…"
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 mb-2" />
      <label className="flex items-center gap-2 text-xs text-gray-500 mb-1 px-1">
        <input type="checkbox" checked={allOn}
          onChange={() => setSel(allOn ? new Set() : new Set(filtered.map(c => c.id)))} /> Select all ({filtered.length})
      </label>
      <div className="max-h-64 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
        {filtered.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">No candidates. Save some from the Candidates tab first.</div>}
        {filtered.map(c => {
          const on = sel.has(c.id);
          return (
            <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={on} onChange={() => setSel(s => { const n = new Set(s); on ? n.delete(c.id) : n.add(c.id); return n; })} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</div>
                <div className="text-xs text-gray-400 truncate">{[c.headline, c.company].filter(Boolean).join(' · ')}</div>
              </div>
            </label>
          );
        })}
      </div>
    </AddPanel>
  );
}

// ── Add: from a board (group + filters + selection) ──────────────────────────
type Op = 'not_empty' | 'empty' | 'equals' | 'contains';
interface FilterRow { columnId: string; op: Op; value: string; }
const OP_LABEL: Record<Op, string> = { not_empty: 'is not empty', empty: 'is empty', equals: 'equals', contains: 'contains' };

function AddFromBoard({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);
  const [boardId, setBoardId] = useState('');
  const [detail, setDetail] = useState<any>(null);           // { columns, groups, items, values }
  const [groupId, setGroupId] = useState('');
  const [urlCol, setUrlCol] = useState('');
  const [nameCol, setNameCol] = useState('');
  const [companyCol, setCompanyCol] = useState('');
  const [headlineCol, setHeadlineCol] = useState('');
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const ws = await api.get('/workspaces');
        const all: { id: string; name: string }[] = [];
        for (const w of (ws.data || [])) {
          const b = await api.get(`/boards/workspace/${w.id}`);
          (b.data || []).forEach((x: any) => all.push({ id: x.id, name: x.name }));
        }
        const shared = await api.get('/boards/shared-with-me').catch(() => ({ data: [] }));
        (shared.data || []).forEach((x: any) => { if (!all.find(a => a.id === x.id)) all.push({ id: x.id, name: x.name }); });
        setBoards(all);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    if (!boardId) { setDetail(null); return; }
    setSel(new Set());
    api.get(`/boards/${boardId}`).then(r => {
      setDetail(r.data);
      const cols = r.data.columns || [];
      const guessUrl = cols.find((c: any) => c.type === 'link') || cols.find((c: any) => /link|url/i.test(c.name));
      setUrlCol(guessUrl?.id || '');
      setNameCol('');
      setCompanyCol(cols.find((c: any) => /company|org/i.test(c.name))?.id || '');
      setHeadlineCol(cols.find((c: any) => /headline|title|role|position/i.test(c.name))?.id || '');
      setGroupId('');
      setFilters([]);
    }).catch(() => {});
  }, [boardId]);

  const columns: any[] = detail?.columns || [];
  // value map: itemId -> columnId -> value
  const valMap = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const v of (detail?.values || [])) {
      (m[v.item_id] = m[v.item_id] || {})[v.column_id] = v.value;
    }
    return m;
  }, [detail]);

  const matchFilter = (itemId: string, f: FilterRow) => {
    const raw = (valMap[itemId]?.[f.columnId] ?? '').toString();
    const val = raw.trim();
    switch (f.op) {
      case 'not_empty': return !!val;
      case 'empty': return !val;
      case 'equals': return val.toLowerCase() === f.value.trim().toLowerCase();
      case 'contains': return val.toLowerCase().includes(f.value.trim().toLowerCase());
    }
  };

  const rows = useMemo(() => {
    const items = (detail?.items || []).filter((it: any) => !it.parent_item_id && (!groupId || it.group_id === groupId));
    return items.map((it: any) => {
      const url = urlCol ? (valMap[it.id]?.[urlCol] || '') : '';
      const name = (nameCol ? valMap[it.id]?.[nameCol] : '') || it.name;
      const company = companyCol ? (valMap[it.id]?.[companyCol] || '') : '';
      const headline = headlineCol ? (valMap[it.id]?.[headlineCol] || '') : '';
      return { id: it.id, name, url, company, headline };
    }).filter((r: any) => filters.every(f => matchFilter(r.id, f)));
  }, [detail, groupId, urlCol, nameCol, companyCol, headlineCol, filters, valMap]);

  const withUrl = rows.filter((r: any) => r.url);
  const allOn = withUrl.length > 0 && withUrl.every((r: any) => sel.has(r.id));

  const add = async () => {
    const chosen = withUrl.filter((r: any) => sel.has(r.id));
    if (!chosen.length) { toast.error('Select at least one person (must have a LinkedIn URL)'); return; }
    const payload = chosen.map((r: any) => ({ name: r.name, linkedin_url: r.url, company: r.company || null, headline: r.headline || null, source_ref: r.id }));
    const res = await api.post(`/outreach/campaigns/${campaignId}/targets`, { from: 'rows', source: 'board', rows: payload });
    toast.success(`Added ${res.data.added}${res.data.skipped ? ` · ${res.data.skipped} already in` : ''}`);
    onDone();
  };

  return (
    <AddPanel title="Add from a board" onCancel={onCancel} onAdd={add} addLabel={`Add ${sel.size || ''} selected`}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Board">
          <select value={boardId} onChange={e => setBoardId(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2">
            <option value="">Select…</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Group">
          <select value={groupId} onChange={e => setGroupId(e.target.value)} disabled={!detail}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 disabled:bg-gray-50">
            <option value="">All groups</option>
            {(detail?.groups || []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="LinkedIn-URL column *"><ColSelect cols={columns} value={urlCol} onChange={setUrlCol} /></Field>
        <Field label="Name column (optional — defaults to Item name)"><ColSelect cols={columns} value={nameCol} onChange={setNameCol} allowNone /></Field>
        <Field label="Company column (optional)"><ColSelect cols={columns} value={companyCol} onChange={setCompanyCol} allowNone /></Field>
        <Field label="Headline column (optional)"><ColSelect cols={columns} value={headlineCol} onChange={setHeadlineCol} allowNone /></Field>
      </div>

      {detail && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-500 flex items-center gap-1"><FilterIcon size={12} /> Filters (all must match)</span>
            <button onClick={() => setFilters([...filters, { columnId: columns[0]?.id || '', op: 'not_empty', value: '' }])}
              className="text-xs text-[#0a66c2] flex items-center gap-1"><Plus size={12} /> Add filter</button>
          </div>
          {filters.map((f, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <select value={f.columnId} onChange={e => setFilters(filters.map((x, j) => j === i ? { ...x, columnId: e.target.value } : x))}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 flex-1">
                {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={f.op} onChange={e => setFilters(filters.map((x, j) => j === i ? { ...x, op: e.target.value as Op } : x))}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
                {Object.entries(OP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {(f.op === 'equals' || f.op === 'contains') && (
                <input value={f.value} onChange={e => setFilters(filters.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  placeholder="value" className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-32" />
              )}
              <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {detail && urlCol && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-xs text-gray-500 mb-1 px-1">
            <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(withUrl.map((r: any) => r.id)))} />
            Select all with a URL ({withUrl.length})
            {rows.length - withUrl.length > 0 && <span className="text-amber-500">· {rows.length - withUrl.length} skipped (no URL)</span>}
          </label>
          <div className="max-h-60 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {rows.length === 0 && <div className="text-sm text-gray-400 p-4 text-center">No matching items.</div>}
            {rows.map((r: any) => {
              const hasUrl = !!r.url;
              const on = sel.has(r.id);
              return (
                <label key={r.id} className={`flex items-center gap-3 px-3 py-2 ${hasUrl ? 'hover:bg-gray-50 cursor-pointer' : 'opacity-40'}`}>
                  <input type="checkbox" disabled={!hasUrl} checked={on}
                    onChange={() => setSel(s => { const n = new Set(s); on ? n.delete(r.id) : n.add(r.id); return n; })} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800 truncate">{r.name || '—'}</div>
                    <div className="text-xs text-gray-400 truncate">{[r.headline, r.company].filter(Boolean).join(' · ') || (hasUrl ? r.url : 'no LinkedIn URL')}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </AddPanel>
  );
}

// ── Add: paste a list ────────────────────────────────────────────────────────
function AddFromPaste({ campaignId, onDone, onCancel }: { campaignId: string; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const add = async () => {
    const rows = text.split('\n').map(line => {
      const parts = line.split(/[,\t]/).map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return null;
      const url = parts.find(p => /linkedin\.com|^https?:\/\//i.test(p)) || '';
      const name = parts.find(p => p !== url) || '';
      return (url || name) ? { name, linkedin_url: url } : null;
    }).filter(Boolean);
    if (rows.length === 0) { toast.error('Nothing to add'); return; }
    const r = await api.post(`/outreach/campaigns/${campaignId}/targets`, { from: 'manual', rows });
    toast.success(`Added ${r.data.added}${r.data.skipped ? ` · ${r.data.skipped} already in` : ''}`);
    onDone();
  };
  return (
    <AddPanel title="Paste a list" onCancel={onCancel} onAdd={add} addLabel="Add pasted">
      <p className="text-xs text-gray-500 mb-2">One per line. Format: <code className="bg-gray-100 px-1 rounded">Name, https://linkedin.com/in/…</code> (name or URL alone also works).</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
        className="w-full text-sm border border-gray-300 rounded-lg p-3 font-mono"
        placeholder={'Jane Doe, https://linkedin.com/in/janedoe\nJohn Smith, https://linkedin.com/in/johnsmith'} />
    </AddPanel>
  );
}

// ── Small UI helpers ───────────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="mb-3">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
function TokenBar({ onInsert, withAi }: { onInsert: (t: string) => void; withAi?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {TOKENS.map(t => (
        <button key={t} type="button" onClick={() => onInsert(t)}
          className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-200 font-mono">{t}</button>
      ))}
      {withAi && (
        <button type="button" onClick={() => onInsert('[[AI: write a short personalized line]]')}
          className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded hover:bg-purple-100 flex items-center gap-1">
          <Sparkles size={11} /> AI block
        </button>
      )}
    </div>
  );
}
function AddBtn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 ${active ? 'border-[#0a66c2] bg-[#0a66c2]/5 text-[#0a66c2]' : 'border-gray-300 hover:bg-gray-50 text-gray-700'}`}>
      {icon} {label}
    </button>
  );
}
function AddPanel({ title, children, onCancel, onAdd, addLabel }: { title: string; children: React.ReactNode; onCancel: () => void; onAdd: () => void; addLabel: string }) {
  return (
    <div className="border border-[#0a66c2]/30 bg-[#0a66c2]/5 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      {children}
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-sm text-gray-600 px-3 py-1.5 rounded-lg hover:bg-white">Cancel</button>
        <button onClick={onAdd} className="text-sm bg-[#0a66c2] text-white px-3 py-1.5 rounded-lg hover:bg-[#004182]">{addLabel}</button>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>{children}</div>;
}
function ColSelect({ cols, value, onChange, allowNone }: { cols: { id: string; name: string }[]; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2">
      <option value="">{allowNone ? '(none)' : 'Select…'}</option>
      {cols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
