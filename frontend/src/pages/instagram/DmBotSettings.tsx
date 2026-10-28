import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Trash2, Upload, Link as LinkIcon, Save, Bot } from 'lucide-react';
import api from '../../api/client';

interface MediaItem {
  id: string;
  my_profile: string;
  kind: string;
  caption: string | null;
  when_to_send: string | null;
  size: number;
  url: string;
}
interface Config {
  my_profile: string;
  enabled: number;
  tone: string;
  instructions: string;
  goal_link: string;
  goal_note: string;
  media_mode: string;
}

const TONES = [
  { key: 'friendly', label: 'Friendly' },
  { key: 'flirty', label: 'Flirty' },
  { key: 'professional', label: 'Professional' },
  { key: 'casual', label: 'Casual' },
];

export default function DmBotSettings({ asUser }: { asUser: string }) {
  const [account, setAccount] = useState('__default__');
  const [profiles, setProfiles] = useState<string[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const qs = (extra = '') => {
    const p = new URLSearchParams();
    if (account && account !== '__default__') p.set('my_profile', account);
    if (asUser) p.set('as_user', asUser);
    if (extra) p.set('_', String(Date.now()));
    return p.toString();
  };

  const load = () => {
    setLoading(true);
    setErr(null);
    api.get(`/instagram/dm-bot/config?${qs()}`)
      .then((r: { data: { config: Config; media: MediaItem[]; profiles: string[] } }) => {
        setCfg(r.data.config);
        setMedia(r.data.media || []);
        setProfiles(r.data.profiles || []);
      })
      .catch((e: unknown) => setErr((e as { message?: string })?.message || 'Could not load settings'))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [account, asUser]);

  const save = () => {
    if (!cfg) return;
    setSaving(true);
    api.put('/instagram/dm-bot/config', {
      my_profile: account === '__default__' ? '' : account,
      enabled: !!cfg.enabled,
      tone: cfg.tone,
      instructions: cfg.instructions,
      goal_link: cfg.goal_link,
      goal_note: cfg.goal_note,
      media_mode: cfg.media_mode,
    })
      .then(() => setSavedAt(Date.now()))
      .catch((e: unknown) => setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed'))
      .finally(() => setSaving(false));
  };

  const upload = (file: File) => {
    const fd = new FormData();
    fd.append('media', file);
    if (account !== '__default__') fd.append('my_profile', account);
    setErr(null);
    api.post('/instagram/dm-bot/media', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(load)
      .catch((e: unknown) => setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload failed'));
  };
  const delMedia = (id: string) => {
    api.delete(`/instagram/dm-bot/media/${id}`).then(() => setMedia(m => m.filter(x => x.id !== id)));
  };
  const patchMedia = (id: string, patch: Partial<MediaItem>) => {
    setMedia(m => m.map(x => (x.id === id ? { ...x, ...patch } : x)));
  };
  const saveMediaMeta = (it: MediaItem) => {
    api.patch(`/instagram/dm-bot/media/${it.id}`, { caption: it.caption || '', when_to_send: it.when_to_send || '' });
  };

  const set = (patch: Partial<Config>) => setCfg(c => (c ? { ...c, ...patch } : c));

  if (loading && !cfg) return <div className="text-gray-400 text-sm p-6">Loading…</div>;
  if (!cfg) return <div className="text-red-600 text-sm p-6">{err || 'No settings'}</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header + account */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={18} className="text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">DM Bot</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          How "Reply Unread DMs" chats with people. Settings apply per Instagram account. Needs a default provider in Settings → AI providers.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account</label>
            <select value={account} onChange={e => setAccount(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]">
              <option value="__default__">Default (all accounts)</option>
              {profiles.map(p => <option key={p} value={p}>@{p}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 mt-5 cursor-pointer select-none">
            <input type="checkbox" checked={!!cfg.enabled} onChange={e => set({ enabled: e.target.checked ? 1 : 0 })} />
            Bot enabled for this account
          </label>
        </div>
      </div>

      {/* Tone + instructions */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Tone</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {TONES.map(t => (
              <button key={t.key} onClick={() => set({ tone: t.key })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${cfg.tone === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Instructions / prompt</label>
          <p className="text-[11px] text-gray-400 mb-1">Describe exactly how the conversation should go — persona, what to ask, what to avoid, how to steer it.</p>
          <textarea value={cfg.instructions} onChange={e => set({ instructions: e.target.value })} rows={6}
            placeholder={"e.g. You're a fun, flirty creator. Keep replies short and teasing. Ask what they're into. After a couple of messages, invite them to your VIP link. If they ask for a pic, send one from the library. Never say you're a bot."}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1"><LinkIcon size={11} /> Goal link</label>
            <input value={cfg.goal_link} onChange={e => set({ goal_link: e.target.value })} placeholder="https://your-link.co/vip"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">When / how to share it</label>
            <input value={cfg.goal_note} onChange={e => set({ goal_note: e.target.value })} placeholder="after a few messages, casually"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      </div>

      {/* Media library */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5"><ImageIcon size={15} className="text-gray-500" /><span className="font-semibold text-gray-800 text-sm">Media the bot can send</span></div>
            <p className="text-[11px] text-gray-400">Photos/videos the bot may send mid-chat (e.g. when someone asks for a pic). Set a note on each for when to use it.</p>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
            <input type="radio" checked={cfg.media_mode !== 'off'} onChange={() => set({ media_mode: 'auto' })} /> Auto-send
            <input type="radio" className="ml-3" checked={cfg.media_mode === 'off'} onChange={() => set({ media_mode: 'off' })} /> Off
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {media.map(m => (
            <div key={m.id} className="border border-gray-200 rounded-lg p-2 flex gap-2">
              <div className="w-16 h-16 rounded bg-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                {m.kind === 'video'
                  ? <video src={m.url} className="w-full h-full object-cover" muted />
                  : <img src={m.url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <input value={m.caption || ''} onChange={e => patchMedia(m.id, { caption: e.target.value })} onBlur={() => saveMediaMeta(m)}
                  placeholder="caption (optional)"
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <input value={m.when_to_send || ''} onChange={e => patchMedia(m.id, { when_to_send: e.target.value })} onBlur={() => saveMediaMeta(m)}
                  placeholder="when to send (e.g. if they ask for a pic)"
                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <button onClick={() => delMedia(m.id)} className="text-gray-300 hover:text-red-500 self-start"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => fileRef.current?.click()}
            className="border border-dashed border-gray-300 rounded-lg p-3 flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 min-h-[80px]">
            <Upload size={18} /><span className="text-xs mt-1">Add photo / video</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          <Save size={14} /> {saving ? 'Saving…' : 'Save settings'}
        </button>
        {savedAt > 0 && Date.now() - savedAt < 4000 && <span className="text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}
