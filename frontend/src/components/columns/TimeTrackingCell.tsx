import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { parseTT, totalSeconds, formatHMS } from '../../lib/timeTracking';

// Start/stop timer. Only persists on start/stop (and reset); while running it
// ticks locally for display and computes elapsed from startedAt, so the total
// stays correct across reloads.
export default function TimeTrackingCell({ value, onChange }: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const t = parseTT(value);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!t.running) return;
    const id = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [t.running, value]);

  const toggle = () => {
    if (t.running) {
      onChange(JSON.stringify({ seconds: totalSeconds(t), running: false, startedAt: null }));
    } else {
      onChange(JSON.stringify({ seconds: t.seconds, running: true, startedAt: Date.now() }));
    }
  };

  const reset = () => onChange(JSON.stringify({ seconds: 0, running: false, startedAt: null }));

  const total = totalSeconds(t);

  return (
    <div className="flex items-center gap-2 px-2 h-full group/tt">
      <button onClick={toggle} title={t.running ? 'Stop' : 'Start'}
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          t.running ? 'bg-monday-blue text-white hover:bg-blue-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
        {t.running ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
      </button>
      <span className={`font-mono text-sm tabular-nums ${t.running ? 'text-monday-blue font-medium' : 'text-gray-700'}`}>
        {formatHMS(total)}
      </span>
      {total > 0 && !t.running && (
        <button onClick={reset} title="Reset"
          className="opacity-0 group-hover/tt:opacity-100 text-gray-300 hover:text-red-500 flex-shrink-0">
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}
