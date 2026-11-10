import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import Avatar from '../components/ui/Avatar';
import api from '../api/client';
import toast from 'react-hot-toast';
import { Send, Link2, Unlink, RefreshCw, Copy, CheckCircle, Calendar, Instagram } from 'lucide-react';

const AVATAR_COLORS = ['#0073ea','#e2445c','#00c875','#ffcb00','#a25ddc','#037f4c','#bb3354','#ff642e','#9aadbd','#333333'];

interface TelegramStatus {
  linked: boolean;
  username?: string;
  defaultBoard?: { name: string; icon: string } | null;
  defaultGroup?: { name: string } | null;
  createdAt?: string;
}

interface LinkCode {
  code: string;
  botName: string | null;
  expiresAt: string;
}

function TelegramSection() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadStatus = async () => {
    try {
      const { data } = await api.get('/telegram/status');
      setStatus(data);
    } catch { setStatus({ linked: false }); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadStatus(); }, []);

  const generateCode = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post('/telegram/link-code');
      setLinkCode(data);
    } catch { toast.error('Failed to generate code'); }
    finally { setGenerating(false); }
  };

  const unlink = async () => {
    if (!confirm('Disconnect your Telegram account?')) return;
    await api.delete('/telegram/unlink');
    setStatus({ linked: false });
    setLinkCode(null);
    toast.success('Telegram disconnected');
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="animate-pulse h-4 bg-gray-100 rounded w-40" />
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-[#229ED9] flex items-center justify-center flex-shrink-0">
          <Send size={15} className="text-white" />
        </div>
        <h2 className="font-semibold text-gray-900">Telegram Integration</h2>
        {status?.linked && (
          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
            <CheckCircle size={11} /> Connected
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5 ml-11">
        Create tasks directly from Telegram — just send a message to the bot.
      </p>

      {status?.linked ? (
        <div className="ml-11 space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1.5">
            {status.username && (
              <div className="flex items-center gap-2 text-gray-700">
                <span className="text-gray-400 w-28 text-xs">Telegram user</span>
                <span className="font-medium">@{status.username}</span>
              </div>
            )}
            {status.defaultBoard && (
              <div className="flex items-center gap-2 text-gray-700">
                <span className="text-gray-400 w-28 text-xs">Default board</span>
                <span>{status.defaultBoard.icon} {status.defaultBoard.name}
                  {status.defaultGroup ? ` › ${status.defaultGroup.name}` : ''}
                </span>
              </div>
            )}
            {!status.defaultBoard && (
              <p className="text-xs text-gray-400">No default board set yet — the bot will ask you when you send your first task.</p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
            <strong>How to use:</strong> Open Telegram and send any message to your bot. It will create a task in your default board instantly.
            Send <code className="bg-blue-100 px-1 rounded">/boards</code> to change your default board.
          </div>

          <button onClick={unlink}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            <Unlink size={14} /> Disconnect Telegram
          </button>
        </div>
      ) : (
        <div className="ml-11 space-y-4">
          <div className="text-sm text-gray-600 space-y-1">
            <p>To connect your Telegram account:</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-500 ml-1">
              <li>Generate a link code below</li>
              <li>Open your Telegram bot and send the code</li>
              <li>Start creating tasks!</li>
            </ol>
          </div>

          {!linkCode ? (
            <button onClick={generateCode} disabled={generating}
              className="flex items-center gap-2 px-4 py-2 bg-[#229ED9] text-white text-sm rounded-lg hover:bg-[#1a8bc4] disabled:opacity-60 transition-colors">
              {generating
                ? <><RefreshCw size={14} className="animate-spin" /> Generating…</>
                : <><Link2 size={14} /> Generate Link Code</>}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-2">
                  {linkCode.botName
                    ? <>Send this to <a href={`https://t.me/${linkCode.botName}`} target="_blank" rel="noreferrer" className="text-[#229ED9] font-medium">@{linkCode.botName}</a> on Telegram:</>
                    : 'Send this to your bot on Telegram:'}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm font-mono font-bold tracking-widest text-gray-800">
                    /start {linkCode.code}
                  </code>
                  <button onClick={() => copy(`/start ${linkCode.code}`)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-500 hover:text-monday-blue border border-gray-200 rounded bg-white hover:border-monday-blue transition-colors">
                    {copied ? <><CheckCircle size={12} className="text-green-500" /> Copied!</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Expires in 15 minutes · <button onClick={generateCode} className="text-monday-blue hover:underline">Generate new code</button>
                </p>
              </div>

              <button onClick={loadStatus}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <RefreshCw size={13} /> Check connection status
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CalConn { id: string; calendar_email: string; created_at: string; }
interface CalStatus { google: CalConn[]; microsoft: CalConn[]; }

function CalendarSection() {
  const [status, setStatus]         = useState<CalStatus>({ google: [], microsoft: [] });
  const [loading, setLoading]       = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null); // 'google' | 'microsoft'
  const [availUrl, setAvailUrl]     = useState('');
  const [copied, setCopied]         = useState(false);

  useEffect(() => {
    api.get('/calendar/availability-link').then(r => setAvailUrl(r.data.url)).catch(() => {});
  }, []);

  const copyAvail = () => {
    navigator.clipboard?.writeText(availUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  const regenAvail = async () => {
    if (!confirm('Generate a new link? The old link will stop working.')) return;
    try { const { data } = await api.post('/calendar/availability-link/regenerate'); setAvailUrl(data.url); toast.success('New availability link generated'); }
    catch { toast.error('Failed to regenerate link'); }
  };

  const loadStatus = async () => {
    try { const { data } = await api.get('/calendar/status'); setStatus({ google: data.google || [], microsoft: data.microsoft || [] }); }
    catch { setStatus({ google: [], microsoft: [] }); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadStatus(); }, []);

  const connect = async (provider: 'google' | 'microsoft') => {
    setConnecting(provider);
    try {
      const { data } = await api.get(`/calendar/${provider}/auth`);
      window.open(data.url, '_blank', 'width=520,height=640');
      const poll = setInterval(async () => {
        const { data: s } = await api.get('/calendar/status');
        const list = provider === 'google' ? s.google : s.microsoft;
        const prev = provider === 'google' ? status.google : status.microsoft;
        if (list.length > prev.length) {
          setStatus({ google: s.google || [], microsoft: s.microsoft || [] });
          setConnecting(null); clearInterval(poll);
          toast.success(`${provider === 'google' ? 'Google' : 'Outlook'} Calendar connected!`);
        }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setConnecting(null); }, 120000);
    } catch { setConnecting(null); toast.error('Failed to start connection'); }
  };

  const disconnect = async (connId: string, label: string) => {
    if (!confirm(`Disconnect ${label}?`)) return;
    await api.delete(`/calendar/disconnect/${connId}`);
    await loadStatus();
    toast.success('Calendar disconnected');
  };

  if (loading) return <div className="bg-white rounded-xl border border-gray-200 p-6"><div className="animate-pulse h-4 bg-gray-100 rounded w-48" /></div>;

  const totalConnected = status.google.length + status.microsoft.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
          <Calendar size={16} className="text-[#1a73e8]" />
        </div>
        <h2 className="font-semibold text-gray-900">Calendar Integrations</h2>
        {totalConnected > 0 && (
          <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full font-medium">
            <CheckCircle size={11} /> {totalConnected} connected
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5 ml-11">
        Connect Google and/or Outlook — all events appear together in the Calendar view. You can connect multiple accounts.
      </p>

      <div className="ml-11 space-y-4">
        {/* Connected accounts list */}
        {totalConnected > 0 && (
          <div className="space-y-2">
            {status.google.map(c => (
              <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5">
                <Calendar size={14} className="text-[#1a73e8] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.calendar_email}</p>
                  <p className="text-xs text-gray-400">Google Calendar</p>
                </div>
                <button onClick={() => disconnect(c.id, c.calendar_email)} className="text-gray-400 hover:text-red-500 p-1"><Unlink size={13} /></button>
              </div>
            ))}
            {status.microsoft.map(c => (
              <div key={c.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-2.5">
                <Calendar size={14} className="text-[#0078d4] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.calendar_email}</p>
                  <p className="text-xs text-gray-400">Outlook / Microsoft 365</p>
                </div>
                <button onClick={() => disconnect(c.id, c.calendar_email)} className="text-gray-400 hover:text-red-500 p-1"><Unlink size={13} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Add buttons */}
        <div className="flex flex-wrap gap-3">
          <button onClick={() => connect('google')} disabled={connecting !== null}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a73e8] text-white text-sm rounded-lg hover:bg-[#1557b0] disabled:opacity-60 transition-colors">
            {connecting === 'google'
              ? <><RefreshCw size={14} className="animate-spin" /> Connecting…</>
              : <><Calendar size={14} /> {status.google.length > 0 ? 'Add another Google account' : 'Connect Google Calendar'}</>}
          </button>
          <button onClick={() => connect('microsoft')} disabled={connecting !== null}
            className="flex items-center gap-2 px-4 py-2 bg-[#0078d4] text-white text-sm rounded-lg hover:bg-[#005fa3] disabled:opacity-60 transition-colors">
            {connecting === 'microsoft'
              ? <><RefreshCw size={14} className="animate-spin" /> Connecting…</>
              : <><Calendar size={14} /> {status.microsoft.length > 0 ? 'Add another Outlook account' : 'Connect Outlook / Microsoft 365'}</>}
          </button>
        </div>

        {connecting && <p className="text-xs text-gray-400">Complete the authorization in the popup window, then come back here.</p>}

        {totalConnected > 0 && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
            <strong>How to use:</strong> Open the <strong>Calendar</strong> → all calendar events appear alongside your tasks. Click <strong>+</strong> on any day to create a meeting you can share with teammates or keep as “Busy”.
          </div>
        )}

        {/* External availability link */}
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 mb-1">
            <Link2 size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Public availability link</h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Share this link with people outside Bibix so they can see when you're <strong>busy</strong> — only your busy time blocks are shown, never the meeting details.
          </p>
          <div className="flex items-center gap-2">
            <input readOnly value={availUrl} placeholder="Generating…"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 bg-gray-50 font-mono truncate" />
            <button onClick={copyAvail} disabled={!availUrl}
              className="flex items-center gap-1.5 px-3 py-2 bg-monday-blue text-white text-xs font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {copied ? <><CheckCircle size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
            <button onClick={regenAvail} disabled={!availUrl}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
              title="Generate a new link (revokes the old one)">
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Keep old name for compatibility but replace with unified section
function GoogleCalendarSection() { return <CalendarSection />; }

function _unused() {
  const [connecting] = useState(false);
  const connect = async () => {
    try {
      const { data } = await api.get('/calendar/google/auth');
      window.open(data.url, '_blank', 'width=500,height=600');
    } catch { toast.error('Failed to start connection'); }
  };
  return <div className="ml-11"><button onClick={connect} className="flex items-center gap-2 px-4 py-2 bg-[#1a73e8] text-white text-sm rounded-lg"><Calendar size={14} /> Connect</button></div>;
}

function InstagramTokenSection() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/auth/instagram-token')
      .then(({ data }) => setToken(data.token))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const regenerate = async () => {
    if (!confirm('Generate a new token? The old one will stop working immediately.')) return;
    setRegenerating(true);
    try {
      const { data } = await api.post('/auth/instagram-token/regenerate');
      setToken(data.token);
      toast.success('New token generated');
    } catch { toast.error('Failed to regenerate token'); }
    finally { setRegenerating(false); }
  };

  const copy = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#f09433] via-[#e6683c] to-[#bc1888] flex items-center justify-center flex-shrink-0">
          <Instagram size={15} className="text-white" />
        </div>
        <h2 className="font-semibold text-gray-900">Instagram Extension</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5 ml-11">
        Paste this token in the Instagram Extension to sync your data automatically.
      </p>
      <div className="ml-11 space-y-3">
        {loading ? (
          <div className="animate-pulse h-10 bg-gray-100 rounded-lg w-full" />
        ) : (
          <div className="flex gap-2">
            <input
              readOnly
              value={token}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700 cursor-text select-all"
              onClick={e => (e.target as HTMLInputElement).select()}
            />
            <button onClick={copy}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:border-monday-blue hover:text-monday-blue transition-colors whitespace-nowrap">
              {copied ? <><CheckCircle size={14} className="text-green-500" /> Copied!</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
        )}
        <button onClick={regenerate} disabled={regenerating || loading}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
          <RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />
          {regenerating ? 'Regenerating…' : 'Regenerate token'}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('All fields are required');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.put('/auth/password', { currentPassword, newPassword });
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
      <h2 className="font-semibold text-gray-900 mb-6">Change Password</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue"
            placeholder="Enter your current password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue"
            placeholder="At least 6 characters"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue"
            placeholder="Re-enter your new password"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 px-6 py-2.5 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Update Password'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState(user?.name || '');
  const [color, setColor] = useState(user?.avatar_color || '#0073ea');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const cal = searchParams.get('calendar');
    if (cal === 'connected') toast.success('Google Calendar connected!');
    if (cal === 'error') toast.error('Google Calendar connection failed');
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUser({ name, avatar_color: color });
      toast.success('Profile updated');
    } catch { toast.error('Failed to update'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-6">Profile</h2>
          <div className="flex items-center gap-6 mb-6">
            <Avatar name={name || 'User'} color={color} size="lg" />
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Avatar Color</div>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full hover:scale-110 transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input value={user?.email} disabled
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm bg-gray-50 text-gray-500 cursor-not-allowed" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="mt-6 px-6 py-2.5 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        <ChangePasswordSection />
        <div className="mt-6">
          <TelegramSection />
        </div>
        <div className="mt-6">
          <GoogleCalendarSection />
        </div>
        <div className="mt-6">
          <InstagramTokenSection />
        </div>
      </div>
    </div>
  );
}
