import { useEffect, useState } from 'react';
import { Puzzle, Download, Loader2, CheckCircle2, Clock, Chrome, Video, Pencil, Save, X } from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

interface ExtInfo {
  key: string;
  name: string;
  blurb: string;
  available: boolean;
  version: string | null;
  description: string | null;
}
interface Guide { videoUrl: string; intro: string; }

// Turn a YouTube/Vimeo watch URL into an embeddable one; leave others as-is.
function toEmbed(url: string): { kind: 'iframe' | 'video' | 'none'; src: string } {
  if (!url) return { kind: 'none', src: '' };
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) return { kind: 'video', src: url };
  return { kind: 'iframe', src: url };
}

// Render admin intro: image-URL lines become <img>, everything else is text.
function IntroBlock({ intro }: { intro: string }) {
  if (!intro.trim()) return null;
  const lines = intro.split('\n');
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const t = line.trim();
        if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(t)) {
          return <img key={i} src={t} alt="" className="max-w-full rounded-lg border border-gray-200" />;
        }
        if (!t) return <div key={i} className="h-2" />;
        return <p key={i} className="text-sm text-gray-600 leading-relaxed">{line}</p>;
      })}
    </div>
  );
}

export default function ExtensionsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [exts, setExts] = useState<ExtInfo[]>([]);
  const [guide, setGuide] = useState<Guide>({ videoUrl: '', intro: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftVideo, setDraftVideo] = useState('');
  const [draftIntro, setDraftIntro] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get('/extensions');
      setExts(data.extensions || []);
      setGuide(data.guide || { videoUrl: '', intro: '' });
    } catch {
      toast.error('Could not load extensions');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const download = async (ext: ExtInfo) => {
    setBusy(ext.key);
    const tid = toast.loading(`Packaging ${ext.name}…`);
    try {
      const res = await api.get(`/extensions/${ext.key}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bibix-${ext.key}-extension${ext.version ? '-v' + ext.version : ''}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded — now unzip & load it in Chrome', { id: tid });
    } catch {
      toast.error('Download failed', { id: tid });
    } finally { setBusy(null); }
  };

  const saveGuide = async () => {
    try {
      const { data } = await api.put('/extensions/guide', { videoUrl: draftVideo, intro: draftIntro });
      setGuide(data.guide);
      setEditing(false);
      toast.success('Install guide updated');
    } catch { toast.error('Could not save (admins only)'); }
  };

  const embed = toEmbed(guide.videoUrl);

  const STEPS = [
    'Download the extension above and unzip the folder somewhere you’ll keep it (don’t delete it afterwards).',
    'Open Chrome and go to chrome://extensions',
    'Turn on “Developer mode” (toggle in the top-right corner).',
    'Click “Load unpacked” and select the unzipped folder.',
    'The extension appears in your toolbar — pin it, then log in with your Bibix account.',
    'To update later: download the new version, unzip over the old folder, and click the ↻ reload icon on the extension card.',
  ];

  return (
    <div className="flex-1 overflow-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Puzzle className="text-monday-blue" size={26} />
          <h1 className="text-2xl font-bold text-gray-900">Browser Extensions</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">Download the latest version of each Bibix browser extension and install it in Chrome.</p>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Loading…</div>
        ) : (
          <>
            {/* ── Extension cards ─────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
              {exts.map(ext => (
                <div key={ext.key} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">{ext.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{ext.blurb}</p>
                    </div>
                    {ext.available ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 size={12} /> v{ext.version}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                        <Clock size={12} /> Coming soon
                      </span>
                    )}
                  </div>
                  <div className="flex-1" />
                  <button
                    disabled={!ext.available || busy === ext.key}
                    onClick={() => download(ext)}
                    className="mt-4 flex items-center justify-center gap-2 text-sm font-medium rounded-lg px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                      bg-monday-blue text-white hover:bg-blue-600">
                    {busy === ext.key ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    {ext.available ? 'Download .zip' : 'Not available yet'}
                  </button>
                </div>
              ))}
            </div>

            {/* ── How to install ──────────────────────────────────────── */}
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Chrome size={20} className="text-monday-blue" /> How to install in Chrome
                </h2>
                {isAdmin && !editing && (
                  <button onClick={() => { setEditing(true); setDraftVideo(guide.videoUrl); setDraftIntro(guide.intro); }}
                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-monday-blue">
                    <Pencil size={14} /> Edit guide
                  </button>
                )}
              </div>

              {/* Video area */}
              <div className="mb-6">
                {embed.kind === 'none' ? (
                  <div className="aspect-video w-full rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center text-gray-400">
                    <Video size={28} />
                    <p className="text-sm mt-2">Install video coming soon</p>
                    {isAdmin && <p className="text-xs mt-1">Admins: “Edit guide” to add a video link.</p>}
                  </div>
                ) : embed.kind === 'video' ? (
                  <video src={embed.src} controls className="w-full rounded-lg border border-gray-200 aspect-video bg-black" />
                ) : (
                  <iframe src={embed.src} title="Install guide" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen className="w-full rounded-lg border border-gray-200 aspect-video" />
                )}
              </div>

              {/* Admin notes / images */}
              {guide.intro && !editing && (
                <div className="mb-6"><IntroBlock intro={guide.intro} /></div>
              )}

              {/* Editor */}
              {editing && (
                <div className="mb-6 space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Video link (YouTube, Vimeo, or an .mp4 URL)</label>
                    <input value={draftVideo} onChange={e => setDraftVideo(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=…"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Notes & images (one per line — paste an image URL on its own line to show it)</label>
                    <textarea value={draftIntro} onChange={e => setDraftIntro(e.target.value)} rows={5}
                      placeholder={'Write any extra explanation here…\nhttps://example.com/screenshot.png'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditing(false)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><X size={14} /> Cancel</button>
                    <button onClick={saveGuide} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600"><Save size={14} /> Save</button>
                  </div>
                </div>
              )}

              {/* Step-by-step */}
              <ol className="space-y-3">
                {STEPS.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-monday-blue text-white text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm text-gray-700 leading-relaxed pt-0.5">
                      {step.split(/(chrome:\/\/extensions)/).map((part, j) =>
                        part === 'chrome://extensions'
                          ? <code key={j} className="bg-gray-100 text-monday-blue px-1.5 py-0.5 rounded text-xs">{part}</code>
                          : <span key={j}>{part}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
