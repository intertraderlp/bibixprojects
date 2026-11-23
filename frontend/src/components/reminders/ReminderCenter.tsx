import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseISO, format, isToday, startOfDay, addDays } from 'date-fns';
import { Bell, Clock, Check, X, CalendarClock, ExternalLink } from 'lucide-react';
import api from '../../api/client';
import toast from 'react-hot-toast';
import { setFaviconBadge } from '../../lib/favicon';

interface Reminder {
  id: string; item_id: string; board_id: string | null; remind_at: string;
  note: string | null; done: boolean; item_name: string; board_name: string | null;
  item_deleted?: boolean;
}

const UPCOMING_DAYS = 7;
const POLL_MS = 60_000;

function loadAlerted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('reminders_alerted') || '[]')); }
  catch { return new Set(); }
}
function saveAlerted(set: Set<string>) {
  try { localStorage.setItem('reminders_alerted', JSON.stringify([...set].slice(-500))); } catch { /* */ }
}

export default function ReminderCenter() {
  const navigate = useNavigate();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const alertedRef = useRef<Set<string>>(loadAlerted());

  const fetchReminders = useCallback(async () => {
    try {
      const { data } = await api.get<Reminder[]>('/reminders');
      setReminders(data);
      return data;
    } catch { return []; }
  }, []);

  // Poll + react to reminders becoming due (favicon + toast + daily popup).
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const data = await fetchReminders();
      if (cancelled) return;
      const now = Date.now();

      const dueCount = data.filter(r => !r.done && new Date(r.remind_at).getTime() <= endOfToday()).length;
      setFaviconBadge(dueCount);

      // Toast for reminders that have just come due (not alerted yet)
      let changed = false;
      for (const r of data) {
        if (r.done) continue;
        if (new Date(r.remind_at).getTime() <= now && !alertedRef.current.has(r.id)) {
          alertedRef.current.add(r.id);
          changed = true;
          toast(`⏰ Reminder: ${r.item_name}`, { duration: 6000, icon: '🔔' });
        }
      }
      if (changed) { saveAlerted(alertedRef.current); setOpen(true); }

      // Once-a-day summary popup if there's anything relevant
      maybeShowDailyPopup(data);
    };

    const maybeShowDailyPopup = (data: Reminder[]) => {
      const today = format(new Date(), 'yyyy-MM-dd');
      let seen = '';
      try { seen = localStorage.getItem('reminders_popup_date') || ''; } catch { /* */ }
      if (seen === today) return;
      const horizon = addDays(startOfDay(new Date()), UPCOMING_DAYS).getTime();
      const relevant = data.some(r => !r.done && new Date(r.remind_at).getTime() <= horizon);
      if (relevant) {
        setOpen(true);
        try { localStorage.setItem('reminders_popup_date', today); } catch { /* */ }
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    const onChanged = () => fetchReminders();
    window.addEventListener('reminders:changed', onChanged);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('reminders:changed', onChanged); };
  }, [fetchReminders]);

  const endOfTodayMs = endOfToday();
  const nowMs = Date.now();
  const active = reminders.filter(r => !r.done);
  const overdue  = active.filter(r => new Date(r.remind_at).getTime() < nowMs);
  const todayDue = active.filter(r => { const t = new Date(r.remind_at).getTime(); return t >= nowMs && isToday(parseISO(r.remind_at)); });
  const upcoming = active.filter(r => { const t = new Date(r.remind_at).getTime(); return t > endOfTodayMs; });
  const badgeCount = overdue.length + todayDue.length;

  const markDone = async (r: Reminder) => {
    setReminders(list => list.map(x => x.id === r.id ? { ...x, done: true } : x));
    try { await api.put(`/reminders/${r.id}`, { done: true }); } catch { /* */ }
  };

  const openTask = (r: Reminder) => {
    if (r.board_id) navigate(`/board/${r.board_id}?item=${r.item_id}`);
    setOpen(false);
  };

  const Row = ({ r, tone }: { r: Reminder; tone: 'red' | 'blue' | 'gray' }) => {
    const dot = tone === 'red' ? 'bg-red-500' : tone === 'blue' ? 'bg-monday-blue' : 'bg-gray-400';
    return (
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 group">
        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dot}`} />
        <div className="flex-1 min-w-0">
          <button onClick={() => openTask(r)} className="text-left w-full">
            <div className="text-sm font-medium text-gray-900 truncate group-hover:text-monday-blue flex items-center gap-1">
              {r.item_name}{r.board_id && <ExternalLink size={11} className="opacity-0 group-hover:opacity-100 flex-shrink-0" />}
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
              <Clock size={11} /> {format(parseISO(r.remind_at), 'EEE, MMM d · h:mm a')}
              {r.board_name && <span className="text-gray-300">·</span>}
              {r.board_name && <span className="truncate">{r.board_name}</span>}
            </div>
            {r.note && <div className="text-xs text-gray-400 mt-0.5 truncate">{r.note}</div>}
          </button>
        </div>
        <button onClick={() => markDone(r)} title="Mark done"
          className="flex-shrink-0 p-1 text-gray-300 hover:text-green-600 hover:bg-green-50 rounded">
          <Check size={15} />
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Floating re-open button when something is due */}
      {badgeCount > 0 && !open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[9998] flex items-center gap-2 pl-3 pr-4 py-2.5 bg-monday-blue text-white rounded-full shadow-lg hover:bg-blue-600">
          <span className="relative">
            <Bell size={18} />
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          </span>
          <span className="text-sm font-medium">Reminders</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-20 px-4" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[75vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CalendarClock size={18} className="text-monday-blue" />
                <h2 className="font-semibold text-gray-900">Task reminders</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto flex-1">
              {active.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="text-3xl mb-2">✅</div>
                  <p className="text-sm text-gray-500">No reminders right now</p>
                  <p className="text-xs text-gray-400 mt-1">Open any task and set one to see it here.</p>
                </div>
              ) : (
                <>
                  {overdue.length > 0 && (
                    <Section title="Overdue" count={overdue.length} color="text-red-600">
                      {overdue.map(r => <Row key={r.id} r={r} tone="red" />)}
                    </Section>
                  )}
                  {todayDue.length > 0 && (
                    <Section title="Today" count={todayDue.length} color="text-monday-blue">
                      {todayDue.map(r => <Row key={r.id} r={r} tone="blue" />)}
                    </Section>
                  )}
                  {upcoming.length > 0 && (
                    <Section title="Upcoming" count={upcoming.length} color="text-gray-500">
                      {upcoming.map(r => <Row key={r.id} r={r} tone="gray" />)}
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-50 last:border-0">
      <div className={`px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider ${color}`}>{title} · {count}</div>
      {children}
    </div>
  );
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
