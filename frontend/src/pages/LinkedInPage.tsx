import { useEffect, useMemo, useState } from 'react';
import {
  BarChart2, Clock, Settings as SettingsIcon, Linkedin, ChevronDown, Trash2,
  MessageSquare, Reply, Lightbulb, Copy, Check, Download, Users, ExternalLink, Search, Send,
} from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';
import OutreachTab from './linkedin/OutreachTab';

type Tab = 'dashboard' | 'history' | 'candidates' | 'outreach' | 'settings';

interface Candidate {
  id: number;
  linkedin_url: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  headline: string | null;
  company: string | null;
  company_domain: string | null;
  email: string | null;
  email_confidence: number | null;
  phone: string | null;
  position: string | null;
  source: string | null;
  saved_to_crm: number;
  crm_contact_id: string | null;
  created_at: string;
}

interface Generation {
  id: string;
  user_id: string;
  kind: 'comment' | 'reply' | 'contribution';
  source_text: string | null;
  author_name: string | null;
  post_url: string | null;
  generated_text: string;
  tone: string | null;
  length: string | null;
  options_json: string | null;
  tokens: number | null;
  created_at: string;
}

interface LinkedInSettings {
  user_id: string;
  enabled: number;
  comment_length: 'brief' | 'medium' | 'long';
  tone: string;
  mention_author: number;
  use_emojis: number;
  open_ended: number;
  offer_services: number;
  industry: string | null;
  services_description: string | null;
  reply_keep_short: number;
  reply_open_ended: number;
  reply_ack_only_own_posts: number;
  display_name: string | null;
  headline: string | null;
}

interface Stats {
  total: number;
  tokens: number;
  byKind: { kind: string; n: number }[];
  byTone: { tone: string; n: number }[];
  daily: { day: string; kind: string; n: number }[];
}

interface AdminUser {
  id: string; name: string; email: string;
  total_generations: number; comments: number; replies: number;
  contributions: number; last_generation: string | null;
}

const TONES = [
  { id: 'excited',              label: '🎉 Excited' },
  { id: 'happy',                label: '😊 Happy' },
  { id: 'gracious',             label: '🤗 Gracious' },
  { id: 'supportive',           label: '👏 Supportive' },
  { id: 'polite',               label: '🙏 Polite' },
  { id: 'witty',                label: '😉 Witty' },
  { id: 'comic',                label: '😄 Comic' },
  { id: 'respectfully_opposed', label: '😐 Respectfully Opposed' },
  { id: 'provocative',          label: '😈 Provocative' },
  { id: 'controversial',        label: '🔥 Controversial' },
  { id: 'disappointed',         label: '😞 Disappointed' },
  { id: 'sad',                  label: '😢 Sad' },
];
const TONE_BY_ID: Record<string, string> = Object.fromEntries(TONES.map(t => [t.id, t.label]));

const KIND_COLOR: Record<string, string> = {
  comment: 'bg-blue-100 text-blue-700',
  reply: 'bg-purple-100 text-purple-700',
  contribution: 'bg-amber-100 text-amber-700',
};
const KIND_ICON: Record<string, React.ReactNode> = {
  comment: <MessageSquare size={12} />,
  reply: <Reply size={12} />,
  contribution: <Lightbulb size={12} />,
};

