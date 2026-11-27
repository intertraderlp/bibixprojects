import { useEffect, useRef, useState } from 'react';
import { Video, Upload, Link2, RefreshCw, Trash2, Eye, Copy, Check, AlertCircle, Shield, Ban } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import api from '../api/client';
import toast from 'react-hot-toast';

// VideoVue — upload protected videos and hand out share links. A link only plays
// when the viewer has the VideoVue browser extension installed; no sign-in needed.
// Backend: backend/src/routes/videos.js. Watch page: videos-watch/index.html.

interface VideoRow {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  size: number | null;
  status: 'processing' | 'ready' | 'error';
  error: string | null;
  created_at: string;
  original_name: string | null;
  enabled: boolean;
  share_url: string;
  views: number;
}
interface ViewRow { created_at: string; extension_id: string | null; ip: string | null; user_agent: string | null }

function fmtSize(b: number | null) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function fmtDur(s: number | null) {
  if (!s) return '—';
  const t = Math.round(s); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = t % 60;
  return (h ? `${h}:` : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0');
}
function fmtDate(d: string) {
  return new Date(d.replace(' ', 'T') + (d.endsWith('Z') ? '' : 'Z')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const statusPill: Record<VideoRow['status'], string> = {
  ready: 'bg-green-100 text-green-700',
  processing: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};

export default function VideoVuePage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [ffmpeg, setFfmpeg] = useState(true);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [viewsFor, setViewsFor] = useState<{ v: VideoRow; rows: ViewRow[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/videos');
      setVideos(data.videos || []);
      setFfmpeg(data.ffmpeg !== false);
    } catch (e: any) {
      if (e.response?.status !== 403) toast.error('Failed to load videos');
    } finally { setLoading(false); }
  };

  useEffect(() => { if (isAdmin) load(); else setLoading(false); }, [isAdmin]);
  // Poll while something is processing.
  useEffect(() => {
    if (!videos.some(v => v.status === 'processing')) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [videos]);

  const upload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('description', description.trim());
    fd.append('file', file);
    setProgress(0);
    try {
      await api.post('/videos', fd, {
        timeout: 0,
        onUploadProgress: (e) => { if (e.total) setProgress(Math.round((e.loaded / e.total) * 100)); },
      });
      toast.success('Uploaded, processing…');
      setFile(null); setTitle(''); setDescription('');
      if (fileInput.current) fileInput.current.value = '';
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Upload failed');
    } finally { setProgress(null); }
  };

  const copy = async (v: VideoRow) => {
    try { await navigator.clipboard.writeText(v.share_url); setCopied(v.id); setTimeout(() => setCopied(null), 1500); }
    catch { toast.error('Could not copy'); }
  };
  const rotate = async (v: VideoRow) => {
    if (!confirm('Create a new link? The current link will stop working for everyone.')) return;
    try { await api.post(`/videos/${v.id}/share/rotate`); toast.success('New link created'); load(); } catch { toast.error('Failed'); }
  };
  const toggle = async (v: VideoRow) => {
    try { await api.put(`/videos/${v.id}`, { enabled: !v.enabled }); load(); } catch { toast.error('Failed'); }
  };
  const remove = async (v: VideoRow) => {
    if (!confirm(`Delete "${v.title}" permanently?`)) return;
    try { await api.delete(`/videos/${v.id}`); toast.success('Deleted'); load(); } catch { toast.error('Failed'); }
  };
  const showViews = async (v: VideoRow) => {
    try { const { data } = await api.get(`/videos/${v.id}/views`); setViewsFor({ v, rows: data.views || [] }); } catch { toast.error('Failed'); }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Shield size={48} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500 text-white flex items-center justify-center"><Video size={20} /></div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">VideoVue</h1>
            <p className="text-sm text-gray-500">Protected videos. Share a link; it plays only with the VideoVue extension installed, no account needed.</p>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl w-full mx-auto space-y-6">
        {!ffmpeg && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
            <AlertCircle size={16} /> ffmpeg is not installed on the server, uploads will fail until it is.
          </div>
        )}

        {/* Upload */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Upload size={16} /> Upload a video</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title <span className="text-gray-400">(defaults to the file name)</span></label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex flex-col">
              <div
                onClick={() => fileInput.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                className={`flex-1 min-h-[120px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-sm cursor-pointer transition ${dragOver ? 'border-red-400 bg-red-50' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
              >
                {file ? (
                  <><span className="font-medium text-gray-800">{file.name}</span><span className="text-xs text-gray-500">{fmtSize(file.size)}</span></>
                ) : (
                  <><Video size={22} className="mb-1 text-gray-400" /><span>Drop a video here or click to choose</span></>
                )}
              </div>
              <input ref={fileInput} type="file" accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              {progress !== null && (
                <div className="mt-3">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-red-500 transition-all" style={{ width: `${progress}%` }} /></div>
                  <div className="text-xs text-gray-500 mt-1">{progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}</div>
                </div>
              )}
              <button onClick={upload} disabled={!file || progress !== null || !ffmpeg}
                className="mt-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
                Upload
              </button>
            </div>
          </div>
        </div>

        {/* Library */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Videos</h2>
            <button onClick={load} className="text-gray-500 hover:text-gray-800 p-1 rounded" title="Reload"><RefreshCw size={15} /></button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : videos.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No videos yet. Upload one above.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {videos.map(v => (
                <li key={v.id} className={`px-5 py-4 flex gap-4 items-start ${v.enabled ? '' : 'opacity-60'}`}>
                  <Thumb id={v.id} ready={v.status === 'ready'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{v.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${statusPill[v.status]}`}>{v.status}</span>
                      {!v.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">link disabled</span>}
                    </div>
                    {v.description && <div className="text-sm text-gray-500 truncate">{v.description}</div>}
                    {v.error && <div className="text-xs text-red-600 mt-1">{v.error}</div>}
                    <div className="text-xs text-gray-400 mt-1">{fmtDur(v.duration)} · {fmtSize(v.size)} · {v.views} view{v.views === 1 ? '' : 's'} · {fmtDate(v.created_at)}</div>
                    {v.status === 'ready' && (
                      <div className="mt-2 flex items-center gap-2">
                        <Link2 size={14} className="text-gray-400 shrink-0" />
                        <input readOnly value={v.share_url} onFocus={e => e.currentTarget.select()}
                          className="flex-1 min-w-0 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-700 font-mono" />
                        <button onClick={() => copy(v)} className="text-xs flex items-center gap-1 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
                          {copied === v.id ? <><Check size={12} className="text-green-600" /> Copied</> : <><Copy size={12} /> Copy link</>}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => showViews(v)} title="Who watched" className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"><Eye size={16} /></button>
                    <button onClick={() => rotate(v)} title="New link (old one stops working)" className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"><RefreshCw size={16} /></button>
                    <button onClick={() => toggle(v)} title={v.enabled ? 'Disable link' : 'Enable link'} className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded"><Ban size={16} /></button>
                    <button onClick={() => remove(v)} title="Delete" className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-xs text-gray-400 leading-relaxed">
          Viewers need the VideoVue Chrome extension (folder <code>extension-video</code> in the repo; install guide at <a className="underline" href="/watch-assets/install.html" target="_blank" rel="noreferrer">/watch-assets/install.html</a>).
          This stops links from working without the extension. It does not prevent screen recording.
        </div>
      </div>

      {viewsFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setViewsFor(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-200 font-semibold text-gray-900">Views · {viewsFor.v.title}</div>
            <div className="overflow-y-auto">
              {viewsFor.rows.length === 0 ? (
                <div className="p-6 text-sm text-gray-400 text-center">No views yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500"><tr><th className="text-left px-5 py-2">When</th><th className="text-left px-2 py-2">IP</th><th className="text-left px-2 py-2">Extension</th></tr></thead>
                  <tbody>
                    {viewsFor.rows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-5 py-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-2 py-2 font-mono text-xs">{r.ip || '—'}</td>
                        <td className="px-2 py-2 font-mono text-xs truncate max-w-[160px]" title={r.extension_id || ''}>{r.extension_id ? r.extension_id.slice(0, 10) + '…' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 text-right"><button onClick={() => setViewsFor(null)} className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// Thumbnails need the auth header, so fetch as a blob.
function Thumb({ id, ready }: { id: string; ready: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    let url: string | null = null;
    api.get(`/videos/${id}/thumb.jpg`, { responseType: 'blob' }).then(r => { url = URL.createObjectURL(r.data); setSrc(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [id, ready]);
  return (
    <div className="w-28 h-16 rounded-lg bg-gray-200 shrink-0 overflow-hidden flex items-center justify-center text-gray-400">
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <Video size={18} />}
    </div>
  );
}
