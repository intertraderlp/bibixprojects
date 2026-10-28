import { useEffect, useState, useMemo, Fragment } from 'react';
import { BarChart2, Clock, Zap, Users, Instagram, ChevronDown, Download, Calendar, UserPlus, Trash2, Plus, Contact, Pencil, X, Search, RefreshCw, ArrowLeft, ExternalLink, Copy } from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';
import PostReturnsDashboard from './instagram/PostReturnsDashboard';
import DmBotSettings from './instagram/DmBotSettings';

type Tab = 'dashboard' | 'history' | 'campaigns' | 'schedule' | 'followers' | 'accounts' | 'research' | 'automations' | 'dmbot' | 'health';

interface Automation {
  id: string;
  name: string;
  schedule_type: 'daily' | 'weekly' | 'interval';
  schedule_time: string | null;
  schedule_days: string | null;        // "1,3,5"
  schedule_interval_minutes: number | null;
  actions: string[];
  accounts: string[];
  enabled: boolean;
  is_system?: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const AUTOMATION_ACTION_LABELS: Record<string, string> = {
  follower_count: 'Daily follower count',
  scan_notifications: 'Scan notifications',
  snapshot_followers_full: 'Full follower snapshot',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface HealthBlock {
  status: 'ok' | 'late' | 'failing' | 'unknown';
}
interface HealthResponse {
  generated_at: string;
  follower_counts: HealthBlock & { last_capture_at: string | null; profiles_tracked: number };
  scheduled_posts: HealthBlock & { by_status: Record<string, number>; overdue: number };
  action_batches: HealthBlock & { by_status: Record<string, number>; stalled_running: number };
  scrape_jobs: HealthBlock & { by_status: Record<string, number>; stalled_running: number };
  extension_activity: HealthBlock & { last_action_at: string | null; actions_last_24h: number };
  permissions: HealthBlock & { role: string; tabs_allowed: number; total_tabs: number };
  accounts: HealthBlock & { count: number };
  automations?: HealthBlock & {
    total: number;
    enabled: number;
    last_run_at: string | null;
    last_status: string | null;
  };
}

interface ScrapeJob {
  id: string; target_username: string; post_count: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_message: string | null; posts_scraped: number;
  created_at: string; started_at: string | null; completed_at: string | null;
}
interface ScrapedPost {
  id: string; target_username: string; shortcode: string; post_url: string;
  post_type: 'post' | 'reel'; likes: number | null; views: number | null;
  comments: number | null; caption: string | null; last_scraped_at: string;
}
interface ScrapedSummary {
  target_username: string; post_count: number; last_scraped_at: string;
}
interface ActionCampaign {
  id: string; name: string | null;
  status: 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  total_requested: number; total_completed: number; concurrency: number;
  consecutive_failures: number; start_at: string | null;
  started_at: string | null; ended_at: string | null;
  error_message: string | null; created_at: string;
}
interface ActionCampaignSummary extends ActionCampaign {
  items_count: number;
  as_account: string | null;
  followers_back?: number;
  engagement_back?: number;
}
interface ActionItem {
  id: string; campaign_id: string; user_id: string; as_account: string;
  post_url: string; action_type: 'like' | 'reply';
  count_requested: number; count_done: number;
  reply_source: string | null; reply_texts: string | null;
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'partial' | 'no_targets' | 'failed' | 'cancelled';
  claimed_at: string | null; started_at: string | null; completed_at: string | null;
  error_message: string | null;
}

interface ScheduledPost {
  id: string; my_profile: string | null; post_type: string;
  caption: string | null; media_filename: string | null; media_mime: string | null;
  scheduled_at: string; status: string; posted_at: string | null;
  error_message: string | null; created_at: string;
}
interface FollowerChanges {
  latest:   { id: string; captured_at: string; follower_count: number; my_profile: string | null } | null;
  baseline: { id: string; captured_at: string; follower_count: number } | null;
  gained: string[]; lost: string[];
}
interface Snapshot { id: string; my_profile: string | null; captured_at: string; follower_count: number; }

interface Action {
  id: string;
  type: string;
  username: string | null;
  follower_count: number | null;
  post_url: string | null;
  reply_text: string | null;
  comment_text: string | null;
  campaign_id: string | null;
  created_at: string;
  my_profile: string | null;
  full_name: string | null;
  post_owner: string | null;
  action_date: string | null;
  // ─── Phase 1 country enrichment (Phase 2 extension scraper lands tomorrow) ───
  // LEFT JOINed from instagram_user_profiles. NULL = not yet enriched.
  user_country?: string | null;
  user_country_code?: string | null;
  user_joined_month?: string | null;
}

interface Campaign {
  id: string; type: string; status: string; actions_count: number;
  new_followers: number; started_at: string; ended_at: string | null; notes: string | null;
  post_urls?: string[]; my_profile?: string | null;
  total_requested?: number | null;  // From extension's START_CAMPAIGN — used to show X/Y
  post_url?: string | null;           // Primary post URL stored directly on the campaign row
  followers_back?: number;             // attribution-based: distinct users we engaged
                                       // who later followed us. Use this for display.
  engagement_back?: number;            // received_* events from users we engaged
  new_followers_snapshot?: number;     // legacy column — total new followers during
                                       // window from any source (includes organic)
}


const INBOUND_CARDS: { key: string; label: string; color: string; bg: string; emoji: string }[] = [
  { key: 'got_comment',      label: 'Got Comment',     color: 'text-blue-600',   bg: 'bg-blue-50',   emoji: '💬' },
  { key: 'got_like_post',    label: 'Got Like · Post', color: 'text-pink-600',   bg: 'bg-pink-50',   emoji: '❤️' },
  { key: 'got_like_reel',    label: 'Got Like · Reel', color: 'text-rose-600',   bg: 'bg-rose-50',   emoji: '🎬' },
  { key: 'got_like_comment', label: 'Got Like · Comment', color: 'text-purple-600', bg: 'bg-purple-50', emoji: '💗' },
  { key: 'got_reply',        label: 'Got Reply',       color: 'text-cyan-600',   bg: 'bg-cyan-50',   emoji: '↩️' },
  { key: 'got_mention',      label: 'Got Mention',     color: 'text-orange-600', bg: 'bg-orange-50', emoji: '@' },
];

const ACTION_TYPE_OPTIONS: { key: string; label: string }[] = [
  { key: 'like',          label: 'Like comment' },
  { key: 'comment_reply', label: 'Reply' },
  { key: 'comment',       label: 'Comment' },
  { key: 'follow',        label: 'Follow' },
  { key: 'unfollow',      label: 'Unfollow' },
];

interface AdminUser {
  id: string; name: string; email: string; total_actions: number;
  total_campaigns: number; last_action: string | null;
}

// ── Labels & colours ──────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  like:                  '❤️ Liked comment',
  comment_reply:         '💬 Replied',
  follow:                '👤 Followed',
  unfollow:              '👋 Unfollowed',
  dm_reply:              '✉️ DM Reply',
  new_follower:          '➕ New Follower',
  received_like_post:    '❤️ Got Like (post)',
  received_like_comment: '❤️ Got Like (comment)',
  received_comment:      '💬 Got Comment',
  received_reply:        '↩️ Got Reply',
  received_mention:      '📣 Got Mentioned',
  reply:                 '💬 Reply',
  notification_scan:     '🔔 Scan',
};

const TYPE_COLOR: Record<string, string> = {
  like:                  'bg-pink-100 text-pink-700',
  comment_reply:         'bg-blue-100 text-blue-700',
  follow:                'bg-green-100 text-green-700',
  unfollow:              'bg-gray-100 text-gray-600',
  dm_reply:              'bg-emerald-100 text-emerald-700',
  new_follower:          'bg-green-100 text-green-800',
  received_like_post:    'bg-rose-100 text-rose-700',
  received_like_comment: 'bg-rose-100 text-rose-700',
  received_comment:      'bg-blue-100 text-blue-700',
  received_reply:        'bg-indigo-100 text-indigo-700',
  received_mention:      'bg-purple-100 text-purple-700',
  reply:                 'bg-blue-100 text-blue-700',
  notification_scan:     'bg-purple-100 text-purple-700',
};

const STATUS_COLOR: Record<string, string> = {
  running:   'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  stopped:   'bg-gray-100 text-gray-600',
  done:      'bg-green-100 text-green-700',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(d: string) {
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtShort(d: string) {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function parseFollowers(val: number | null): number | null {
  if (val == null) return null;
  return val;
}

function displayUsername(u: string | null) {
  if (!u || u === 'unknown') return null;
  return u;
}

// Convert an ISO 3166-1 alpha-2 country code (e.g. "GB", "US") to the
// regional-indicator flag emoji (🇬🇧, 🇺🇸). Each letter maps to its
// Regional Indicator Symbol via Unicode codepoint offset.
// Returns '' for unknown / invalid input — the caller falls back to text.
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const cc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1F1E6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(base + cc.charCodeAt(0)) + String.fromCodePoint(base + cc.charCodeAt(1));
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV(rows: Action[]) {
  const headers = ['Date', 'My Profile', 'Action', 'Target Username', 'Full Name', 'Followers', 'Country', 'Reply', 'Post Owner', 'Post URL'];
  const lines = rows.map(r => [
    fmt(r.action_date || r.created_at),
    r.my_profile || '',
    TYPE_LABEL[r.type] || r.type,
    displayUsername(r.username) || '',
    r.full_name || '',
    r.follower_count != null ? r.follower_count : '',
    r.user_country || '',
    r.reply_text || r.comment_text || '',
    r.post_owner || '',
    r.post_url || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bibix-ig-history-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function InstagramPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';

  const [tab, setTab]               = useState<Tab>('dashboard');
  const [asUser, setAsUser]         = useState('');
  // Clock-drift display: server time vs user local time. Refreshed once a
  // minute (and once on mount). Helps users understand "when will my
  // automation actually fire" since scheduling uses server time.
  const [serverTimeMs, setServerTimeMs] = useState<number | null>(null);
  const [serverTimeFetchedAt, setServerTimeFetchedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const fetchServerTime = async () => {
      try {
        const r = await api.get('/instagram/server-time');
        const t = new Date(r.data?.server_time).getTime();
        if (Number.isFinite(t)) {
          setServerTimeMs(t);
          setServerTimeFetchedAt(Date.now());
        }
      } catch (_) { /* drift display hidden on failure */ }
    };
    fetchServerTime();
    const id = setInterval(fetchServerTime, 60 * 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [actions, setActions]       = useState<Action[]>([]);
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);

  // ── History filters ──────────────────────────────────────────────────────
  const [fAction,       setFAction]       = useState('');
  const [fProfile,      setFProfile]      = useState('');
  const [fUser,         setFUser]         = useState('');
  const [fPostOwner,    setFPostOwner]    = useState('');
  const [fDateFrom,     setFDateFrom]     = useState('');
  const [fDateTo,       setFDateTo]       = useState('');
  const [fFollowersOp,  setFFollowersOp]  = useState('');
  const [fFollowersVal, setFFollowersVal] = useState('');
  const [fFollowersVal2,setFFollowersVal2]= useState('');

  // ── Pagination ───────────────────────────────────────────────────────────
  const [page,    setPage]    = useState(1);
  const [perPage, setPerPage] = useState(50);

  const qs = asUser ? `?as_user=${asUser}` : '';

  useEffect(() => {
    if (isAdmin) api.get('/instagram/admin/users').then((r: { data: AdminUser[] }) => setAdminUsers(r.data));
  }, [isAdmin]);

  // Bump this to force a re-fetch of the dashboard + actions. Wired to the
  // refresh buttons on the Dashboard and History pages so users can pull
  // the latest data without switching tabs or reloading the page.
  const [refreshTick, setRefreshTick] = useState(0);
  // Pagination state for Batches tab — declared early so useEffects
  // below can reference these names. Default: load 10 rows, "Load more"
  // button bumps the limit by BATCH_PAGE_SIZE each click.
  const BATCH_PAGE_SIZE = 10;
  const [actionCampaignsLimit, setActionCampaignsLimit] = useState(BATCH_PAGE_SIZE);
  const [actionCampaignsTotal, setActionCampaignsTotal] = useState(0);
  const [campaignsLimit, setCampaignsLimit] = useState(BATCH_PAGE_SIZE);
  const [campaignsTotal, setCampaignsTotal] = useState(0);

  useEffect(() => {
    // Load all actions for client-side filtering (matches chrome extension behaviour)
    const q = `${qs ? qs + '&' : '?'}limit=2000`;
    api.get(`/instagram/actions${q}`).then((r: { data: Action[] }) => {
      setActions(r.data);
      setPage(1);
    });
  }, [asUser, refreshTick]);

  // Manual sessions — paginated, default 10. Re-runs when the user clicks
  // "Load more" (which bumps campaignsLimit). Reads either the new
  // { rows, total } envelope or the legacy bare array.
  useEffect(() => {
    const sep = qs.includes('?') ? '&' : '?';
    api.get(`/instagram/campaigns${qs}${sep}limit=${campaignsLimit}`).then((r: { data: Campaign[] | { rows: Campaign[]; total: number } }) => {
      if (Array.isArray(r.data)) {
        setCampaigns(r.data);
        setCampaignsTotal(r.data.length);
      } else {
        setCampaigns(r.data.rows || []);
        setCampaignsTotal(r.data.total || 0);
      }
    });
  }, [asUser, campaignsLimit]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [fAction, fProfile, fUser, fPostOwner, fDateFrom, fDateTo, fFollowersOp, fFollowersVal, fFollowersVal2]);

  // ── Derived: unique filter options ────────────────────────────────────────
  const profiles   = useMemo(() => [...new Set(actions.map(a => a.my_profile).filter(Boolean))].sort() as string[], [actions]);
  const postOwners = useMemo(() => [...new Set(actions.map(a => a.post_owner).filter(Boolean))].sort() as string[], [actions]);

  // ── Client-side filtering ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const fromTs = fDateFrom ? new Date(fDateFrom).getTime()               : null;
    const toTs   = fDateTo   ? new Date(fDateTo + 'T23:59:59').getTime()   : null;
    const fv1    = parseFloat(fFollowersVal);
    const fv2    = parseFloat(fFollowersVal2);

    return actions.filter(a => {
      if (fAction    && a.type !== fAction)                                                return false;
      if (fProfile   && a.my_profile !== fProfile)                                        return false;
      if (fPostOwner && a.post_owner !== fPostOwner)                                      return false;
      if (fUser      && !(displayUsername(a.username) || '').toLowerCase().includes(fUser.toLowerCase())) return false;

      const ts = new Date(a.action_date || a.created_at).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs   !== null && ts > toTs)   return false;

      if (fFollowersOp && !isNaN(fv1)) {
        const fc = a.follower_count;
        if (fc == null) return false;
        if (fFollowersOp === 'gt'      && !(fc >  fv1))                   return false;
        if (fFollowersOp === 'gte'     && !(fc >= fv1))                   return false;
        if (fFollowersOp === 'lt'      && !(fc <  fv1))                   return false;
        if (fFollowersOp === 'lte'     && !(fc <= fv1))                   return false;
        if (fFollowersOp === 'eq'      && !(fc === fv1))                  return false;
        if (fFollowersOp === 'between' && !isNaN(fv2) && !(fc >= fv1 && fc <= fv2)) return false;
      }

      return true;
    });
  }, [actions, fAction, fProfile, fUser, fPostOwner, fDateFrom, fDateTo, fFollowersOp, fFollowersVal, fFollowersVal2]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pageRows    = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  function resetFilters() {
    setFAction(''); setFProfile(''); setFUser(''); setFPostOwner('');
    setFDateFrom(''); setFDateTo(''); setFFollowersOp(''); setFFollowersVal(''); setFFollowersVal2('');
  }

  // ── Scheduled posts ──────────────────────────────────────────────────────
  const [scheduled, setScheduled]         = useState<ScheduledPost[]>([]);
  const [newPostFile, setNewPostFile]     = useState<File | null>(null);
  const [newPostCaption, setNewPostCaption] = useState('');
  // AI caption generator
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiTone, setAiTone] = useState<'friendly'|'professional'|'funny'|'inspirational'>('friendly');
  const [aiHashtags, setAiHashtags] = useState(true);
  const [aiComments, setAiComments] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [newPostType, setNewPostType]     = useState<'post' | 'story' | 'reel'>('post');
  const [newPostWhen, setNewPostWhen]     = useState('');
  const [newPostProfile, setNewPostProfile] = useState('');
  const [creatingPost, setCreatingPost]   = useState(false);

  const loadScheduled = () =>
    api.get(`/instagram/scheduled-posts${qs}`)
      .then((r: { data: unknown }) => setScheduled(Array.isArray(r.data) ? r.data as ScheduledPost[] : []))
      .catch(() => setScheduled([]));

  useEffect(() => { if (tab === 'schedule') loadScheduled(); }, [tab, asUser]);

  async function createScheduledPost() {
    if (!newPostFile || !newPostWhen) { alert('Pick a media file and a time.'); return; }
    const fd = new FormData();
    fd.append('media', newPostFile);
    fd.append('caption', newPostCaption);
    fd.append('post_type', newPostType);
    fd.append('scheduled_at', new Date(newPostWhen).toISOString());
    if (newPostProfile) fd.append('my_profile', newPostProfile.replace(/^@/, ''));
    setCreatingPost(true);
    try {
      await api.post('/instagram/scheduled-posts', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNewPostFile(null); setNewPostCaption(''); setNewPostWhen(''); setNewPostProfile('');
      await loadScheduled();
    } catch (e: unknown) {
      alert('Failed to schedule: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setCreatingPost(false); }
  }

  async function deleteScheduled(id: string) {
    if (!confirm('Delete this scheduled post?')) return;
    await api.delete(`/instagram/scheduled-posts/${id}`);
    await loadScheduled();
  }

  // Encode a small image to base64 so Groq's vision model can see it. Skip
  // for video (Groq doesn't accept video) and for images >4MB to keep the
  // payload reasonable.
  function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
  }

  async function generateAICaption() {
    if (!aiTopic.trim() && !aiComments.trim() && !newPostFile) {
      alert('Add a topic, some notes, or upload a file first.'); return;
    }
    setAiBusy(true);
    try {
      let imageB64: string | null = null;
      let mimeType: string | null = null;
      if (newPostFile && newPostFile.type.startsWith('image/') && newPostFile.size <= 4 * 1024 * 1024) {
        const buf = await newPostFile.arrayBuffer();
        imageB64 = arrayBufferToBase64(buf);
        mimeType = newPostFile.type;
      }
      const res = await api.post(`/instagram/ai-caption${qs}`, {
        topic: aiTopic,
        tone: aiTone,
        include_hashtags: aiHashtags,
        comments: aiComments,
        image_b64: imageB64,
        mime_type: mimeType,
      });
      if (res.data?.caption) setNewPostCaption(res.data.caption);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (e instanceof Error ? e.message : String(e));
      alert('Failed to generate caption: ' + msg);
    } finally { setAiBusy(false); }
  }

  // ── Follower snapshots / changes ─────────────────────────────────────────
  const [changes, setChanges]               = useState<FollowerChanges | null>(null);
  const [snapshots, setSnapshots]           = useState<Snapshot[]>([]);
  const [followerDays, setFollowerDays]     = useState(7);
  const [followerProfile, setFollowerProfile] = useState('');

  // ── Daily follower-count history ─────────────────────────────────────────
  interface FollowerCountPoint { bucket: string; follower_count: number; delta: number | null }
  interface FollowerCountSeries { my_profile: string; points: FollowerCountPoint[] }
  const [followerCountSeries, setFollowerCountSeries] = useState<FollowerCountSeries[]>([]);
  const [followerCountAgg, setFollowerCountAgg] = useState<'day'|'month'>('day');
  const [followerCountProfile, setFollowerCountProfile] = useState('');
  const [followerRefreshBusy, setFollowerRefreshBusy] = useState(false);
  const [followerRefreshNote, setFollowerRefreshNote] = useState<string | null>(null);

  async function triggerFollowerCountNow() {
    setFollowerRefreshBusy(true);
    setFollowerRefreshNote(null);
    try {
      await api.post(`/instagram/follower-counts/trigger${qs}`);
      setFollowerRefreshNote('Triggered — counts will appear within ~2 minutes on the device with Automation enabled.');
      // Poll for fresh data a few times after the trigger
      const reload = async () => {
        const profile = followerCountProfile ? `&my_profile=${encodeURIComponent(followerCountProfile)}` : '';
        const sep = qs ? `${qs}&` : '?';
        try {
          const r = await api.get(`/instagram/follower-counts${sep}aggregate=${followerCountAgg}${profile}`);
          setFollowerCountSeries(Array.isArray(r.data) ? r.data as FollowerCountSeries[] : []);
        } catch (_) {}
      };
      setTimeout(reload, 60000);
      setTimeout(reload, 120000);
      setTimeout(reload, 180000);
    } catch (e: unknown) {
      setFollowerRefreshNote('Failed to trigger: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setFollowerRefreshBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== 'followers') return;
    const profile = followerCountProfile ? `&my_profile=${encodeURIComponent(followerCountProfile)}` : '';
    const sep = qs ? `${qs}&` : '?';
    api.get(`/instagram/follower-counts${sep}aggregate=${followerCountAgg}${profile}`)
      .then((r: { data: unknown }) => setFollowerCountSeries(Array.isArray(r.data) ? r.data as FollowerCountSeries[] : []))
      .catch(() => setFollowerCountSeries([]));
  }, [tab, asUser, followerCountAgg, followerCountProfile]);

  // ── Multi-account: list of detected Instagram accounts ──────────────────
  const [igAccounts, setIgAccounts] = useState<string[]>([]);
  const [newAccount, setNewAccount] = useState('');

  // ── AI providers: gate the "AI" reply option in batches/automations on
  //    whether the user has at least one provider key configured.
  const [hasAiKey, setHasAiKey] = useState(false);
  interface AiCatalogEntry { id: string; display: string; default_model: string; docs_url: string; free_tier: boolean }
  interface AiUserProvider { provider: string; model: string | null; base_url: string | null; is_default: boolean; api_key_masked: string }
  const [aiCatalog, setAiCatalog] = useState<AiCatalogEntry[]>([]);
  const [aiProviders, setAiProviders] = useState<AiUserProvider[]>([]);
  const [aiAddProvider, setAiAddProvider] = useState<string>('groq');
  const [aiAddKey, setAiAddKey] = useState('');
  const [aiAddModel, setAiAddModel] = useState('');
  const [aiTestStatus, setAiTestStatus] = useState<{kind:'ok'|'err'; msg:string} | null>(null);
  const [aiKeyBusy, setAiKeyBusy] = useState(false);
  const loadAiHasKey = () =>
    api.get('/ai/has-key')
      .then((r: { data: { has_key: boolean } }) => setHasAiKey(!!r.data?.has_key))
      .catch(() => setHasAiKey(false));
  const loadAiCatalog = () =>
    api.get('/ai/catalog')
      .then((r: { data: AiCatalogEntry[] }) => setAiCatalog(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAiCatalog([]));
  const loadAiProviders = () =>
    api.get('/ai/providers')
      .then((r: { data: AiUserProvider[] }) => setAiProviders(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAiProviders([]));
  useEffect(() => { loadAiHasKey(); loadAiCatalog(); loadAiProviders(); }, []);
  async function addAiProvider() {
    if (!aiAddKey || aiAddKey.trim().length < 8) {
      alert('Paste a real API key (at least 8 chars).'); return;
    }
    setAiKeyBusy(true); setAiTestStatus(null);
    try {
      // Test first so the user finds out immediately if the key is wrong,
      // before we persist it (which we'll do on success).
      const testRes = await api.post('/ai/test', {
        provider: aiAddProvider,
        api_key: aiAddKey.trim(),
        model: aiAddModel || undefined,
      });
      if (!testRes.data?.ok) {
        setAiTestStatus({ kind: 'err', msg: testRes.data?.error || 'Key did not validate.' });
        return;
      }
      await api.post('/ai/providers', {
        provider: aiAddProvider,
        api_key: aiAddKey.trim(),
        model: aiAddModel || undefined,
      });
      setAiAddKey(''); setAiAddModel('');
      setAiTestStatus({ kind: 'ok', msg: `Saved. Test reply: "${(testRes.data?.sample || '').slice(0, 60)}"` });
      await loadAiProviders(); await loadAiHasKey();
    } catch (e: unknown) {
      // Surface the backend's real reason (e.g. the provider's error text),
      // not just axios's generic "Request failed with status code 502".
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      setAiTestStatus({ kind: 'err', msg: err.response?.data?.error || err.message || String(e) });
    } finally { setAiKeyBusy(false); }
  }
  async function removeAiProvider(provider: string) {
    if (!confirm(`Remove your ${provider} API key? Batches using this provider will start failing until you add a new key.`)) return;
    try {
      await api.delete(`/ai/providers/${provider}`);
      await loadAiProviders(); await loadAiHasKey();
    } catch (e: unknown) { alert((e instanceof Error ? e.message : String(e))); }
  }
  async function setDefaultAiProvider(provider: string) {
    try {
      await api.post(`/ai/providers/${provider}/default`);
      await loadAiProviders();
    } catch (e: unknown) { alert((e instanceof Error ? e.message : String(e))); }
  }
  const loadAccounts = () =>
    api.get(`/instagram/accounts${qs}`)
      .then((r: { data: unknown }) => setIgAccounts(Array.isArray(r.data) ? r.data as string[] : []))
      .catch(() => setIgAccounts([]));
  useEffect(() => { loadAccounts(); }, [asUser]);
  // Mirror of the backend reserved-words check so we can show a friendly
  // error before the round-trip.
  const RESERVED_IG_USERNAMES = new Set([
    'close', 'cancel', 'save', 'back', 'next', 'done', 'more', 'menu',
    'home', 'search', 'explore', 'profile', 'messages', 'notifications',
    'create', 'settings', 'about', 'help', 'logout', 'login', 'signup',
    'instagram', 'meta', 'facebook', 'reels', 'feed', 'inbox',
  ]);
  async function addAccount() {
    const u = newAccount.trim().replace(/^@/, '').toLowerCase();
    if (!u) return;
    if (!/^[a-z0-9._]{1,30}$/.test(u)) {
      alert(`"${u}" is not a valid Instagram username (lowercase letters, numbers, dot, underscore only).`);
      return;
    }
    if (RESERVED_IG_USERNAMES.has(u)) {
      alert(`"${u}" looks like a UI label, not an Instagram username. Please double-check.`);
      return;
    }
    try {
      await api.post('/instagram/accounts', { username: u });
      setNewAccount('');
      await loadAccounts();
    } catch (e: unknown) {
      alert('Could not add account: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function removeAccount(username: string) {
    if (!confirm(`Remove @${username} from the account list? (does not affect Instagram)`)) return;
    await api.delete(`/instagram/accounts/${encodeURIComponent(username)}`);
    await loadAccounts();
  }

  // ── Edit a scheduled post ────────────────────────────────────────────────
  const [editingPost, setEditingPost] = useState<ScheduledPost | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editType, setEditType] = useState<'post' | 'story' | 'reel'>('post');
  const [editWhen, setEditWhen] = useState('');
  const [editProfile, setEditProfile] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  function openEdit(p: ScheduledPost) {
    setEditingPost(p);
    setEditCaption(p.caption || '');
    setEditType((p.post_type as 'post' | 'story' | 'reel') || 'post');
    // Convert ISO to local datetime-local string (yyyy-MM-ddTHH:mm)
    const d = new Date(p.scheduled_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEditWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setEditProfile(p.my_profile || '');
    setEditFile(null);
  }
  async function saveEdit() {
    if (!editingPost) return;
    setSavingEdit(true);
    try {
      await api.patch(`/instagram/scheduled-posts/${editingPost.id}`, {
        caption: editCaption,
        post_type: editType,
        scheduled_at: new Date(editWhen).toISOString(),
        my_profile: editProfile || null,
      });
      if (editFile) {
        const fd = new FormData();
        fd.append('media', editFile);
        await api.post(`/instagram/scheduled-posts/${editingPost.id}/media`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      setEditingPost(null);
      await loadScheduled();
    } catch (e: unknown) {
      alert('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setSavingEdit(false); }
  }

  // ── Profile research (scrape jobs + results) ─────────────────────────────
  const [scrapeJobs,    setScrapeJobs]    = useState<ScrapeJob[]>([]);
  const [scrapedSummary, setScrapedSummary] = useState<ScrapedSummary[]>([]);
  const [scrapeTarget,  setScrapeTarget]  = useState('');
  const [scrapeCount,   setScrapeCount]   = useState('25');
  const [scrapeBusy,    setScrapeBusy]    = useState(false);
  const [viewingUser,   setViewingUser]   = useState<string | null>(null);
  const [viewingPosts,  setViewingPosts]  = useState<ScrapedPost[]>([]);

  const loadResearch = async () => {
    try {
      const [jobsRes, summaryRes] = await Promise.all([
        api.get(`/instagram/scrape-jobs${qs}`),
        api.get(`/instagram/scraped-posts${qs}`),
      ]);
      setScrapeJobs(Array.isArray(jobsRes.data) ? jobsRes.data as ScrapeJob[] : []);
      setScrapedSummary(Array.isArray(summaryRes.data) ? summaryRes.data as ScrapedSummary[] : []);
    } catch (_) { /* keep prior state */ }
  };

  useEffect(() => { if (tab === 'research') loadResearch(); }, [tab, asUser]);

  // Auto-refresh research view while a job is pending or running so the user
  // sees status updates without manually reloading.
  useEffect(() => {
    if (tab !== 'research') return;
    const hasActive = scrapeJobs.some(j => j.status === 'pending' || j.status === 'running');
    if (!hasActive) return;
    const id = setInterval(loadResearch, 5000);
    return () => clearInterval(id);
  }, [tab, scrapeJobs, asUser]);

  // Accept the username in any common form: `elizabethvasilenko`,
  // `@elizabethvasilenko`, `https://www.instagram.com/elizabethvasilenko/`,
  // `instagram.com/elizabethvasilenko`. Return the bare lowercase username
  // or empty string if nothing recognizable.
  function extractIgUsername(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Try URL pattern first
    const urlMatch = trimmed.match(/instagram\.com\/([^/?#@\s]+)/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
    // Plain or @-prefixed
    return trimmed.replace(/^@/, '').toLowerCase();
  }
  async function createScrapeJob() {
    const target = extractIgUsername(scrapeTarget);
    if (!target || !/^[a-z0-9._]{1,30}$/.test(target)) {
      alert(`"${scrapeTarget}" doesn't look like a valid Instagram username or URL.`);
      return;
    }
    const count = Math.max(1, Math.min(200, parseInt(scrapeCount, 10) || 25));
    setScrapeBusy(true);
    try {
      await api.post(`/instagram/scrape-jobs${qs}`, { target_username: target, post_count: count });
      setScrapeTarget('');
      await loadResearch();
    } catch (e: unknown) {
      alert('Failed to queue scrape: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setScrapeBusy(false); }
  }

  async function deleteScrapeJob(id: string) {
    if (!confirm('Delete this scrape job?')) return;
    try {
      await api.delete(`/instagram/scrape-jobs/${id}${qs}`);
      await loadResearch();
    } catch (e: unknown) {
      alert('Failed to delete: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function clearScrapeJobs(onlyFailed: boolean) {
    const label = onlyFailed ? 'failed scrape jobs' : 'all scrape jobs';
    if (!confirm(`Delete ${label}? This does not delete the scraped post data.`)) return;
    try {
      const suffix = onlyFailed ? '?status=failed' : '';
      await api.delete(`/instagram/scrape-jobs${suffix}${qs ? (suffix ? '&' : '?') + qs.slice(1) : ''}`);
      await loadResearch();
    } catch (e: unknown) {
      alert('Failed to clear: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function deleteScrapedProfile(username: string) {
    if (!confirm(`Delete all scraped posts for @${username}?`)) return;
    try {
      await api.delete(`/instagram/scraped-profiles/${encodeURIComponent(username)}${qs}`);
      await loadResearch();
    } catch (e: unknown) {
      alert('Failed to delete: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  async function clearAllScrapedProfiles() {
    if (!confirm('Delete ALL scraped post data for every profile? This cannot be undone.')) return;
    try {
      await api.delete(`/instagram/scraped-profiles${qs}`);
      await loadResearch();
    } catch (e: unknown) {
      alert('Failed to clear: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function openScrapedUser(username: string) {
    setViewingUser(username);
    setViewingPosts([]);
    setSelectedPosts(new Set());
    try {
      const res = await api.get(`/instagram/scraped-posts${qs ? qs + '&' : '?'}target_username=${encodeURIComponent(username)}`);
      setViewingPosts(Array.isArray(res.data) ? res.data as ScrapedPost[] : []);
    } catch (_) { setViewingPosts([]); }
  }

  // ── Automations (recurring jobs) ─────────────────────────────────────────
  const [automations, setAutomations] = useState<Automation[]>([]);
  // Cronjobs UI filters: by account and by kind (all / system / user-defined).
  const [autoFilterAccount, setAutoFilterAccount] = useState('');
  const [autoFilterKind, setAutoFilterKind] = useState<'all' | 'system' | 'user'>('all');
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [aForm, setAForm] = useState<{
    name: string; schedule_type: 'daily'|'weekly'|'interval';
    schedule_time: string; schedule_days: number[];
    schedule_interval_minutes: string;
    actions: string[]; accounts: string[];
  }>({
    name: '', schedule_type: 'daily', schedule_time: '09:00',
    schedule_days: [1, 2, 3, 4, 5], schedule_interval_minutes: '60',
    actions: ['follower_count'], accounts: [],
  });
  const [aSaving, setASaving] = useState(false);

  const loadAutomations = async () => {
    try {
      const r = await api.get(`/instagram/automations${qs}`);
      setAutomations(Array.isArray(r.data) ? r.data as Automation[] : []);
    } catch (_) { setAutomations([]); }
  };
  useEffect(() => {
    if (tab === 'automations') loadAutomations();
  }, [tab, asUser]);
  // Auto-refresh while any automation just ran or is due soon
  useEffect(() => {
    if (tab !== 'automations') return;
    const id = setInterval(loadAutomations, 30000);
    return () => clearInterval(id);
  }, [tab, asUser]);

  function openNewAutomation() {
    setEditingAutomation(null);
    setAForm({
      name: '', schedule_type: 'daily', schedule_time: '09:00',
      schedule_days: [1, 2, 3, 4, 5], schedule_interval_minutes: '60',
      actions: ['follower_count'], accounts: igAccounts.slice(0, 5),
    });
    setShowAutomationModal(true);
  }
  function openEditAutomation(a: Automation) {
    setEditingAutomation(a);
    setAForm({
      name: a.name,
      schedule_type: a.schedule_type,
      schedule_time: a.schedule_time || '09:00',
      schedule_days: a.schedule_days ? a.schedule_days.split(',').map(d => parseInt(d, 10)) : [1,2,3,4,5],
      schedule_interval_minutes: String(a.schedule_interval_minutes || 60),
      actions: a.actions || ['follower_count'],
      accounts: a.accounts || [],
    });
    setShowAutomationModal(true);
  }
  async function submitAutomation() {
    if (!aForm.name.trim()) { alert('Give the automation a name.'); return; }
    if (aForm.actions.length === 0) { alert('Pick at least one action.'); return; }
    if (aForm.accounts.length === 0) { alert('Pick at least one Instagram account.'); return; }
    setASaving(true);
    try {
      const body = {
        name: aForm.name.trim(),
        schedule_type: aForm.schedule_type,
        schedule_time: aForm.schedule_type === 'interval' ? null : aForm.schedule_time,
        schedule_days: aForm.schedule_type === 'weekly' ? aForm.schedule_days : null,
        schedule_interval_minutes: aForm.schedule_type === 'interval' ? parseInt(aForm.schedule_interval_minutes, 10) : null,
        actions: aForm.actions,
        accounts: aForm.accounts,
        // Send the browser's UTC offset (e.g. +180 for UTC+3) so the backend
        // interprets schedule_time as LOCAL time and the job fires when the
        // user expects — not in the server's timezone.
        tz_offset_minutes: -new Date().getTimezoneOffset(),
      };
      if (editingAutomation) {
        await api.patch(`/instagram/automations/${editingAutomation.id}${qs}`, body);
      } else {
        await api.post(`/instagram/automations${qs}`, body);
      }
      setShowAutomationModal(false);
      await loadAutomations();
    } catch (e: unknown) {
      alert('Failed to save: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setASaving(false); }
  }
  async function toggleAutomation(a: Automation) {
    await api.patch(`/instagram/automations/${a.id}${qs}`, { enabled: !a.enabled });
    await loadAutomations();
  }
  async function runAutomationNow(id: string) {
    await api.post(`/instagram/automations/${id}/run-now${qs}`);
    await loadAutomations();
  }
  async function deleteAutomation(id: string) {
    if (!confirm('Delete this automation permanently?')) return;
    await api.delete(`/instagram/automations/${id}${qs}`);
    await loadAutomations();
  }
  function describeSchedule(a: Automation): string {
    if (a.schedule_type === 'interval') return `Every ${a.schedule_interval_minutes || '?'} min`;
    const t = a.schedule_time || '09:00';
    // schedule_time is the user's local time (backend interprets it with the
    // stored tz offset). Tag it so it's unambiguous against the "Next:" value.
    if (a.schedule_type === 'daily') return `Daily ${t} (your time)`;
    if (a.schedule_type === 'weekly') {
      const days = a.schedule_days ? a.schedule_days.split(',').map(d => DAY_NAMES[parseInt(d, 10)]).filter(Boolean).join(' ') : 'no days';
      return `${days} ${t} (your time)`;
    }
    return a.schedule_type;
  }

  // ── System health (admin-only QA dashboard) ──────────────────────────────
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const loadHealth = async () => {
    setHealthBusy(true);
    try {
      const r = await api.get('/instagram/admin/health');
      setHealth(r.data as HealthResponse);
    } catch (_) { setHealth(null); }
    finally { setHealthBusy(false); }
  };
  useEffect(() => {
    if (tab === 'health') loadHealth();
  }, [tab]);

  // ── Action campaigns (drafts that you build up, then Send) ───────────────
  // Flow: create empty draft → add up to 20 items (from Research or by URL)
  // → click Send → extension picks it up. Items can be edited (count) or
  // removed while still 'pending'; new items can be appended even after Send
  // (up to the 20-cap), as long as the campaign isn't completed/cancelled.
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [actionCampaigns, setActionCampaigns] = useState<ActionCampaignSummary[]>([]);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<ActionItem[]>([]);

  // Create-campaign modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createAccount, setCreateAccount] = useState('');
  const [createFreeText, setCreateFreeText] = useState('');
  const [createConcurrency, setCreateConcurrency] = useState('6');
  const [createStartAt, setCreateStartAt] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // ─── Quick Batch (mobile-first one-screen create + send) ──────────────────
  // The classic flow has three steps (create draft → add posts one by one →
  // press Send). On mobile that's tedious — this panel collapses all three
  // into a single screen: pick account, pick action, set count, paste post
  // URLs (one per line), tap one button.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickAccount, setQuickAccount] = useState('');
  const [quickActionType, setQuickActionType] = useState<'like' | 'reply' | 'follow'>('like');
  const [quickCount, setQuickCount] = useState('100');
  const [quickUrls, setQuickUrls] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  // Add-to-campaign modal (triggered from Research)
  const [showAddToCampaign, setShowAddToCampaign] = useState(false);
  const [addToCampaignId, setAddToCampaignId] = useState('');
  const [addToActionType, setAddToActionType] = useState<'like' | 'reply'>('like');
  const [addToCount, setAddToCount] = useState('3');
  const [addToReplySource, setAddToReplySource] = useState<'default' | 'custom' | 'ai'>('default');
  const [addToReplyText, setAddToReplyText] = useState('');
  const [addToBusy, setAddToBusy] = useState(false);

  // Add-by-URL form inside campaign detail
  const [byUrlInput, setByUrlInput] = useState('');
  const [byUrlActionType, setByUrlActionType] = useState<'like' | 'reply'>('like');
  const [byUrlCount, setByUrlCount] = useState('3');
  const [byUrlReplySource, setByUrlReplySource] = useState<'default' | 'custom' | 'ai'>('default');
  const [byUrlReplyText, setByUrlReplyText] = useState('');
  const [byUrlBusy, setByUrlBusy] = useState(false);

  const loadActionCampaigns = async (limit = actionCampaignsLimit) => {
    try {
      const sep = qs.includes('?') ? '&' : '?';
      const res = await api.get(`/instagram/action-campaigns${qs}${sep}limit=${limit}`);
      // New paginated response: { rows, total, has_more }.
      // Legacy fallback: bare array (for old backend before this commit).
      const data = res.data;
      if (Array.isArray(data)) {
        setActionCampaigns(data as ActionCampaignSummary[]);
        setActionCampaignsTotal(data.length);
      } else {
        setActionCampaigns(Array.isArray(data.rows) ? data.rows as ActionCampaignSummary[] : []);
        setActionCampaignsTotal(data.total || 0);
      }
    } catch (_) { /* keep state */ }
  };
  const loadExpandedItems = async (id: string) => {
    try {
      const res = await api.get(`/instagram/action-campaigns/${id}${qs}`);
      setExpandedItems(Array.isArray(res.data?.items) ? res.data.items as ActionItem[] : []);
    } catch (_) { setExpandedItems([]); }
  };

  useEffect(() => {
    if (tab === 'campaigns') loadActionCampaigns(actionCampaignsLimit);
  }, [tab, asUser, actionCampaignsLimit]);

  useEffect(() => {
    if (tab !== 'campaigns') return;
    const active = actionCampaigns.some(c => c.status === 'pending' || c.status === 'running');
    if (!active && !expandedCampaign) return;
    const id = setInterval(() => {
      loadActionCampaigns();
      if (expandedCampaign) loadExpandedItems(expandedCampaign);
    }, 5000);
    return () => clearInterval(id);
  }, [tab, actionCampaigns, expandedCampaign, asUser]);

  function togglePostSelection(postId: string) {
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  }

  async function createCampaign() {
    if (!createAccount) { alert('Pick an Instagram account for the batch.'); return; }
    const conc = Math.max(1, Math.min(6, parseInt(createConcurrency, 10) || 6));
    setCreateBusy(true);
    try {
      const res = await api.post(`/instagram/action-campaigns${qs}`, {
        as_account: createAccount,
        concurrency: conc,
        free_text: createFreeText || null,
        start_at: createStartAt ? new Date(createStartAt).toISOString() : null,
      });
      setShowCreateModal(false);
      setCreateFreeText('');
      setCreateStartAt('');
      await loadActionCampaigns();
      // Open it for immediate item-adding
      const newId = res.data?.id;
      if (newId) { setExpandedCampaign(newId); loadExpandedItems(newId); }
    } catch (e: unknown) {
      alert('Failed to create batch: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setCreateBusy(false); }
  }

  // Mobile Quick Batch — one tap to create draft, add all pasted posts as
  // items, and send. Bundles three API calls (POST campaign, POST items,
  // POST send) into one flow so the PWA user never has to navigate between
  // steps. Validates: at least one valid post URL, account picked, count > 0.
  //
  // Accepted URL formats (all parsed to canonical /p/<code>/):
  //   https://www.instagram.com/p/CODE/
  //   https://www.instagram.com/reel/CODE/
  //   https://www.instagram.com/<user>/p/CODE/
  //   instagram.com/p/CODE
  //   p/CODE/
  function parsePostUrls(text: string): string[] {
    const lines = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const out: string[] = [];
    for (const line of lines) {
      const m = line.match(/(?:^|\/)(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (m) out.push(`https://www.instagram.com/p/${m[1]}/`);
    }
    // Deduplicate while preserving order
    return [...new Set(out)];
  }

  async function submitQuickBatch() {
    if (!quickAccount) { alert('Pick an Instagram account first.'); return; }
    const urls = parsePostUrls(quickUrls);
    if (urls.length === 0) { alert('Paste at least one Instagram post URL (one per line).'); return; }
    if (urls.length > 20) { alert(`Max 20 posts per batch — you pasted ${urls.length}. Trim the list and try again.`); return; }
    const count = Math.max(1, Math.min(800, parseInt(quickCount, 10) || 0));
    if (count === 0) { alert('Count must be at least 1.'); return; }

    setQuickBusy(true);
    try {
      // 1) Create draft batch
      const camp = await api.post(`/instagram/action-campaigns${qs}`, {
        as_account: quickAccount,
        concurrency: 6,
        free_text: `quick · ${urls.length} post${urls.length === 1 ? '' : 's'} × ${count} ${quickActionType}`,
        start_at: null,
      });
      const campaignId = camp.data?.id;
      if (!campaignId) throw new Error('Backend did not return a campaign id.');

      // 2) Add each post as an item (sequential to honor the 20-cap check)
      for (const url of urls) {
        await api.post(`/instagram/action-campaigns/${campaignId}/items${qs}`, {
          post_url: url,
          action_type: quickActionType,
          count,
        });
      }

      // 3) Send (transition draft → pending → ready for extension dispatch)
      await api.post(`/instagram/action-campaigns/${campaignId}/send${qs}`);

      // Reset form + reload list + open the new batch so the user sees it.
      setQuickUrls('');
      setQuickOpen(false);
      await loadActionCampaigns();
      setExpandedCampaign(campaignId);
      loadExpandedItems(campaignId);
    } catch (e: unknown) {
      const msg = e as { response?: { data?: { error?: string } } };
      alert('Failed to create batch: ' + (msg.response?.data?.error || (e instanceof Error ? e.message : String(e))));
    } finally {
      setQuickBusy(false);
    }
  }

  function openAddToCampaign() {
    // Default to the most-recent draft if any, else first non-completed campaign
    const eligible = actionCampaigns.filter(c =>
      c.status !== 'completed' && c.status !== 'cancelled' && (c.items_count ?? 0) < 20
    );
    setAddToCampaignId(eligible[0]?.id || '');
    setShowAddToCampaign(true);
  }

  async function submitAddToCampaign() {
    if (!addToCampaignId) { alert('Pick a batch first (or create a new one).'); return; }
    const count = Math.max(1, parseInt(addToCount, 10) || 1);
    const selected = viewingPosts.filter(p => selectedPosts.has(p.id));
    if (selected.length === 0) { alert('No posts selected.'); return; }
    const camp = actionCampaigns.find(c => c.id === addToCampaignId);
    const remaining = camp ? 20 - (camp.items_count ?? 0) : 20;
    if (selected.length > remaining) {
      alert(`That batch has room for only ${remaining} more post(s). You selected ${selected.length}. Remove some or create a new batch.`);
      return;
    }
    const customReplies = addToReplySource === 'custom'
      ? addToReplyText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];
    if (addToActionType === 'reply' && addToReplySource === 'custom' && customReplies.length === 0) {
      alert('Custom reply source picked but no reply text provided.'); return;
    }
    setAddToBusy(true);
    try {
      // Add items sequentially to keep the 20-cap consistent. (Parallel would
      // race on the server-side count check.)
      for (const p of selected) {
        await api.post(`/instagram/action-campaigns/${addToCampaignId}/items${qs}`, {
          post_url: p.post_url,
          action_type: addToActionType,
          count,
          reply_source: addToActionType === 'reply' ? addToReplySource : undefined,
          reply_texts: addToActionType === 'reply' && addToReplySource === 'custom' ? customReplies : undefined,
        });
      }
      setShowAddToCampaign(false);
      setSelectedPosts(new Set());
      setAddToReplyText('');
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to add to batch: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setAddToBusy(false); }
  }

  async function addByUrl(campaignId: string) {
    const url = byUrlInput.trim();
    if (!url) { alert('Paste an Instagram post URL.'); return; }
    const count = Math.max(1, parseInt(byUrlCount, 10) || 1);
    const customReplies = byUrlReplySource === 'custom'
      ? byUrlReplyText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];
    if (byUrlActionType === 'reply' && byUrlReplySource === 'custom' && customReplies.length === 0) {
      alert('Custom reply source picked but no reply text provided.'); return;
    }
    setByUrlBusy(true);
    try {
      await api.post(`/instagram/action-campaigns/${campaignId}/items${qs}`, {
        post_url: url,
        action_type: byUrlActionType,
        count,
        reply_source: byUrlActionType === 'reply' ? byUrlReplySource : undefined,
        reply_texts: byUrlActionType === 'reply' && byUrlReplySource === 'custom' ? customReplies : undefined,
      });
      setByUrlInput('');
      setByUrlReplyText('');
      await loadActionCampaigns();
      await loadExpandedItems(campaignId);
    } catch (e: unknown) {
      alert('Failed to add: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setByUrlBusy(false); }
  }

  async function patchItemCount(campaignId: string, itemId: string, count: number) {
    try {
      await api.patch(`/instagram/action-campaigns/${campaignId}/items/${itemId}${qs}`, {
        count_requested: Math.max(1, count),
      });
      await loadExpandedItems(campaignId);
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to update count: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // Inline editor for the reply config of a pending batch item.
  const [editingReplyItemId, setEditingReplyItemId] = useState<string | null>(null);
  const [editReplySource, setEditReplySource] = useState<'default' | 'custom' | 'ai'>('default');
  const [editReplyText, setEditReplyText] = useState('');
  function startEditReply(item: ActionItem) {
    setEditingReplyItemId(item.id);
    setEditReplySource((item.reply_source as 'default'|'custom'|'ai') || 'default');
    let texts: string[] = [];
    if (item.reply_texts) { try { texts = JSON.parse(item.reply_texts) || []; } catch (_) {} }
    setEditReplyText(texts.join('\n'));
  }
  function cancelEditReply() {
    setEditingReplyItemId(null);
    setEditReplyText('');
  }
  async function saveEditReply(campaignId: string, itemId: string) {
    const replies = editReplySource === 'custom'
      ? editReplyText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      : null;
    if (editReplySource === 'custom' && (!replies || replies.length === 0)) {
      alert('Type at least one reply (one per line) — or pick another source.'); return;
    }
    try {
      await api.patch(`/instagram/action-campaigns/${campaignId}/items/${itemId}${qs}`, {
        reply_source: editReplySource,
        reply_texts: replies,
      });
      setEditingReplyItemId(null);
      await loadExpandedItems(campaignId);
    } catch (e: unknown) {
      alert('Failed to save reply: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function removeItem(campaignId: string, itemId: string) {
    if (!confirm('Remove this post from the batch?')) return;
    try {
      await api.delete(`/instagram/action-campaigns/${campaignId}/items/${itemId}${qs}`);
      await loadExpandedItems(campaignId);
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to remove: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  // Retry a failed/partial/no_targets/cancelled queue item. Backend resets
  // status → pending, clears count_done, claimed/started/completed/heartbeat,
  // and re-opens the parent campaign if it was paused or completed. The
  // extension's next dispatch poll picks it up automatically. IG's
  // already-liked state handles dedup of comments we hit previously.
  async function retryItem(campaignId: string, itemId: string) {
    try {
      await api.post(`/instagram/action-queue/${itemId}/retry${qs}`);
      await loadExpandedItems(campaignId);
      await loadActionCampaigns();
    } catch (e: unknown) {
      const msg = e as { response?: { data?: { error?: string } } };
      alert('Failed to retry: ' + (msg.response?.data?.error || (e instanceof Error ? e.message : String(e))));
    }
  }

  async function sendCampaign(id: string) {
    try {
      await api.post(`/instagram/action-campaigns/${id}/send${qs}`);
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to send: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function patchCampaignStartAt(id: string, datetimeLocal: string) {
    try {
      await api.patch(`/instagram/action-campaigns/${id}${qs}`, {
        start_at: datetimeLocal ? new Date(datetimeLocal).toISOString() : null,
      });
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to update start time: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this batch and all its items permanently?')) return;
    try {
      await api.delete(`/instagram/action-campaigns/${id}${qs}`);
      if (expandedCampaign === id) { setExpandedCampaign(null); setExpandedItems([]); }
      await loadActionCampaigns();
    } catch (e: unknown) {
      alert('Failed to delete: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function cancelActionCampaign(id: string) {
    if (!confirm('Cancel this batch? Pending actions will be skipped; in-flight ones finish.')) return;
    await api.post(`/instagram/action-campaigns/${id}/cancel${qs}`);
    await loadActionCampaigns();
  }
  async function resumeActionCampaign(id: string) {
    await api.post(`/instagram/action-campaigns/${id}/resume${qs}`);
    await loadActionCampaigns();
  }
  async function pauseActionCampaign(id: string) {
    await api.post(`/instagram/action-campaigns/${id}/pause${qs}`);
    await loadActionCampaigns();
  }
  async function duplicateCampaign(id: string) {
    try {
      const res = await api.post(`/instagram/action-campaigns/${id}/duplicate${qs}`);
      await loadActionCampaigns();
      // Open the new draft so the user can review/edit before sending.
      const newId = res.data?.id;
      if (newId) {
        setExpandedCampaign(newId);
        loadExpandedItems(newId);
      }
    } catch (e: unknown) {
      alert('Failed to duplicate: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  useEffect(() => {
    if (tab !== 'followers') return;
    const p   = followerProfile ? `&my_profile=${encodeURIComponent(followerProfile)}` : '';
    const sep = qs ? `${qs}&` : '?';
    api.get(`/instagram/followers/changes${sep}days=${followerDays}${p}`)
      .then((r: { data: Partial<FollowerChanges> }) => setChanges({
        latest:   r.data?.latest   || null,
        baseline: r.data?.baseline || null,
        gained:   Array.isArray(r.data?.gained) ? r.data.gained : [],
        lost:     Array.isArray(r.data?.lost)   ? r.data.lost   : [],
      }))
      .catch(() => setChanges({ latest: null, baseline: null, gained: [], lost: [] }));
    api.get(`/instagram/followers/snapshots${qs}${p ? (qs ? '&' : '?') + `my_profile=${encodeURIComponent(followerProfile)}` : ''}`)
      .then((r: { data: unknown }) => setSnapshots(Array.isArray(r.data) ? r.data as Snapshot[] : []))
      .catch(() => setSnapshots([]));
  }, [tab, asUser, followerDays, followerProfile]);

  const TABS = [
    { id: 'dashboard' as Tab, label: 'Dashboard', icon: <BarChart2 size={15} /> },
    { id: 'history'   as Tab, label: 'History',   icon: <Clock size={15} /> },
    { id: 'campaigns' as Tab, label: 'Batches',   icon: <Zap size={15} /> },
    { id: 'schedule'  as Tab, label: 'Schedule',  icon: <Calendar size={15} /> },
    { id: 'followers' as Tab, label: 'Followers', icon: <UserPlus size={15} /> },
    { id: 'accounts'  as Tab, label: 'Accounts',  icon: <Contact size={15} /> },
    { id: 'research'  as Tab, label: 'Research',  icon: <Search size={15} /> },
    { id: 'automations' as Tab, label: 'Automations', icon: <RefreshCw size={15} /> },
    { id: 'dmbot'     as Tab, label: 'DM Bot',    icon: <RefreshCw size={15} /> },
    { id: 'health'    as Tab, label: 'Health',    icon: <Zap size={15} /> },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">

      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-200 px-8 pt-6 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Instagram size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Instagram Analytics</h1>
              <p className="text-sm text-gray-500">Track your automation history and performance</p>
              {serverTimeMs && serverTimeFetchedAt && (() => {
                // Server "now" approximated by (fetched server time) + (elapsed since fetch).
                const serverNow = serverTimeMs + (nowMs - serverTimeFetchedAt);
                const driftMs = nowMs - serverNow;
                const driftAbsMin = Math.round(Math.abs(driftMs) / 60000);
                const fmtT = (d: Date) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                const fmtTUtc = (d: Date) => `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
                const tzOffsetMin = -new Date().getTimezoneOffset();
                const tzLabel = (tzOffsetMin === 0 ? 'UTC' : `UTC${tzOffsetMin > 0 ? '+' : ''}${tzOffsetMin / 60}`);
                const driftLabel = driftAbsMin === 0
                  ? '✓ in sync'
                  : `Δ ${driftMs > 0 ? '+' : '−'}${driftAbsMin}m`;
                return (
                  <p className="text-[11px] text-gray-400 mt-1 font-mono">
                    Server {fmtTUtc(new Date(serverNow))} UTC · You {fmtT(new Date(nowMs))} {tzLabel} ·{' '}
                    <span className={driftAbsMin === 0 ? 'text-green-600' : driftAbsMin >= 5 ? 'text-orange-600' : 'text-gray-400'}>
                      {driftLabel}
                    </span>
                  </p>
                );
              })()}
            </div>
          </div>
          {isAdmin && adminUsers.length > 0 && (
            <div className="relative">
              <select value={asUser} onChange={e => setAsUser(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">My data</option>
                {adminUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.total_actions} actions)</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-3 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">

        {/* ══════════════════════════════ DASHBOARD ══════════════════════════════ */}
        {tab === 'dashboard' && (
          <PostReturnsDashboard asUser={asUser} refreshTick={refreshTick} onRefresh={() => setRefreshTick(t => t + 1)} />
        )}

        {/* ══════════════════════════════ HISTORY ══════════════════════════════ */}
        {tab === 'history' && (
          <div>
            {/* ── Filter panel ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              {/* Row 1 */}
              <div className="flex flex-wrap gap-3 mb-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Action</label>
                  <select value={fAction} onChange={e => setFAction(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]">
                    <option value="">All actions</option>
                    <optgroup label="Your actions">
                      <option value="like">❤️ Liked a comment</option>
                      <option value="comment_reply">💬 Replied to comment</option>
                      <option value="follow">👤 Followed someone</option>
                      <option value="unfollow">👋 Unfollowed someone</option>
                      <option value="dm_reply">✉️ DM Reply</option>
                    </optgroup>
                    <optgroup label="From notifications">
                      <option value="new_follower">➕ New Follower</option>
                      <option value="received_like_post">❤️ Got Like on post</option>
                      <option value="received_like_comment">❤️ Got Like on comment</option>
                      <option value="received_comment">💬 Got Comment</option>
                      <option value="received_reply">↩️ Got Reply</option>
                      <option value="received_mention">📣 Got Mentioned</option>
                    </optgroup>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">My Profile</label>
                  <select value={fProfile} onChange={e => setFProfile(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]">
                    <option value="">All profiles</option>
                    {profiles.map(p => <option key={p} value={p}>@{p}</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Target Username</label>
                  <input value={fUser} onChange={e => setFUser(e.target.value)}
                    placeholder="Filter by username…"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Post Owner</label>
                  <select value={fPostOwner} onChange={e => setFPostOwner(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]">
                    <option value="">All post owners</option>
                    {postOwners.map(p => <option key={p} value={p}>@{p}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2 */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Date From</label>
                  <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Date To</label>
                  <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Followers</label>
                  <div className="flex gap-2 items-center">
                    <select value={fFollowersOp} onChange={e => setFFollowersOp(e.target.value)}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Any</option>
                      <option value="gt">Greater than</option>
                      <option value="gte">Greater or equal</option>
                      <option value="lt">Less than</option>
                      <option value="lte">Less or equal</option>
                      <option value="eq">Equal to</option>
                      <option value="between">Between</option>
                    </select>
                    {fFollowersOp && (
                      <input type="number" value={fFollowersVal} onChange={e => setFFollowersVal(e.target.value)}
                        placeholder="e.g. 1000" min="0"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-28" />
                    )}
                    {fFollowersOp === 'between' && (
                      <>
                        <span className="text-sm text-gray-400">and</span>
                        <input type="number" value={fFollowersVal2} onChange={e => setFFollowersVal2(e.target.value)}
                          placeholder="e.g. 5000" min="0"
                          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-28" />
                      </>
                    )}
                  </div>
                </div>

                <button onClick={resetFilters}
                  className="px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors">
                  ✕ Reset Filters
                </button>
                <button onClick={() => setRefreshTick(t => t + 1)}
                  title="Refresh data from server"
                  className="px-4 py-2 text-sm bg-white border border-gray-200 text-gray-600 rounded-lg hover:border-blue-300 transition-colors flex items-center gap-1.5">
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>
            </div>

            {/* ── Table ── */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 1000 }}>
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">My Profile</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Action</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Target User</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Full Name</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Followers</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap" title="Country scraped from the target user's IG profile (About this account). Populates asynchronously after batches run.">Country</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Reply</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Post Owner</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">Post URL</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(a => {
                    const targetUser = displayUsername(a.username);
                    return (
                      <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                          {fmtShort(a.action_date || a.created_at)}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {a.my_profile ? `@${a.my_profile}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TYPE_COLOR[a.type] || 'bg-gray-100 text-gray-600'}`}>
                            {TYPE_LABEL[a.type] || a.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {targetUser
                            ? <a href={`https://instagram.com/${targetUser}`} target="_blank" rel="noreferrer"
                                className="text-blue-500 hover:underline">@{targetUser}</a>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{a.full_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {a.follower_count != null ? Number(a.follower_count).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs"
                          title={a.user_joined_month ? `Joined IG ${a.user_joined_month}` : ''}>
                          {a.user_country
                            ? <span>{a.user_country_code ? `${countryFlag(a.user_country_code)} ` : ''}{a.user_country}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate"
                          title={a.reply_text || a.comment_text || ''}>
                          {a.reply_text || a.comment_text || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {a.post_owner
                            ? <a href={`https://instagram.com/${a.post_owner}`} target="_blank" rel="noreferrer"
                                className="text-blue-500 hover:underline">@{a.post_owner}</a>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {a.post_url
                            ? <a href={a.post_url} target="_blank" rel="noreferrer"
                                className="text-blue-500 hover:underline whitespace-nowrap">Open ↗</a>
                            : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-16 text-center text-gray-400">
                        {actions.length === 0 ? 'No actions recorded yet. Run the extension to start tracking.' : 'No records match your filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Bottom bar: count + pagination + per-page + export ── */}
            <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
              <span className="text-sm text-gray-500">
                {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                {filtered.length > 0 && ` — showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, filtered.length)}`}
              </span>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    ‹ Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                    .reduce<(number | '…')[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) => p === '…'
                      ? <span key={`e${i}`} className="px-2 text-gray-400">…</span>
                      : <button key={p} onClick={() => setPage(p as number)}
                          className={`px-3 py-1.5 text-sm rounded-lg border ${currentPage === p ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                          {p}
                        </button>
                    )}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    Next ›
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  Rows:
                  <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white">
                    {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button onClick={() => exportCSV(filtered)}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  <Download size={14} /> Export CSV
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {tab === 'schedule' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Plus size={18} /> Schedule a post</h3>
              <div className="grid grid-cols-2 gap-4">
                <label className="text-sm">
                  <span className="text-gray-600">Media file</span>
                  <input type="file" accept="image/*,video/*" onChange={e => setNewPostFile(e.target.files?.[0] || null)}
                    className="block w-full mt-1 text-sm" />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">Post type</span>
                  <select value={newPostType} onChange={e => setNewPostType(e.target.value as 'post' | 'story' | 'reel')}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm">
                    <option value="post">Post</option>
                    <option value="story">Story</option>
                    <option value="reel">Reel</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">Publish at</span>
                  <input type="datetime-local" value={newPostWhen} onChange={e => setNewPostWhen(e.target.value)}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">Instagram account</span>
                  {igAccounts.length > 0 ? (
                    <select value={newPostProfile} onChange={e => setNewPostProfile(e.target.value)}
                      className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm">
                      <option value="">— Any / current —</option>
                      {igAccounts.map(a => <option key={a} value={a}>@{a}</option>)}
                    </select>
                  ) : (
                    <input type="text" placeholder="@myhandle (scan accounts in the extension to enable dropdown)" value={newPostProfile}
                      onChange={e => setNewPostProfile(e.target.value)}
                      className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                  )}
                </label>
                <label className="text-sm col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Caption</span>
                    <button type="button" onClick={() => setShowAIPanel(s => !s)}
                      className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium">
                      ✨ {showAIPanel ? 'Hide AI' : 'Generate with AI'}
                    </button>
                  </div>
                  {showAIPanel && (
                    <div className="mt-2 mb-2 p-3 border border-purple-100 rounded-lg bg-purple-50/40">
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Topic / what's the post about</label>
                          <textarea rows={2} value={aiTopic} onChange={e => setAiTopic(e.target.value)}
                            placeholder="e.g. our new spring collection launch"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Notes / additional context</label>
                          <textarea rows={2} value={aiComments} onChange={e => setAiComments(e.target.value)}
                            placeholder="e.g. mention free shipping, ask a question"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white" />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <div className="flex items-center gap-1">
                          <label className="text-xs text-gray-500">Tone:</label>
                          <select value={aiTone} onChange={e => setAiTone(e.target.value as 'friendly'|'professional'|'funny'|'inspirational')}
                            className="border border-gray-200 rounded px-2 py-1 text-xs bg-white">
                            <option value="friendly">Friendly</option>
                            <option value="professional">Professional</option>
                            <option value="funny">Funny</option>
                            <option value="inspirational">Inspirational</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-1 text-xs text-gray-700">
                          <input type="checkbox" checked={aiHashtags} onChange={e => setAiHashtags(e.target.checked)} />
                          Include hashtags
                        </label>
                        <button type="button" onClick={generateAICaption} disabled={aiBusy}
                          className="ml-auto px-3 py-1 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-50">
                          {aiBusy ? 'Generating…' : '✨ Generate'}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        {newPostFile && newPostFile.type.startsWith('image/') && newPostFile.size <= 4 * 1024 * 1024
                          ? '🖼 Vision model — caption will be based on the image you uploaded.'
                          : newPostFile && newPostFile.type.startsWith('video/')
                          ? '🎥 Video file — AI uses your topic/notes only (Groq can\'t analyze video frames).'
                          : newPostFile
                          ? 'File too large for vision (over 4MB) — AI uses your topic/notes only.'
                          : 'No file uploaded — AI uses your topic/notes only.'}
                      </p>
                    </div>
                  )}
                  <textarea rows={3} value={newPostCaption} onChange={e => setNewPostCaption(e.target.value)}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                </label>
              </div>
              <button onClick={createScheduledPost} disabled={creatingPost}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {creatingPost ? 'Scheduling…' : 'Schedule post'}
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Scheduled for</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Account</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Caption</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600"></th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmt(p.scheduled_at)}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 capitalize">{p.post_type}</span></td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{p.my_profile ? `@${p.my_profile}` : '—'}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[300px] truncate" title={p.caption || ''}>{p.caption || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.status === 'posted'    ? 'bg-green-100 text-green-700' :
                          p.status === 'failed'    ? 'bg-red-100 text-red-700' :
                          p.status === 'claimed'   ? 'bg-yellow-100 text-yellow-700' :
                                                     'bg-blue-100 text-blue-700'
                        }`}>{p.status}</span>
                        {p.error_message && <div className="text-xs text-red-500 mt-1" title={p.error_message}>⚠ {p.error_message.slice(0, 60)}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {!['posted', 'claimed'].includes(p.status) && (
                          <div className="flex gap-2">
                            <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-blue-500" title="Edit"><Pencil size={16} /></button>
                            <button onClick={() => deleteScheduled(p.id)} className="text-gray-400 hover:text-red-500" title="Delete"><Trash2 size={16} /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {scheduled.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No scheduled posts. Add one above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── FOLLOWERS ── */}
        {tab === 'followers' && (
          <div className="space-y-6">
            <div className="flex gap-3 items-center">
              <input type="text" placeholder="Filter by @profile (optional)" value={followerProfile}
                onChange={e => setFollowerProfile(e.target.value.replace(/^@/, ''))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 max-w-xs" />
              <div className="flex gap-2">
                {[7, 30, 90].map(d => (
                  <button key={d} onClick={() => setFollowerDays(d)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${followerDays === d ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {changes?.latest ? (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 rounded-xl p-5">
                    <div className="text-3xl font-bold text-blue-600">{changes.latest.follower_count}</div>
                    <div className="text-sm text-gray-600 mt-1">Current followers</div>
                  </div>
                  <div className="bg-green-50 rounded-xl p-5">
                    <div className="text-3xl font-bold text-green-600">+{changes.gained.length}</div>
                    <div className="text-sm text-gray-600 mt-1">Gained (last {followerDays}d)</div>
                  </div>
                  <div className="bg-red-50 rounded-xl p-5">
                    <div className="text-3xl font-bold text-red-600">−{changes.lost.length}</div>
                    <div className="text-sm text-gray-600 mt-1">Lost (last {followerDays}d)</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-green-700 mb-3">➕ Gained</h3>
                    <div className="space-y-1 max-h-80 overflow-auto">
                      {changes.gained.length === 0 && <p className="text-gray-400 text-sm">No new followers in this period.</p>}
                      {changes.gained.map(u => (
                        <a key={u} href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer"
                          className="block text-sm text-blue-600 hover:underline">@{u}</a>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-red-700 mb-3">➖ Lost</h3>
                    <div className="space-y-1 max-h-80 overflow-auto">
                      {changes.lost.length === 0 && <p className="text-gray-400 text-sm">No unfollows in this period.</p>}
                      {changes.lost.map(u => (
                        <a key={u} href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer"
                          className="block text-sm text-blue-600 hover:underline">@{u}</a>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <UserPlus size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400">No follower snapshots yet. Open the extension on instagram.com and click "Snapshot followers" to start tracking.</p>
              </div>
            )}

            {snapshots.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Snapshot history</h3>
                <div className="space-y-1 text-sm">
                  {snapshots.map(s => (
                    <div key={s.id} className="flex justify-between text-gray-600">
                      <span>{fmt(s.captured_at)} {s.my_profile && `· @${s.my_profile}`}</span>
                      <span className="font-semibold">{s.follower_count} followers</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Daily follower count history (auto-scraped by the extension) ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">Daily follower history</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Latest snapshot per day shown — manual "Refresh now" captures extra intraday points without cluttering the chart.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={triggerFollowerCountNow} disabled={followerRefreshBusy}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                    <RefreshCw size={12} /> {followerRefreshBusy ? 'Triggering…' : 'Refresh now'}
                  </button>
                  <select value={followerCountProfile} onChange={e => setFollowerCountProfile(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">All profiles</option>
                    {igAccounts.map(u => <option key={u} value={u}>@{u}</option>)}
                  </select>
                  <div className="flex gap-1">
                    <button onClick={() => setFollowerCountAgg('day')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium ${followerCountAgg === 'day' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                      Daily
                    </button>
                    <button onClick={() => setFollowerCountAgg('month')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium ${followerCountAgg === 'month' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                      Monthly
                    </button>
                  </div>
                </div>
              </div>
              {followerRefreshNote && (
                <div className="mb-3 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  {followerRefreshNote}
                </div>
              )}
              <p className="text-xs text-gray-500 mb-3">
                The extension opens each of your profiles in a background tab once a day and records the follower count from Instagram's public profile page. Make sure <b>Automation</b> is enabled in the extension popup.
              </p>
              {followerCountSeries.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No follower counts recorded yet. The extension scrapes once every 24h — first counts appear after the first run.</p>
              ) : (
                <div className="space-y-4">
                  {followerCountSeries.map(series => (
                    <div key={series.my_profile} className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                        <a href={`https://instagram.com/${series.my_profile}`} target="_blank" rel="noreferrer"
                          className="text-sm font-medium text-blue-600 hover:underline">@{series.my_profile}</a>
                        <span className="text-sm text-gray-600">
                          Latest: <b className="text-gray-900">{(series.points[0]?.follower_count ?? 0).toLocaleString()}</b> followers
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 bg-white">
                            <th className="py-1.5 px-3 font-medium">{followerCountAgg === 'month' ? 'Month' : 'Date'}</th>
                            <th className="py-1.5 px-3 font-medium text-right">Followers</th>
                            <th className="py-1.5 px-3 font-medium text-right">Δ from previous</th>
                          </tr>
                        </thead>
                        <tbody>
                          {series.points.map(pt => (
                            <tr key={pt.bucket} className="border-t border-gray-100">
                              <td className="py-1.5 px-3 text-gray-600 text-xs">{pt.bucket}</td>
                              <td className="py-1.5 px-3 text-right">{pt.follower_count.toLocaleString()}</td>
                              <td className={`py-1.5 px-3 text-right text-xs ${
                                pt.delta == null ? 'text-gray-400'
                                : pt.delta > 0 ? 'text-green-600'
                                : pt.delta < 0 ? 'text-red-600'
                                : 'text-gray-500'
                              }`}>
                                {pt.delta == null ? '—' : pt.delta > 0 ? `+${pt.delta.toLocaleString()}` : pt.delta.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ ACCOUNTS ══════════════════════════════ */}
        {tab === 'accounts' && (
          <div className="space-y-4 max-w-2xl">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Plus size={18} /> Add an Instagram account</h3>
              <p className="text-sm text-gray-500 mb-3">
                Add the @handle of any Instagram account you manage. Or run <b>Scan accounts</b> from the extension popup on instagram.com to import all accounts logged into your browser at once.
              </p>
              <div className="flex gap-2">
                <input type="text" placeholder="@username" value={newAccount} onChange={e => setNewAccount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addAccount(); }}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <button onClick={addAccount}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Add</button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Your accounts <span className="text-gray-400 font-normal">({igAccounts.length})</span></h3>
                <button onClick={loadAccounts} className="text-gray-400 hover:text-gray-600" title="Refresh from server">
                  <RefreshCw size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                Accounts are validated when scanned — UI labels like "Close" or "Cancel" are rejected. If you see something that shouldn't be here, use the trash icon to remove it.
              </p>
              {igAccounts.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No accounts yet. Add one above or scan from the extension.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {igAccounts.map(u => (
                    <div key={u} className="flex items-center justify-between py-2.5">
                      <a href={`https://instagram.com/${u}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">@{u}</a>
                      <button onClick={() => removeAccount(u)} className="text-gray-400 hover:text-red-500" title="Remove"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── AI providers ─── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Zap size={18} /> AI providers
                {aiProviders.length > 0 && (
                  <span className="text-xs text-gray-400 font-normal">({aiProviders.length} configured)</span>
                )}
              </h3>
              <p className="text-sm text-gray-500 mb-3">
                Add an API key from any supported provider so the system can generate AI replies for your batches. Free tiers available on Groq, Gemini, and Z.AI.
              </p>
              <div className="flex flex-wrap gap-2 items-end mb-2">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Provider</label>
                  <select value={aiAddProvider} onChange={e => setAiAddProvider(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    {aiCatalog.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.display}{p.free_tier ? ' (has free tier)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-[2] min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">API key</label>
                  <input type="password" placeholder="sk-... / gsk_... / pplx-..." value={aiAddKey}
                    onChange={e => setAiAddKey(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div className="w-44">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Model <span className="text-gray-400">(optional)</span>
                  </label>
                  <input type="text" placeholder={aiCatalog.find(p => p.id === aiAddProvider)?.default_model || ''}
                    value={aiAddModel} onChange={e => setAiAddModel(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <button onClick={addAiProvider} disabled={aiKeyBusy || !aiAddKey}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {aiKeyBusy ? 'Testing…' : 'Test + Save'}
                </button>
              </div>
              {(() => {
                const cur = aiCatalog.find(p => p.id === aiAddProvider);
                return cur ? (
                  <p className="text-xs text-gray-400 mb-2">
                    Default model: <code className="bg-gray-100 px-1 rounded">{cur.default_model}</code>
                    {' · '}
                    <a href={cur.docs_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Get a key</a>
                  </p>
                ) : null;
              })()}
              {aiTestStatus && (
                <p className={`text-xs mt-1 ${aiTestStatus.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                  {aiTestStatus.kind === 'ok' ? '✓ ' : '✗ '}{aiTestStatus.msg}
                </p>
              )}

              {aiProviders.length > 0 && (
                <div className="mt-4 divide-y divide-gray-100">
                  {aiProviders.map(p => {
                    const cat = aiCatalog.find(c => c.id === p.provider);
                    return (
                      <div key={p.provider} className="flex items-center justify-between py-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{cat?.display || p.provider}</span>
                            {p.is_default && (
                              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">default</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 font-mono">
                            {p.api_key_masked} · model: {p.model || cat?.default_model || '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!p.is_default && (
                            <button onClick={() => setDefaultAiProvider(p.provider)}
                              className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded">
                              Set default
                            </button>
                          )}
                          <button onClick={() => removeAiProvider(p.provider)}
                            className="text-gray-400 hover:text-red-500" title="Remove">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ RESEARCH ══════════════════════════════ */}
        {tab === 'research' && !viewingUser && (
          <div className="space-y-4 max-w-4xl">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Search size={18} /> Scrape a profile</h3>
              <p className="text-sm text-gray-500 mb-4">
                Enter any public Instagram username — the extension will open the profile, scrape the first N posts (likes / views and comments), and save the data here.
                The extension must be installed on at least one device with <b>Automation</b> enabled.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                  <input type="text" placeholder="elizabethvasilenko" value={scrapeTarget}
                    onChange={e => setScrapeTarget(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') createScrapeJob(); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Posts</label>
                  <input type="number" min={1} max={200} value={scrapeCount}
                    onChange={e => setScrapeCount(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={createScrapeJob} disabled={scrapeBusy}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {scrapeBusy ? 'Queuing…' : 'Queue scrape'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Scrape jobs <span className="text-gray-400 font-normal">({scrapeJobs.length})</span></h3>
                <div className="flex items-center gap-2">
                  {scrapeJobs.some(j => j.status === 'failed') && (
                    <button onClick={() => clearScrapeJobs(true)}
                      className="px-2 py-1 text-xs text-orange-600 hover:bg-orange-50 rounded border border-orange-200">
                      Clear failed
                    </button>
                  )}
                  {scrapeJobs.length > 0 && (
                    <button onClick={() => clearScrapeJobs(false)}
                      className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200">
                      Clear all
                    </button>
                  )}
                  <button onClick={loadResearch} className="text-gray-400 hover:text-gray-600" title="Refresh">
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>
              {scrapeJobs.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No scrape jobs yet. Queue one above.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-3 font-medium">Username</th>
                        <th className="py-2 pr-3 font-medium">Requested</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Scraped</th>
                        <th className="py-2 pr-3 font-medium">Created</th>
                        <th className="py-2 pr-3 font-medium w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapeJobs.map(j => (
                        <tr key={j.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-3 font-medium text-blue-600">@{j.target_username}</td>
                          <td className="py-2 pr-3 text-gray-600">{j.post_count}</td>
                          <td className="py-2 pr-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              j.status === 'completed' ? 'bg-green-100 text-green-700' :
                              j.status === 'running'   ? 'bg-blue-100 text-blue-700'   :
                              j.status === 'failed'    ? 'bg-red-100 text-red-700'     :
                                                         'bg-gray-100 text-gray-600'
                            }`}>{j.status}</span>
                            {j.status === 'failed' && j.error_message && (
                              <span className="block text-xs text-red-600 mt-0.5">{j.error_message}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-gray-600">{j.posts_scraped || 0}</td>
                          <td className="py-2 pr-3 text-gray-500 text-xs">{fmt(j.created_at)}</td>
                          <td className="py-2 pr-3 text-right">
                            <button onClick={() => deleteScrapeJob(j.id)}
                              className="text-gray-300 hover:text-red-500" title="Delete this scrape job">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Scraped profiles <span className="text-gray-400 font-normal">({scrapedSummary.length})</span></h3>
                {scrapedSummary.length > 0 && (
                  <button onClick={clearAllScrapedProfiles}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-red-200">
                    Clear all
                  </button>
                )}
              </div>
              {scrapedSummary.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No data yet. Queue a scrape job above.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {scrapedSummary.map(s => (
                    <div key={s.target_username} className="flex items-center justify-between py-2.5 hover:bg-gray-50 px-2 rounded group">
                      <button onClick={() => openScrapedUser(s.target_username)}
                        className="flex-1 flex items-center justify-between text-left">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-blue-600">@{s.target_username}</span>
                          <span className="text-xs text-gray-400">{s.post_count} posts</span>
                        </div>
                        <span className="text-xs text-gray-500 mr-3">Last scraped {fmt(s.last_scraped_at)}</span>
                      </button>
                      <button onClick={() => deleteScrapedProfile(s.target_username)}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition" title={`Delete scraped data for @${s.target_username}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'research' && viewingUser && (
          <div className="space-y-4 max-w-5xl">
            <div className="flex items-center justify-between">
              <button onClick={() => { setViewingUser(null); setViewingPosts([]); }}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
                <ArrowLeft size={16} /> Back to research
              </button>
              <a href={`https://instagram.com/${viewingUser}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
                @{viewingUser} <ExternalLink size={12} />
              </a>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Posts <span className="text-gray-400 font-normal">({viewingPosts.length})</span></h3>
                {selectedPosts.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">{selectedPosts.size} selected</span>
                    <button onClick={() => setSelectedPosts(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
                    <button onClick={openAddToCampaign}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                      Add to batch
                    </button>
                  </div>
                )}
              </div>
              {viewingPosts.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No posts found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-3 font-medium w-8">
                          <input type="checkbox"
                            checked={selectedPosts.size === viewingPosts.length && viewingPosts.length > 0}
                            onChange={(e) => setSelectedPosts(e.target.checked ? new Set(viewingPosts.map(p => p.id)) : new Set())}
                          />
                        </th>
                        <th className="py-2 pr-3 font-medium">Post</th>
                        <th className="py-2 pr-3 font-medium">Type</th>
                        <th className="py-2 pr-3 font-medium text-right">Likes</th>
                        <th className="py-2 pr-3 font-medium text-right">Views</th>
                        <th className="py-2 pr-3 font-medium text-right">Comments</th>
                        <th className="py-2 pr-3 font-medium">Last scraped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingPosts.map(p => (
                        <tr key={p.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-3">
                            <input type="checkbox"
                              checked={selectedPosts.has(p.id)}
                              onChange={() => togglePostSelection(p.id)}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <a href={p.post_url} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1">
                              {p.shortcode} <ExternalLink size={12} />
                            </a>
                          </td>
                          <td className="py-2 pr-3 text-gray-600 capitalize">{p.post_type}</td>
                          <td className="py-2 pr-3 text-right">{p.likes != null ? p.likes.toLocaleString() : '—'}</td>
                          <td className="py-2 pr-3 text-right">{p.views != null ? p.views.toLocaleString() : '—'}</td>
                          <td className="py-2 pr-3 text-right">{p.comments != null ? p.comments.toLocaleString() : '—'}</td>
                          <td className="py-2 pr-3 text-gray-500 text-xs">{fmt(p.last_scraped_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ AUTOMATIONS ══════════════════════════════ */}
        {tab === 'automations' && (
          <div className="space-y-4 max-w-6xl">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2"><RefreshCw size={18} /> Cronjobs &amp; Automations</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Recurring jobs the extension runs automatically. Built-in per-account tasks (📌) are auto-created when you add an account; you can edit their time or disable them, but remove the account to delete them.</p>
                </div>
                <button onClick={openNewAutomation}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
                  <Plus size={14} /> New automation
                </button>
              </div>

              {/* Filter bar */}
              {automations.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                  <span className="text-gray-500">Filter:</span>
                  <div className="flex gap-1">
                    {(['all','system','user'] as const).map(k => (
                      <button key={k} onClick={() => setAutoFilterKind(k)}
                        className={`px-2.5 py-1 rounded-full font-medium ${autoFilterKind === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                        {k === 'all' ? 'All' : k === 'system' ? '📌 Built-in' : 'User-defined'}
                      </button>
                    ))}
                  </div>
                  <select value={autoFilterAccount} onChange={e => setAutoFilterAccount(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 bg-white">
                    <option value="">All accounts</option>
                    {igAccounts.map(u => <option key={u} value={u}>@{u}</option>)}
                  </select>
                </div>
              )}

              {(() => {
                const filtered = automations.filter(a => {
                  if (autoFilterKind === 'system' && !a.is_system) return false;
                  if (autoFilterKind === 'user' && a.is_system) return false;
                  if (autoFilterAccount && !a.accounts.includes(autoFilterAccount)) return false;
                  return true;
                });
                return automations.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">No automations yet. Click <b>+ New automation</b> to set up a recurring job.</p>
              ) : filtered.length === 0 ? (
                <p className="text-gray-400 text-sm py-8 text-center">No automations match this filter.</p>
              ) : (
                <div className="space-y-2">
                  {filtered.map(a => {
                    const statusPill =
                      !a.enabled                   ? 'bg-gray-100 text-gray-600' :
                      a.last_status === 'failed'   ? 'bg-red-100 text-red-700'   :
                      (a.next_run_at && new Date(a.next_run_at).getTime() < Date.now() - 5 * 60 * 1000)
                                                   ? 'bg-yellow-100 text-yellow-700' :
                      a.last_status === 'ok'       ? 'bg-green-100 text-green-700'  :
                                                     'bg-blue-100 text-blue-700';
                    const statusLabel =
                      !a.enabled                   ? 'Disabled' :
                      a.last_status === 'failed'   ? 'Failed' :
                      (a.next_run_at && new Date(a.next_run_at).getTime() < Date.now() - 5 * 60 * 1000)
                                                   ? 'Late' :
                      a.last_status === 'ok'       ? 'Working' :
                                                     'Scheduled';
                    return (
                      <div key={a.id} className="border border-gray-100 rounded-lg p-3 hover:border-blue-200 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {a.is_system && <span title="Built-in per-account task — disable or remove the account to stop it">📌</span>}
                              <span className="font-medium text-gray-900 text-sm">{a.name}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${statusPill}`}>{statusLabel}</span>
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                              <span>📅 {describeSchedule(a)}</span>
                              <span>👤 {a.accounts.length} account{a.accounts.length === 1 ? '' : 's'}</span>
                              <span>⚙️ {a.actions.map(act => AUTOMATION_ACTION_LABELS[act] || act).join(', ')}</span>
                              {a.next_run_at && <span>Next: {fmt(a.next_run_at)}</span>}
                              {a.last_run_at && <span>Last: {fmt(a.last_run_at)}</span>}
                            </div>
                            {a.last_error && a.last_status === 'failed' && (
                              <p className="text-xs text-red-600 mt-1.5">⚠ {a.last_error}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => runAutomationNow(a.id)}
                              className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-medium">
                              Run now
                            </button>
                            <button onClick={() => toggleAutomation(a)}
                              className={`text-xs px-2 py-1 rounded font-medium ${a.enabled ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-green-100 hover:bg-green-200 text-green-700'}`}>
                              {a.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button onClick={() => openEditAutomation(a)}
                              className="text-gray-400 hover:text-gray-700 p-1" title="Edit">
                              <Pencil size={14} />
                            </button>
                            {!a.is_system && (
                              <button onClick={() => deleteAutomation(a.id)}
                                className="text-gray-400 hover:text-red-500 p-1" title="Delete">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
              })()}
            </div>
          </div>
        )}

        {/* ══ Automation create/edit modal ══ */}
        {showAutomationModal && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setShowAutomationModal(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{editingAutomation ? 'Edit automation' : 'New automation'}</h3>
                <button onClick={() => setShowAutomationModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input type="text" value={aForm.name} onChange={e => setAForm({ ...aForm, name: e.target.value })}
                  placeholder="e.g. Daily follower scan"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Schedule</label>
                <div className="flex gap-2 mb-2">
                  {(['daily','weekly','interval'] as const).map(t => (
                    <button key={t} onClick={() => setAForm({ ...aForm, schedule_type: t })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                        aForm.schedule_type === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}>
                      {t === 'daily' ? 'Daily' : t === 'weekly' ? 'Weekly' : 'Interval'}
                    </button>
                  ))}
                </div>
                {aForm.schedule_type === 'daily' && (
                  <input type="time" value={aForm.schedule_time}
                    onChange={e => setAForm({ ...aForm, schedule_time: e.target.value })}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                )}
                {aForm.schedule_type === 'weekly' && (
                  <>
                    <div className="flex gap-1 mb-2">
                      {DAY_NAMES.map((d, i) => (
                        <button key={i} onClick={() => {
                          const has = aForm.schedule_days.includes(i);
                          const next = has ? aForm.schedule_days.filter(x => x !== i) : [...aForm.schedule_days, i].sort();
                          setAForm({ ...aForm, schedule_days: next });
                        }}
                          className={`w-10 h-8 rounded text-xs font-medium ${
                            aForm.schedule_days.includes(i) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <input type="time" value={aForm.schedule_time}
                      onChange={e => setAForm({ ...aForm, schedule_time: e.target.value })}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  </>
                )}
                {aForm.schedule_type === 'interval' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Every</span>
                    <input type="number" min={1} max={1440} value={aForm.schedule_interval_minutes}
                      onChange={e => setAForm({ ...aForm, schedule_interval_minutes: e.target.value })}
                      className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    <span className="text-sm text-gray-600">minutes</span>
                  </div>
                )}
                {/* Time-conversion preview: confirms the job is set in YOUR
                    time and shows the UTC equivalent for transparency. */}
                {aForm.schedule_type !== 'interval' && aForm.schedule_time && (() => {
                  const [hh, mm] = aForm.schedule_time.split(':').map((n: string) => parseInt(n, 10));
                  if (!Number.isFinite(hh)) return null;
                  const offsetMin = -new Date().getTimezoneOffset();
                  let utcMin = (hh * 60 + (mm || 0)) - offsetMin;
                  utcMin = ((utcMin % 1440) + 1440) % 1440;
                  const utcHH = String(Math.floor(utcMin / 60)).padStart(2, '0');
                  const utcMM = String(utcMin % 60).padStart(2, '0');
                  const tzLbl = offsetMin === 0 ? 'UTC' : `UTC${offsetMin > 0 ? '+' : ''}${offsetMin / 60}`;
                  return (
                    <p className="text-xs text-gray-500 mt-2">
                      ⏰ Runs at <b>{aForm.schedule_time}</b> your time ({tzLbl})
                      {' · '}<span className="text-gray-400">{utcHH}:{utcMM} UTC on the server</span>
                    </p>
                  );
                })()}
              </div>

              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Actions to run</label>
                <div className="space-y-1">
                  {Object.entries(AUTOMATION_ACTION_LABELS).map(([key, label]) => {
                    const checked = aForm.actions.includes(key);
                    const isSoon = label.includes('coming soon');
                    return (
                      <label key={key} className={`flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm ${isSoon ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={checked} disabled={isSoon}
                          onChange={() => {
                            if (isSoon) return;
                            setAForm({
                              ...aForm,
                              actions: checked ? aForm.actions.filter(a => a !== key) : [...aForm.actions, key],
                            });
                          }} />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">Instagram accounts ({aForm.accounts.length} selected)</label>
                <div className="border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto">
                  {igAccounts.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2 text-center">No Instagram accounts configured. Add them in the Accounts tab first.</p>
                  ) : igAccounts.map(u => {
                    const checked = aForm.accounts.includes(u);
                    return (
                      <label key={u} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 rounded cursor-pointer text-sm">
                        <input type="checkbox" checked={checked}
                          onChange={() => setAForm({
                            ...aForm,
                            accounts: checked ? aForm.accounts.filter(a => a !== u) : [...aForm.accounts, u],
                          })} />
                        @{u}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAutomationModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
                <button onClick={submitAutomation} disabled={aSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {aSaving ? 'Saving…' : (editingAutomation ? 'Save changes' : 'Create automation')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════ HEALTH ══════════════════════════════ */}
        {tab === 'dmbot' && <DmBotSettings asUser={asUser} />}

        {tab === 'health' && (
          <div className="space-y-4 max-w-6xl">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Zap size={18} /> System Health</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Quick view of every Instagram feature. Click a card for the underlying page.</p>
                </div>
                <div className="flex items-center gap-2">
                  {health?.generated_at && (
                    <span className="text-xs text-gray-400">Updated {fmt(health.generated_at)}</span>
                  )}
                  <button onClick={loadHealth} disabled={healthBusy}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-1">
                    <RefreshCw size={12} /> {healthBusy ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>

              {!health ? (
                <p className="text-gray-400 text-sm py-6 text-center">Loading health data…</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(() => {
                    const pillFor = (s: string) =>
                      s === 'ok'      ? 'bg-green-100 text-green-700' :
                      s === 'late'    ? 'bg-yellow-100 text-yellow-700' :
                      s === 'failing' ? 'bg-red-100 text-red-700' :
                                        'bg-gray-100 text-gray-500';
                    const dotFor = (s: string) =>
                      s === 'ok'      ? 'bg-green-500' :
                      s === 'late'    ? 'bg-yellow-500' :
                      s === 'failing' ? 'bg-red-500' :
                                        'bg-gray-400';
                    const Card = ({ title, status, primary, secondary, onClick, jumpTab }: {
                      title: string; status: string; primary: string; secondary?: string;
                      onClick?: () => void; jumpTab?: Tab;
                    }) => (
                      <div onClick={onClick || (jumpTab ? () => setTab(jumpTab) : undefined)}
                        className={`bg-white border border-gray-200 rounded-xl p-4 ${onClick || jumpTab ? 'cursor-pointer hover:border-blue-300 hover:shadow-sm' : ''} transition-all`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${dotFor(status)}`} />
                            {title}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${pillFor(status)}`}>
                            {status}
                          </span>
                        </div>
                        <div className="text-xl font-bold text-gray-900">{primary}</div>
                        {secondary && <div className="text-xs text-gray-500 mt-1">{secondary}</div>}
                      </div>
                    );
                    const fc = health.follower_counts;
                    const sp = health.scheduled_posts;
                    const ab = health.action_batches;
                    const sj = health.scrape_jobs;
                    const ea = health.extension_activity;
                    const pp = health.permissions;
                    const ac = health.accounts;
                    const sumStatuses = (obj: Record<string, number>) => Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(' · ') || 'none';
                    return (
                      <>
                        <Card
                          title="Daily follower counts"
                          status={fc.status}
                          primary={`${fc.profiles_tracked} profile${fc.profiles_tracked === 1 ? '' : 's'}`}
                          secondary={fc.last_capture_at ? `Last captured ${fmt(fc.last_capture_at)}` : 'No data yet'}
                          jumpTab="followers"
                        />
                        <Card
                          title="Scheduled posts"
                          status={sp.status}
                          primary={sp.overdue > 0 ? `${sp.overdue} overdue` : `${(sp.by_status.scheduled || 0)} pending`}
                          secondary={sumStatuses(sp.by_status)}
                          jumpTab="schedule"
                        />
                        <Card
                          title="Action Batches"
                          status={ab.status}
                          primary={`${(ab.by_status.running || 0)} running · ${(ab.by_status.pending || 0)} pending`}
                          secondary={ab.stalled_running > 0 ? `⚠️ ${ab.stalled_running} stuck >1h` : sumStatuses(ab.by_status)}
                          jumpTab="campaigns"
                        />
                        <Card
                          title="Scrape jobs"
                          status={sj.status}
                          primary={`${(sj.by_status.completed || 0)} completed`}
                          secondary={sj.stalled_running > 0 ? `⚠️ ${sj.stalled_running} stuck` : sumStatuses(sj.by_status)}
                          jumpTab="research"
                        />
                        <Card
                          title="Extension activity"
                          status={ea.status}
                          primary={`${ea.actions_last_24h} actions / 24h`}
                          secondary={ea.last_action_at ? `Last action ${fmt(ea.last_action_at)}` : 'No activity recorded'}
                          jumpTab="history"
                        />
                        <Card
                          title="Instagram accounts"
                          status={ac.status}
                          primary={`${ac.count} configured`}
                          secondary={ac.count > 0 ? 'Synced from the extension' : 'Scan accounts in the popup'}
                          jumpTab="accounts"
                        />
                        <Card
                          title="Your permissions"
                          status={pp.status}
                          primary={`${pp.tabs_allowed} of ${pp.total_tabs} tabs`}
                          secondary={`Role: ${pp.role}`}
                        />
                        {health.automations && (
                          <Card
                            title="Automations"
                            status={health.automations.status}
                            primary={`${health.automations.enabled} active · ${health.automations.total} total`}
                            secondary={
                              health.automations.last_run_at
                                ? `Last fired ${fmt(health.automations.last_run_at)}${health.automations.last_status ? ` (${health.automations.last_status})` : ''}`
                                : (health.automations.total === 0
                                    ? 'No automations yet'
                                    : 'Never fired')
                            }
                            jumpTab="automations"
                          />
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ Create campaign modal ══ */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setShowCreateModal(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">New batch</h3>
                <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                The batch starts as a draft. Add up to 20 posts (from Research or by URL), then click <b>Send</b> to start it.
              </p>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Instagram account</label>
                <select value={createAccount} onChange={e => setCreateAccount(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— pick one —</option>
                  {igAccounts.map(u => <option key={u} value={u}>@{u}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Free text (appended to the auto-generated name)</label>
                <input type="text" value={createFreeText} onChange={e => setCreateFreeText(e.target.value)}
                  placeholder="e.g. fashion influencers"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">
                  Name will be: <code className="bg-gray-100 px-1 rounded">@{createAccount || 'account'} {new Date().toLocaleDateString()} {new Date().toLocaleTimeString().slice(0,5)}{createFreeText ? ` — ${createFreeText}` : ''}</code>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Concurrency (1–6)</label>
                  <input type="number" min={1} max={6} value={createConcurrency}
                    onChange={e => setCreateConcurrency(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Start at <span className="text-gray-400">(empty = ASAP after Send)</span></label>
                  <input type="datetime-local" value={createStartAt}
                    onChange={e => setCreateStartAt(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
                <button onClick={createCampaign} disabled={createBusy}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {createBusy ? 'Creating…' : 'Create draft'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ Add-to-campaign modal (from Research) ══ */}
        {showAddToCampaign && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setShowAddToCampaign(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add to batch</h3>
                <button onClick={() => setShowAddToCampaign(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Adding <b>{selectedPosts.size}</b> post{selectedPosts.size === 1 ? '' : 's'} to a batch. Each batch holds up to 20 posts total.
              </p>
              {actionCampaigns.filter(c => c.status !== 'completed' && c.status !== 'cancelled' && (c.items_count ?? 0) < 20).length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                  No batches available. <button className="underline" onClick={() => { setShowAddToCampaign(false); setShowCreateModal(true); }}>Create one first</button>.
                </p>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Batch</label>
                    <select value={addToCampaignId} onChange={e => setAddToCampaignId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">— pick a batch —</option>
                      {actionCampaigns
                        .filter(c => c.status !== 'completed' && c.status !== 'cancelled' && (c.items_count ?? 0) < 20)
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {c.status} ({c.items_count ?? 0}/20, room for {20 - (c.items_count ?? 0)})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Action type</label>
                      <select value={addToActionType} onChange={e => setAddToActionType(e.target.value as 'like'|'reply')}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                        <option value="like">Like comments</option>
                        <option value="reply">Reply to comments</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Count per post</label>
                      <input type="number" min={1} max={100} value={addToCount}
                        onChange={e => setAddToCount(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                  {addToActionType === 'reply' && (
                    <>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Reply text source</label>
                        <select value={addToReplySource} onChange={e => setAddToReplySource(e.target.value as 'default'|'custom'|'ai')}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <option value="default">Built-in defaults</option>
                          <option value="custom">Custom text</option>
                          {hasAiKey && <option value="ai">AI (your default provider)</option>}
                        </select>
                        {!hasAiKey && (
                          <p className="text-xs text-gray-400 mt-1">Want AI-generated replies? Add a provider key in <button type="button" onClick={() => setTab('accounts')} className="underline text-blue-500">Accounts → AI providers</button>.</p>
                        )}
                      </div>
                      {addToReplySource === 'custom' && (
                        <div className="mb-3">
                          <textarea value={addToReplyText} onChange={e => setAddToReplyText(e.target.value)}
                            placeholder="Amazing! 🔥&#10;Love this 😍"
                            rows={3}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="flex gap-2 justify-end mt-2">
                <button onClick={() => setShowAddToCampaign(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
                <button onClick={submitAddToCampaign} disabled={addToBusy || !addToCampaignId}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {addToBusy ? 'Adding…' : 'Add to batch'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════ CAMPAIGNS ══════════════════════════════ */}
        {tab === 'campaigns' && (
          <div className="space-y-3">

            {/* ─── Quick Batch (mobile-first) ───────────────────────────────
                One-tap create+add+send. Collapsed by default — tap header to
                expand. Layout uses single column on mobile, generous touch
                targets, and a textarea that accepts pasted post URLs in any
                format. */}
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl border border-blue-200 mb-4 overflow-hidden">
              <button onClick={() => { if (!quickAccount) setQuickAccount(igAccounts[0] || ''); setQuickOpen(o => !o); }}
                className="w-full px-4 py-4 sm:py-3 flex items-center justify-between text-left active:bg-blue-100 transition">
                <div className="flex items-center gap-2">
                  <Plus size={18} className="text-blue-600" />
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Quick Batch</h3>
                    <p className="text-[11px] text-gray-500">Tap to create + send in one step</p>
                  </div>
                </div>
                <span className={`text-blue-600 transition-transform ${quickOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {quickOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-blue-200 bg-white/60 backdrop-blur">

                  {/* Account picker — big tap target on mobile */}
                  <div className="pt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Instagram account</label>
                    <select value={quickAccount} onChange={e => setQuickAccount(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-3 text-base bg-white">
                      <option value="">— pick one —</option>
                      {igAccounts.map(u => <option key={u} value={u}>@{u}</option>)}
                    </select>
                  </div>

                  {/* Action type — 3 big segmented buttons */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Action</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['like', 'reply', 'follow'] as const).map(at => (
                        <button key={at} onClick={() => setQuickActionType(at)}
                          className={`py-3 rounded-lg text-sm font-medium border-2 transition ${
                            quickActionType === at
                              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                              : 'bg-white text-gray-700 border-gray-200 active:bg-gray-50'
                          }`}>
                          {at === 'like' ? '❤️ Like' : at === 'reply' ? '💬 Reply' : '👤 Follow'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Count per post */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      Count per post <span className="text-gray-400 font-normal">(1–800)</span>
                    </label>
                    <input type="number" inputMode="numeric" min={1} max={800}
                      value={quickCount} onChange={e => setQuickCount(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-3 text-base bg-white" />
                  </div>

                  {/* Post URLs — bulk paste, one per line */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">
                      Post URLs <span className="text-gray-400 font-normal">(one per line, max 20)</span>
                    </label>
                    <textarea rows={4} value={quickUrls} onChange={e => setQuickUrls(e.target.value)}
                      placeholder={'https://www.instagram.com/p/SHORTCODE/\nhttps://www.instagram.com/p/ANOTHER/'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm bg-white font-mono" />
                    {quickUrls.trim() && (() => {
                      const parsed = parsePostUrls(quickUrls);
                      const lines = quickUrls.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length;
                      return (
                        <p className="text-[11px] text-gray-500 mt-1">
                          Detected <b className={parsed.length === 0 ? 'text-red-500' : 'text-gray-700'}>{parsed.length}</b> valid Instagram post URL{parsed.length === 1 ? '' : 's'}{lines > parsed.length ? ` (${lines - parsed.length} skipped)` : ''}.
                        </p>
                      );
                    })()}
                  </div>

                  {/* Single big action button */}
                  <button onClick={submitQuickBatch} disabled={quickBusy}
                    className="w-full py-4 bg-blue-600 text-white rounded-lg font-semibold text-base hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 shadow-sm">
                    {quickBusy ? 'Creating…' : `Create & Send${parsePostUrls(quickUrls).length > 0 ? ` (${parsePostUrls(quickUrls).length} post${parsePostUrls(quickUrls).length === 1 ? '' : 's'} × ${quickCount} ${quickActionType})` : ''}`}
                  </button>
                  <p className="text-[11px] text-gray-500 text-center">
                    Goes straight to <b>pending</b> — the extension picks it up on next poll (~60s).
                  </p>
                </div>
              )}
            </div>

            {/* Action campaigns header + create button */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Action Batches <span className="text-gray-400 font-normal">({actionCampaigns.length}{actionCampaignsTotal > actionCampaigns.length ? ` of ${actionCampaignsTotal}` : ''})</span></h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => loadActionCampaigns()} className="text-gray-400 hover:text-gray-600" title="Refresh">
                    <RefreshCw size={16} />
                  </button>
                  <button onClick={() => { setCreateAccount(igAccounts[0] || ''); setShowCreateModal(true); }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1">
                    <Plus size={14} /> New batch
                  </button>
                </div>
              </div>
              {actionCampaigns.length === 0 ? (
                <p className="text-gray-400 text-sm py-6 text-center">No batches yet. Click <b>+ New batch</b> to create your first one.<br/><span className="text-xs">Manual likes/replies from the extension popup appear in <b>Manual sessions</b> below.</span></p>
              ) : (
                <div className="space-y-2">
                  {actionCampaigns.map(c => {
                    const elapsedMs = c.started_at && c.ended_at
                      ? new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()
                      : c.started_at ? Date.now() - new Date(c.started_at).getTime() : 0;
                    const minutes = Math.max(0, Math.round(elapsedMs / 60000));
                    const pct = c.total_requested > 0 ? Math.round((c.total_completed / c.total_requested) * 100) : 0;
                    const isExpanded = expandedCampaign === c.id;
                    return (
                      <div key={c.id} className="border border-gray-100 rounded-lg">
                        <div className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <button onClick={() => {
                              if (isExpanded) { setExpandedCampaign(null); }
                              else { setExpandedCampaign(c.id); loadExpandedItems(c.id); }
                            }} className="flex items-center gap-2 text-left flex-1">
                              <ChevronDown size={14} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              <span className="font-medium text-gray-900 text-sm">{c.name || `Batch ${c.id.slice(0, 8)}`}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                c.status === 'draft'     ? 'bg-amber-100 text-amber-700'  :
                                c.status === 'completed' ? 'bg-green-100 text-green-700'  :
                                c.status === 'running'   ? 'bg-blue-100 text-blue-700'    :
                                c.status === 'paused'    ? 'bg-yellow-100 text-yellow-700':
                                c.status === 'cancelled' ? 'bg-gray-100 text-gray-600'    :
                                c.status === 'failed'    ? 'bg-red-100 text-red-700'      :
                                                           'bg-gray-100 text-gray-600'
                              }`}>{c.status}</span>
                              <span className="text-xs text-gray-500">{c.items_count ?? 0}/20 posts</span>
                            </button>
                            <div className="flex items-center gap-2">
                              {c.status === 'draft' && (
                                <button onClick={() => sendCampaign(c.id)}
                                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Send</button>
                              )}
                              {(c.status === 'running' || c.status === 'pending') && (
                                <>
                                  <button onClick={() => pauseActionCampaign(c.id)}
                                    title="Pause — stops claiming new items. In-flight tabs finish normally."
                                    className="text-xs px-2 py-1 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded">⏸ Pause</button>
                                  <button onClick={() => cancelActionCampaign(c.id)}
                                    className="text-xs text-red-600 hover:text-red-800">Cancel</button>
                                </>
                              )}
                              {(c.status === 'paused' || c.status === 'failed') && (
                                <button onClick={() => resumeActionCampaign(c.id)}
                                  title="Resume — pending items return to the queue and the extension picks them up on the next poll."
                                  className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded">▶ Resume</button>
                              )}
                              <button onClick={() => duplicateCampaign(c.id)} title="Duplicate into new draft"
                                className="text-gray-400 hover:text-blue-600"><Copy size={14} /></button>
                              <button onClick={() => deleteCampaign(c.id)} title="Delete"
                                className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          {c.status !== 'draft' && (
                            <>
                              <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-2 pl-6">
                                <span><b className="text-gray-900">{c.total_completed}</b> / {c.total_requested} actions</span>
                                {c.as_account && <span>👤 @{c.as_account}</span>}
                                <span className="text-green-600" title="Distinct users from this batch who later followed back (attribution-based)">
                                  💚 +{c.followers_back || 0} followers back
                                </span>
                                <span className="text-blue-600" title="Likes/comments/replies received from users we engaged in this batch">
                                  💬 +{c.engagement_back || 0} engagement back
                                </span>
                                {c.total_completed > 0 && (
                                  <span className="text-purple-600" title="Conversion = unique returning followers / actions performed">
                                    📊 {(((c.followers_back || 0) / c.total_completed) * 100).toFixed(1)}% conv.
                                  </span>
                                )}
                                <span>Concurrency: {c.concurrency}</span>
                                {c.start_at && !c.started_at && <span className="text-amber-600">Scheduled: {fmt(c.start_at)}</span>}
                                {c.started_at && <span>Started: {fmt(c.started_at)}</span>}
                                {c.ended_at && <span>Ended: {fmt(c.ended_at)}</span>}
                                {c.started_at && <span>Elapsed: {minutes} min</span>}
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden ml-6" style={{width: 'calc(100% - 1.5rem)'}}>
                                <div className={`h-full ${c.status === 'paused' || c.status === 'failed' ? 'bg-red-400' : c.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                                  style={{ width: `${pct}%` }} />
                              </div>
                            </>
                          )}
                          {c.error_message && <p className="text-xs text-red-600 mt-2 pl-6">{c.error_message}</p>}
                        </div>

                        {/* Expanded detail view */}
                        {isExpanded && (
                          <div className="border-t border-gray-100 p-3 bg-gray-50">
                            {/* Scheduled start time — editable while draft or pending */}
                            {(c.status === 'draft' || c.status === 'pending') && (
                              <div className="flex items-center gap-2 mb-3 text-xs">
                                <label className="text-gray-600 whitespace-nowrap">Scheduled start:</label>
                                <input type="datetime-local"
                                  defaultValue={c.start_at ? new Date(c.start_at).toISOString().slice(0, 16) : ''}
                                  onBlur={(e) => {
                                    const next = e.target.value;
                                    const curr = c.start_at ? new Date(c.start_at).toISOString().slice(0, 16) : '';
                                    if (next !== curr) patchCampaignStartAt(c.id, next);
                                  }}
                                  className="border border-gray-200 rounded px-2 py-1 text-xs bg-white" />
                                <span className="text-gray-400">(leave empty for ASAP after Send)</span>
                              </div>
                            )}
                            {expandedItems.length === 0 ? (
                              <p className="text-xs text-gray-500 py-2">No posts yet. Add one below.</p>
                            ) : (
                              <table className="w-full text-sm mb-3">
                                <thead>
                                  <tr className="text-left text-xs text-gray-500">
                                    <th className="py-1 pr-2 font-medium">Post</th>
                                    <th className="py-1 pr-2 font-medium">Action</th>
                                    <th className="py-1 pr-2 font-medium w-20">Count</th>
                                    <th className="py-1 pr-2 font-medium">Status</th>
                                    <th className="py-1 pr-2 font-medium w-8"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedItems.map(it => {
                                    // Pretty summary of the current reply config (shown on Reply rows).
                                    let replySummary = '';
                                    if (it.action_type === 'reply') {
                                      if (it.reply_source === 'custom') {
                                        let arr: string[] = [];
                                        if (it.reply_texts) { try { arr = JSON.parse(it.reply_texts) || []; } catch (_) {} }
                                        replySummary = arr.length > 0
                                          ? `custom (${arr.length} variant${arr.length === 1 ? '' : 's'})`
                                          : 'custom (empty!)';
                                      } else if (it.reply_source === 'ai') {
                                        replySummary = 'AI (default provider)';
                                      } else {
                                        replySummary = 'default replies';
                                      }
                                    }
                                    const isEditingReply = editingReplyItemId === it.id;
                                    return (
                                      <Fragment key={it.id}>
                                        <tr className="border-t border-gray-200">
                                          <td className="py-1.5 pr-2">
                                            <a href={it.post_url} target="_blank" rel="noreferrer"
                                              className="text-blue-600 hover:underline text-xs flex items-center gap-1">
                                              {it.post_url.match(/\/(p|reel)\/([\w-]+)/)?.[2] || it.post_url.slice(-15)}
                                              <ExternalLink size={10} />
                                            </a>
                                          </td>
                                          <td className="py-1.5 pr-2 text-gray-600 capitalize text-xs">
                                            {it.action_type}
                                            {it.action_type === 'reply' && (
                                              <span className={`block text-[10px] font-normal ${it.reply_source === 'custom' && (!it.reply_texts || it.reply_texts === '[]') ? 'text-orange-600' : 'text-gray-400'}`}>
                                                {replySummary}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            {it.status === 'pending' ? (
                                              <input type="number" min={1} max={100} defaultValue={it.count_requested}
                                                onBlur={e => {
                                                  const v = parseInt(e.target.value, 10);
                                                  if (v !== it.count_requested && v >= 1) patchItemCount(c.id, it.id, v);
                                                }}
                                                className="w-16 border border-gray-200 rounded px-1 py-0.5 text-xs bg-white" />
                                            ) : (
                                              <span className="text-xs text-gray-600">{it.count_done}/{it.count_requested}</span>
                                            )}
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                              it.status === 'completed' ? 'bg-green-100 text-green-700' :
                                              it.status === 'partial'   ? 'bg-orange-100 text-orange-700' :
                                              it.status === 'no_targets'? 'bg-yellow-100 text-yellow-700' :
                                              it.status === 'running'   ? 'bg-blue-100 text-blue-700'   :
                                              it.status === 'claimed'   ? 'bg-blue-50 text-blue-600'    :
                                              it.status === 'failed'    ? 'bg-red-100 text-red-700'     :
                                              it.status === 'cancelled' ? 'bg-gray-100 text-gray-600'   :
                                                                          'bg-amber-100 text-amber-700'
                                            }`} title={(it.status === 'partial' || it.status === 'failed') ? (it.error_message || '') : ''}>
                                              {it.status === 'partial' ? `partial (${it.count_done}/${it.count_requested})` : it.status}
                                            </span>
                                          </td>
                                          <td className="py-1.5 pr-2">
                                            <div className="flex items-center gap-1 justify-end">
                                              {it.status === 'pending' && (
                                                <>
                                                  {it.action_type === 'reply' && !isEditingReply && (
                                                    <button onClick={() => startEditReply(it)} title="Edit reply text"
                                                      className="text-gray-400 hover:text-blue-600"><Pencil size={12} /></button>
                                                  )}
                                                  <button onClick={() => removeItem(c.id, it.id)} title="Remove"
                                                    className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                                                </>
                                              )}
                                              {(it.status === 'failed' || it.status === 'partial' || it.status === 'no_targets' || it.status === 'cancelled') && (
                                                <button onClick={() => retryItem(c.id, it.id)} title="Retry this item"
                                                  className="text-xs px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100">
                                                  ↻ Retry
                                                </button>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                        {/* Inline error row for failed/partial items so the user
                                            doesn't have to hover the status badge to see why. */}
                                        {(it.status === 'failed' || it.status === 'partial' || it.status === 'no_targets') && it.error_message && (
                                          <tr>
                                            <td colSpan={5} className="py-1 pl-4 pr-2">
                                              <p className="text-xs text-red-600">⚠ {it.error_message}</p>
                                            </td>
                                          </tr>
                                        )}
                                        {isEditingReply && (
                                          <tr className="border-t border-gray-200 bg-blue-50">
                                            <td colSpan={5} className="py-2 px-3">
                                              <div className="flex gap-2 items-start mb-2">
                                                <select value={editReplySource}
                                                  onChange={e => setEditReplySource(e.target.value as 'default'|'custom'|'ai')}
                                                  className="border border-gray-200 rounded px-2 py-1 text-xs bg-white">
                                                  <option value="default">Default replies</option>
                                                  <option value="custom">Custom text</option>
                                                  {hasAiKey && <option value="ai">AI (default provider)</option>}
                                                </select>
                                                {editReplySource === 'custom' && (
                                                  <textarea rows={2}
                                                    placeholder={'One reply per line\nAmazing! 🔥\nLove this 😍'}
                                                    value={editReplyText}
                                                    onChange={e => setEditReplyText(e.target.value)}
                                                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs bg-white" />
                                                )}
                                              </div>
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={cancelEditReply}
                                                  className="text-xs px-3 py-1 bg-white border border-gray-200 text-gray-600 rounded hover:bg-gray-50">Cancel</button>
                                                <button onClick={() => saveEditReply(c.id, it.id)}
                                                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}

                            {/* Add by URL form */}
                            {c.status !== 'completed' && c.status !== 'cancelled' && (c.items_count ?? 0) < 20 && (() => {
                              // Compute whether the form is valid; disable Add button until it is.
                              const customMissing = byUrlActionType === 'reply'
                                && byUrlReplySource === 'custom'
                                && byUrlReplyText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length === 0;
                              const urlMissing = !byUrlInput.trim();
                              const canAdd = !byUrlBusy && !urlMissing && !customMissing;
                              return (
                                <div className="border-t border-gray-200 pt-3">
                                  <p className="text-xs font-medium text-gray-700 mb-2">+ Add post by URL ({20 - (c.items_count ?? 0)} slot{20 - (c.items_count ?? 0) === 1 ? '' : 's'} left)</p>
                                  <div className="flex flex-wrap gap-2 items-end">
                                    <input type="text" placeholder="https://www.instagram.com/p/SHORTCODE/"
                                      value={byUrlInput} onChange={e => setByUrlInput(e.target.value)}
                                      className="flex-1 min-w-[200px] border border-gray-200 rounded px-2 py-1.5 text-sm bg-white" />
                                    <select value={byUrlActionType} onChange={e => setByUrlActionType(e.target.value as 'like'|'reply')}
                                      className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white">
                                      <option value="like">Like</option>
                                      <option value="reply">Reply</option>
                                    </select>
                                    <input type="number" min={1} max={100} value={byUrlCount}
                                      onChange={e => setByUrlCount(e.target.value)}
                                      className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm bg-white" />
                                    <button onClick={() => addByUrl(c.id)} disabled={!canAdd}
                                      title={customMissing ? 'Type at least one custom reply first' : (urlMissing ? 'Paste a post URL first' : '')}
                                      className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                                      {byUrlBusy ? 'Adding…' : 'Add'}
                                    </button>
                                  </div>
                                  {byUrlActionType === 'reply' && (
                                    <div className="mt-2 space-y-2">
                                      <div className="flex gap-2 items-start">
                                        <select value={byUrlReplySource} onChange={e => setByUrlReplySource(e.target.value as 'default'|'custom'|'ai')}
                                          className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white">
                                          <option value="default">Default replies</option>
                                          <option value="custom">Custom text</option>
                                          {hasAiKey && <option value="ai">AI (default provider)</option>}
                                        </select>
                                        {byUrlReplySource === 'custom' && (
                                          <textarea
                                            placeholder={'One reply per line, e.g.:\nAmazing! 🔥\nLove this 😍\nSo true'}
                                            rows={3}
                                            value={byUrlReplyText} onChange={e => setByUrlReplyText(e.target.value)}
                                            className={`flex-1 border rounded px-2 py-1.5 text-sm bg-white ${customMissing ? 'border-orange-400' : 'border-gray-200'}`} />
                                        )}
                                      </div>
                                      {byUrlReplySource === 'custom' && customMissing && (
                                        <p className="text-xs text-orange-600">Type at least one reply (one per line) — then click Add.</p>
                                      )}
                                      {byUrlReplySource === 'custom' && !customMissing && (
                                        <p className="text-xs text-gray-500">{byUrlReplyText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).length} reply variant(s) — one picked at random per comment.</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Load more — Action Batches. Same pattern as Manual sessions:
                  bumps the limit, useEffect refetches with the new value. */}
              {actionCampaignsTotal > actionCampaigns.length && (
                <div className="text-center mt-3">
                  <button onClick={() => setActionCampaignsLimit(l => l + BATCH_PAGE_SIZE)}
                    className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded border border-gray-200">
                    Load {Math.min(BATCH_PAGE_SIZE, actionCampaignsTotal - actionCampaigns.length)} more
                    <span className="text-gray-400 ml-1">({actionCampaignsTotal - actionCampaigns.length} remaining)</span>
                  </button>
                </div>
              )}
            </div>

            {/* ───── Manual extension popup sessions (single-post, no parent batch) ─────
                Only MANUAL runs appear here — backend's /campaigns filters out
                batch sub-sessions via parent_queue_id IS NULL. So this section
                is exclusively for likes/replies the user fired by clicking the
                extension popup on a specific post. */}
            {campaigns.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-3">
                  Manual sessions <span className="text-gray-400 font-normal">({campaigns.length}{campaignsTotal > campaigns.length ? ` of ${campaignsTotal}` : ''})</span>
                  <span className="ml-2 text-xs font-normal text-gray-500">— individual likes/replies fired from the extension popup</span>
                </h3>
                <div className="space-y-2">
                  {campaigns.map(c => {
                    const shortcode = (u: string) => {
                      const m = u.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
                      return m ? m[1] : u;
                    };
                    // Prefer the column we now store on the campaign row directly
                    // (post_url, set by the extension's START_CAMPAIGN). Fall
                    // back to the enriched post_urls array for legacy rows
                    // created before the migration.
                    const posts = c.post_urls || [];
                    const primaryPost = c.post_url || posts[0] || null;
                    const totalReq = c.total_requested;
                    return (
                      <div key={c.id} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">MANUAL</span>
                            <span className="font-semibold text-gray-900 capitalize text-sm">{TYPE_LABEL[c.type] || c.type}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[c.status] || 'bg-gray-100 text-gray-600'}`}>
                              {c.status}
                            </span>
                            {c.my_profile && (
                              <span className="text-xs text-gray-600">👤 @{c.my_profile}</span>
                            )}
                            {primaryPost && posts.length <= 1 && (
                              <a href={primaryPost} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline font-mono">
                                📍 {shortcode(primaryPost)}
                              </a>
                            )}
                            {posts.length > 1 && (
                              <span className="text-xs text-gray-600" title={posts.join('\n')}>📍 {posts.length} posts</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{fmt(c.started_at)}</span>
                        </div>

                        <div className="flex flex-wrap gap-4 text-xs text-gray-600 pl-1">
                          {/* X performed / Y requested — when extension passed requested.
                              Legacy rows (pre-migration) only show "X performed". */}
                          <span>
                            <b className="text-gray-900">{c.actions_count}</b>
                            {Number.isFinite(totalReq) && totalReq != null && totalReq > 0 && (
                              <span className="text-gray-400"> / {totalReq}</span>
                            )}
                            <span className="ml-1">performed</span>
                          </span>
                          <span className="text-green-600" title="Distinct users from this session who later followed @${c.my_profile} back (attribution-based, not snapshot-delta)">
                            💚 +{c.followers_back ?? 0} followers back
                          </span>
                          <span className="text-blue-600" title="Likes/comments/replies received from users we engaged with in this session">
                            💬 +{c.engagement_back ?? 0} engagement back
                          </span>
                          {c.actions_count > 0 && (
                            <span className="text-purple-600" title="Conversion = unique returning users / actions performed">
                              📊 {(((c.followers_back ?? 0) / c.actions_count) * 100).toFixed(1)}% conv.
                            </span>
                          )}
                          {c.ended_at && c.started_at && (
                            <span>{Math.round((new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 60000)} min</span>
                          )}
                        </div>
                        {c.notes && <p className="text-xs text-gray-500 mt-1 pl-1">{c.notes}</p>}
                      </div>
                    );
                  })}
                </div>
                {/* Load more — bump the limit by another page. Refetches and
                    replaces the list (the new fetch contains everything from
                    page 1 through page N, so scroll position is preserved). */}
                {campaignsTotal > campaigns.length && (
                  <div className="text-center mt-3">
                    <button onClick={() => setCampaignsLimit(l => l + BATCH_PAGE_SIZE)}
                      className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded border border-gray-200">
                      Load {Math.min(BATCH_PAGE_SIZE, campaignsTotal - campaigns.length)} more
                      <span className="text-gray-400 ml-1">({campaignsTotal - campaigns.length} remaining)</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {actionCampaigns.length === 0 && campaigns.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <Users size={32} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400">No activity yet. Create a batch above or run the extension popup on a post.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════ EDIT SCHEDULED POST MODAL ══════════════════════════════ */}
      {editingPost && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingPost(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-gray-900">Edit scheduled post</h3>
              <button onClick={() => setEditingPost(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm">
                <span className="text-gray-600">Replace media (optional)</span>
                <input type="file" accept="image/*,video/*" onChange={e => setEditFile(e.target.files?.[0] || null)}
                  className="block w-full mt-1 text-sm" />
                {editFile ? (
                  <span className="text-xs text-blue-600">New file selected: {editFile.name}</span>
                ) : (
                  <span className="text-xs text-gray-500">Current: {editingPost.media_filename}</span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="text-sm">
                  <span className="text-gray-600">Post type</span>
                  <select value={editType} onChange={e => setEditType(e.target.value as 'post' | 'story' | 'reel')}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm">
                    <option value="post">Post</option>
                    <option value="story">Story</option>
                    <option value="reel">Reel</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">Publish at</span>
                  <input type="datetime-local" value={editWhen} onChange={e => setEditWhen(e.target.value)}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-gray-600">Instagram account</span>
                {igAccounts.length > 0 ? (
                  <select value={editProfile} onChange={e => setEditProfile(e.target.value)}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm">
                    <option value="">— Any / current —</option>
                    {igAccounts.map(a => <option key={a} value={a}>@{a}</option>)}
                  </select>
                ) : (
                  <input type="text" placeholder="@myhandle" value={editProfile} onChange={e => setEditProfile(e.target.value)}
                    className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                )}
              </label>

              <label className="block text-sm">
                <span className="text-gray-600">Caption</span>
                <textarea rows={4} value={editCaption} onChange={e => setEditCaption(e.target.value)}
                  className="block w-full mt-1 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditingPost(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