function fmt(d: string) {
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function LinkedInPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('dashboard');
  const [days, setDays] = useState(30);
  const [asUser, setAsUser] = useState('');
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);
  const [kindFilter, setKindFilter] = useState('');
  const [settings, setSettings] = useState<LinkedInSettings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candSearch, setCandSearch] = useState('');
  const [candLoading, setCandLoading] = useState(false);
  const [candStats, setCandStats] = useState<{
    today: { manual: number; bulk_connect: number; find_email: number; total: number };
    week: { manual: number; bulk_connect: number; find_email: number; total: number };
    total: { manual: number; bulk_connect: number; find_email: number; total: number };
  } | null>(null);

  const qs = asUser ? `?as_user=${asUser}` : '';

  async function loadCandidates() {
    setCandLoading(true);
    try {
      const [rowsRes, statsRes] = await Promise.all([
        api.get('/contacts'),
        api.get('/contacts/stats'),
      ]);
      setCandidates(rowsRes.data.data || []);
      setCandStats(statsRes.data.data || null);
    } finally { setCandLoading(false); }
  }

  useEffect(() => { if (tab === 'candidates') loadCandidates(); }, [tab]);

  async function deleteCandidate(id: number) {
    if (!confirm('Delete this candidate?')) return;
    await api.delete(`/contacts/${id}`);
    setCandidates(cs => cs.filter(c => c.id !== id));
  }

  async function pushCandidateToCrm(id: number) {
    const r = await api.post(`/contacts/${id}/to-crm`);
    if (r.data.ok) {
      setCandidates(cs => cs.map(c => c.id === id
        ? { ...c, saved_to_crm: 1, crm_contact_id: r.data.data.crmContactId }
        : c));
    }
  }

  const filteredCandidates = useMemo(() => {
    const q = candSearch.toLowerCase().trim();
    if (!q) return candidates;
    return candidates.filter(c =>
      (c.full_name || '').toLowerCase().includes(q)
      || (c.company || '').toLowerCase().includes(q)
      || (c.position || '').toLowerCase().includes(q)
      || (c.email || '').toLowerCase().includes(q)
    );
  }, [candidates, candSearch]);

  function exportCandidatesCsv() {
    const headers = ['Full Name', 'Position', 'Company', 'Email', 'Phone', 'LinkedIn URL', 'Saved At'];
    const rows = filteredCandidates.map(c => [
      c.full_name || '', c.position || '', c.company || '', c.email || '', c.phone || '',
      c.linkedin_url || '', c.created_at || '',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-candidates-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (isAdmin) api.get('/linkedin/admin/users').then(r => setAdminUsers(r.data));
  }, [isAdmin]);

  useEffect(() => {
    const q = asUser ? `?days=${days}&as_user=${asUser}` : `?days=${days}`;
    api.get(`/linkedin/stats${q}`).then(r => setStats(r.data));
  }, [days, asUser]);

  useEffect(() => {
    const sep = qs ? '&' : '?';
    const q = (kindFilter ? `${qs}${sep}kind=${kindFilter}&limit=300` : `${qs}${sep}limit=300`);
    api.get(`/linkedin/history${q}`).then(r => setHistory(r.data));
  }, [asUser, kindFilter]);

  useEffect(() => {
    api.get(`/linkedin/settings${qs}`).then(r => setSettings(r.data));
  }, [asUser]);

  function patchSettings(patch: Partial<LinkedInSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    api.put('/linkedin/settings', patch).then(r => {
      setSettings(r.data);
      setSavedAt(Date.now());
    });
  }

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function deleteRow(id: string) {
    await api.delete(`/linkedin/history/${id}`);
    setHistory(h => h.filter(r => r.id !== id));
  }

  function exportCSV() {
    const header = ['Date', 'Kind', 'Tone', 'Length', 'Author', 'Post URL', 'Source', 'Generated', 'Tokens'];
    const rows = history.map(r => [
      r.created_at, r.kind, r.tone || '', r.length || '', r.author_name || '',
      r.post_url || '', (r.source_text || '').replace(/\s+/g, ' '),
      r.generated_text.replace(/\s+/g, ' '), r.tokens ?? '',
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard',  label: 'Dashboard',  icon: <BarChart2 size={15} /> },
    { id: 'history',    label: 'History',    icon: <Clock size={15} /> },
    { id: 'candidates', label: 'Candidates', icon: <Users size={15} /> },
    { id: 'outreach',   label: 'Outreach',   icon: <Send size={15} /> },
    { id: 'settings',   label: 'Settings',   icon: <SettingsIcon size={15} /> },
  ];

  const dailyAgg = useMemo(() => {
    if (!stats) return [];
    const map: Record<string, number> = {};
    for (const r of stats.daily) map[r.day] = (map[r.day] || 0) + r.n;
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [stats]);
  const maxDaily = Math.max(1, ...dailyAgg.map(([, n]) => n));

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 pt-6 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0a66c2] to-[#004182] flex items-center justify-center">
              <Linkedin size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">LinkedIn AI Booster</h1>
              <p className="text-sm text-gray-500">Generate comments, replies & contributions — track them here</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {tab === 'dashboard' && (
              <select value={days} onChange={e => setDays(Number(e.target.value))}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            )}
            {isAdmin && adminUsers.length > 0 && (
              <div className="relative">
                <select value={asUser} onChange={e => setAsUser(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                  <option value="">My data</option>
                  {adminUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.total_generations})</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-3 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-[#0a66c2] text-[#0a66c2]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {isAdmin && !asUser && adminUsers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-sm font-semibold mb-3 text-gray-700">All users</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="py-2">User</th>
                      <th>Total</th><th>Comments</th><th>Replies</th><th>Contributions</th><th>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u.id} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50"
                          onClick={() => setAsUser(u.id)}>
                        <td className="py-2">{u.name} <span className="text-gray-400 text-xs">{u.email}</span></td>
                        <td className="font-semibold">{u.total_generations}</td>
                        <td>{u.comments}</td><td>{u.replies}</td><td>{u.contributions}</td>
                        <td className="text-gray-500 text-xs">{u.last_generation ? fmt(u.last_generation) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard label="Generations" value={stats?.total ?? 0} />
              <StatCard label="Comments" value={stats?.byKind.find(k => k.kind === 'comment')?.n ?? 0} />
              <StatCard label="Replies" value={stats?.byKind.find(k => k.kind === 'reply')?.n ?? 0} />
              <StatCard label="Contributions" value={stats?.byKind.find(k => k.kind === 'contribution')?.n ?? 0} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-sm font-semibold mb-4 text-gray-700">Activity (last {days} days)</div>
              {dailyAgg.length === 0 ? (
                <div className="text-sm text-gray-400 py-8 text-center">No generations yet — install the Chrome extension to start.</div>
              ) : (
                <div className="flex items-end gap-1 h-40">
                  {dailyAgg.map(([day, n]) => (
                    <div key={day} className="flex-1 flex flex-col items-center gap-1" title={`${day}: ${n}`}>
                      <div className="w-full bg-[#0a66c2] rounded-t" style={{ height: `${(n / maxDaily) * 100}%`, minHeight: 2 }} />
                      <div className="text-[9px] text-gray-400 -rotate-45 origin-top-left whitespace-nowrap">{day.slice(5)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-sm font-semibold mb-3 text-gray-700">Top tones used</div>
              {(stats?.byTone || []).length === 0
                ? <div className="text-sm text-gray-400">No data</div>
                : <div className="flex flex-wrap gap-2">
                    {stats!.byTone.map(t => (
                      <div key={t.tone} className="px-3 py-1.5 bg-gray-100 rounded-full text-xs">
                        {TONE_BY_ID[t.tone] || t.tone} · <span className="font-semibold">{t.n}</span>
                      </div>
                    ))}
                  </div>}
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 p-4 border-b border-gray-200">
              <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
                <option value="">All kinds</option>
                <option value="comment">Comments</option>
                <option value="reply">Replies</option>
                <option value="contribution">Contributions</option>
              </select>
              <div className="flex-1" />
              <button onClick={exportCSV}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                <Download size={14} /> Export CSV
              </button>
            </div>
            {history.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-400">No generations yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {history.map(r => (
                  <div key={r.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center gap-2 text-xs mb-2">
                      <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${KIND_COLOR[r.kind]}`}>
                        {KIND_ICON[r.kind]} {r.kind}
                      </span>
                      {r.tone && <span className="text-gray-500">{TONE_BY_ID[r.tone] || r.tone}</span>}
                      {r.length && <span className="text-gray-400">· {r.length}</span>}
                      <div className="flex-1" />
                      <span className="text-gray-400">{fmt(r.created_at)}</span>
                      <button onClick={() => copy(r.generated_text, r.id)} className="p-1 hover:bg-gray-200 rounded">
                        {copiedId === r.id ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => deleteRow(r.id)} className="p-1 hover:bg-red-50 rounded text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {r.author_name && <div className="text-xs text-gray-500 mb-1">In reply to {r.author_name}</div>}
                    {r.source_text && <div className="text-xs text-gray-500 mb-2 italic line-clamp-2">"{r.source_text}"</div>}
                    <div className="text-sm text-gray-900 whitespace-pre-wrap">{r.generated_text}</div>
                    {r.post_url && <a href={r.post_url} target="_blank" rel="noreferrer" className="text-xs text-[#0a66c2] mt-1 inline-block hover:underline">View post →</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CANDIDATES */}
        {tab === 'candidates' && (
          <div className="space-y-4">
            {/* Stats cards */}
            {candStats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 mb-1">Connection requests this week</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl font-bold text-gray-900">{candStats.week.bulk_connect}</div>
                    <div className="text-sm text-gray-400">/ 100 free · 200 premium</div>
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${candStats.week.bulk_connect >= 90 ? 'bg-red-500' : candStats.week.bulk_connect >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, candStats.week.bulk_connect)}%` }} />
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 mb-1">Requests sent today</div>
                  <div className="text-2xl font-bold text-gray-900">{candStats.today.bulk_connect}</div>
                  <div className="text-xs text-gray-400 mt-2">Keep ≤ 30/day to stay safe</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 mb-1">Emails found (Hunter)</div>
                  <div className="text-2xl font-bold text-gray-900">{candStats.total.find_email}</div>
                  <div className="text-xs text-gray-400 mt-2">{candStats.today.find_email} today</div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 mb-1">Total candidates saved</div>
                  <div className="text-2xl font-bold text-gray-900">{candStats.total.total}</div>
                  <div className="text-xs text-gray-400 mt-2">{candStats.today.total} added today</div>
                </div>
              </div>
            )}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="search"
                  value={candSearch}
                  onChange={e => setCandSearch(e.target.value)}
                  placeholder="Search name, company, position or email…"
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div className="text-xs text-gray-500">
                {filteredCandidates.length} of {candidates.length}
              </div>
              <button onClick={exportCandidatesCsv}
                className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                <Download size={14} /> Export CSV
              </button>
              <button onClick={loadCandidates}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                Refresh
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {candLoading && (
                <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
              )}
              {!candLoading && filteredCandidates.length === 0 && (
                <div className="p-10 text-center text-gray-400 text-sm">
                  No candidates yet. Visit a LinkedIn profile and click the 💾 Save Contact button.
                </div>
              )}
              {!candLoading && filteredCandidates.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr className="text-left text-gray-500 text-xs uppercase">
                      <th className="py-2.5 px-4">Name</th>
                      <th className="py-2.5 px-4">Position</th>
                      <th className="py-2.5 px-4">Company</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Phone</th>
                      <th className="py-2.5 px-4">Source</th>
                      <th className="py-2.5 px-4">Saved</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCandidates.map(c => (
                      <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 px-4 font-medium text-gray-900">{c.full_name || '—'}</td>
                        <td className="py-2.5 px-4 text-gray-600">{c.position || '—'}</td>
                        <td className="py-2.5 px-4 text-gray-600">{c.company || '—'}</td>
                        <td className="py-2.5 px-4">
                          {c.email ? (
                            <span className="text-emerald-700">{c.email}{c.email_confidence ? <span className="text-gray-400 ml-1 text-xs">({c.email_confidence}%)</span> : null}</span>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2.5 px-4">
                          {c.phone ? <span className="text-blue-700">{c.phone}</span> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2.5 px-4">
                          {c.source === 'bulk_connect' ? (
                            <span className="px-2 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-medium">🤝 Bulk Connect</span>
                          ) : c.source === 'find_email' ? (
                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">✨ Find Email</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">💾 Manual</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-gray-500">{c.created_at ? fmt(c.created_at) : '—'}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex justify-end gap-2">
                            {c.linkedin_url && (
                              <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600" title="Open LinkedIn">
                                <ExternalLink size={14} />
                              </a>
                            )}
                            {c.saved_to_crm ? (
                              <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">In CRM</span>
                            ) : (
                              <button onClick={() => pushCandidateToCrm(c.id)}
                                className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium hover:bg-blue-200">
                                → CRM
                              </button>
                            )}
                            <button onClick={() => deleteCandidate(c.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* OUTREACH */}
        {tab === 'outreach' && <OutreachTab />}

        {/* SETTINGS */}
        {tab === 'settings' && settings && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">LinkedIn Assistant</div>
                  <div className="text-xs text-gray-500">Enable AI generation across the Chrome extension</div>
                </div>
                <Toggle on={!!settings.enabled} onChange={v => patchSettings({ enabled: v ? 1 : 0 })} />
              </div>
            </div>

            <SettingsBlock title="Comment defaults">
              <Field label="Length">
                <select value={settings.comment_length}
                  onChange={e => patchSettings({ comment_length: e.target.value as 'brief' | 'medium' | 'long' })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  <option value="brief">Brief</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </Field>
              <Field label="Tone">
                <select value={settings.tone} onChange={e => patchSettings({ tone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                  {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </Field>
              <Check2 label="Mention post author" on={!!settings.mention_author} onChange={v => patchSettings({ mention_author: v ? 1 : 0 })} />
              <Check2 label="Use emojis"          on={!!settings.use_emojis}     onChange={v => patchSettings({ use_emojis: v ? 1 : 0 })} />
              <Check2 label="Open ended (ends with question)" on={!!settings.open_ended} onChange={v => patchSettings({ open_ended: v ? 1 : 0 })} />
              <Check2 label="Offer services in comment"       on={!!settings.offer_services} onChange={v => patchSettings({ offer_services: v ? 1 : 0 })} />
              {!!settings.offer_services && (
                <>
                  <Field label="Industry">
                    <input type="text" value={settings.industry || ''} placeholder="e.g. Marketing & Advertising"
                      onChange={e => patchSettings({ industry: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </Field>
                  <Field label="Services description">
                    <textarea value={settings.services_description || ''} rows={2}
                      placeholder="Briefly describe what you offer"
                      onChange={e => patchSettings({ services_description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </Field>
                </>
              )}
            </SettingsBlock>

            <SettingsBlock title="Reply defaults">
              <Check2 label="Keep replies short"             on={!!settings.reply_keep_short} onChange={v => patchSettings({ reply_keep_short: v ? 1 : 0 })} />
              <Check2 label="Open ended replies"             on={!!settings.reply_open_ended} onChange={v => patchSettings({ reply_open_ended: v ? 1 : 0 })} />
              <Check2 label="On my own posts — acknowledge only" on={!!settings.reply_ack_only_own_posts} onChange={v => patchSettings({ reply_ack_only_own_posts: v ? 1 : 0 })} />
            </SettingsBlock>

            <SettingsBlock title="About you (used when offering services)">
              <Field label="Display name">
                <input type="text" value={settings.display_name || ''}
                  onChange={e => patchSettings({ display_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </Field>
              <Field label="Headline">
                <input type="text" value={settings.headline || ''} placeholder="e.g. Growth marketer at Bibix"
                  onChange={e => patchSettings({ headline: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </Field>
            </SettingsBlock>

            <div className="text-xs text-gray-400 text-right">
              {savedAt && (Date.now() - savedAt) < 3000 ? '✓ Saved' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function SettingsBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Check2({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)}
        className="rounded border-gray-300 text-[#0a66c2] focus:ring-[#0a66c2]" />
      {label}
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-[#0a66c2]' : 'bg-gray-300'}`}>
      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}
