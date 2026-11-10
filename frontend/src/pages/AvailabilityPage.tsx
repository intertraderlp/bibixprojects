import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO, addDays, isSameDay } from 'date-fns';
import { Calendar, Clock, Lock } from 'lucide-react';
import api from '../api/client';

interface BusyBlock { start: string; end: string; allDay?: boolean; }

export default function AvailabilityPage() {
  const { token } = useParams<{ token: string }>();
  const [name, setName]   = useState('');
  const [busy, setBusy]   = useState<BusyBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    const start = new Date();
    const end   = addDays(start, 56); // next 8 weeks
    api.get(`/calendar/public/availability/${token}`, {
      params: { start: start.toISOString(), end: end.toISOString() },
    })
      .then(r => { setName(r.data.name || ''); setBusy(r.data.busy || []); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const fmtTime = (b: BusyBlock) => {
    if (b.allDay) return 'All day';
    try { return `${format(parseISO(b.start), 'h:mm a')} – ${format(parseISO(b.end), 'h:mm a')}`; }
    catch { return ''; }
  };

  // group busy blocks by day
  const days: { date: Date; blocks: BusyBlock[] }[] = [];
  for (const b of busy) {
    let d: Date;
    try { d = parseISO(b.start); } catch { continue; }
    const existing = days.find(x => isSameDay(x.date, d));
    if (existing) existing.blocks.push(b);
    else days.push({ date: d, blocks: [b] });
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-monday-blue/10 flex items-center justify-center">
            <Calendar size={22} className="text-monday-blue" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {name ? `${name}'s availability` : 'Availability'}
            </h1>
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <Lock size={12} /> Showing busy times only — no meeting details
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-monday-blue border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500">This availability link is invalid or has been revoked.</p>
          </div>
        ) : days.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-gray-600 font-medium">No busy times in the next 8 weeks</p>
            <p className="text-sm text-gray-400 mt-1">They appear to be wide open.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {days.map(({ date, blocks }) => (
              <div key={date.toISOString()} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800">{format(date, 'EEEE')}</span>
                  <span className="text-sm text-gray-400 ml-2">{format(date, 'MMM d, yyyy')}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {blocks.map((b, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
                      <Clock size={13} className="text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-700">{fmtTime(b)}</span>
                      <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Busy</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-300 mt-8">Powered by Bibix</p>
      </div>
    </div>
  );
}
