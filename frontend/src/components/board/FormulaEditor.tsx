import { useRef } from 'react';
import { evalFormula } from '../../lib/formula';
import type { Column } from '../../types';

// Reusable formula editor: a textarea plus clickable column / function / operator
// chips that insert a snippet at the caret so you just replace the placeholders.

const FUNCTIONS: { label: string; snippet: string }[] = [
  { label: 'IF', snippet: 'IF(cond, a, b)' },
  { label: 'ROUND', snippet: 'ROUND(num, 2)' },
  { label: 'ABS', snippet: 'ABS(num)' },
  { label: 'MIN', snippet: 'MIN(a, b)' },
  { label: 'MAX', snippet: 'MAX(a, b)' },
  { label: 'SUM', snippet: 'SUM(a, b)' },
  { label: 'AVG', snippet: 'AVG(a, b)' },
  { label: 'CONCAT', snippet: 'CONCAT(a, b)' },
  { label: 'UPPER', snippet: 'UPPER(text)' },
  { label: 'LOWER', snippet: 'LOWER(text)' },
  { label: 'LEN', snippet: 'LEN(text)' },
];

const OPERATORS: { label: string; snippet: string }[] = [
  { label: '+', snippet: ' + ' },
  { label: '−', snippet: ' - ' },
  { label: '×', snippet: ' * ' },
  { label: '÷', snippet: ' / ' },
  { label: '%', snippet: ' % ' },
  { label: '>', snippet: ' > ' },
  { label: '<', snippet: ' < ' },
  { label: '==', snippet: ' == ' },
  { label: '≠', snippet: ' != ' },
  { label: 'AND', snippet: ' && ' },
  { label: 'OR', snippet: ' || ' },
  { label: 'a ? b : c', snippet: ' ? a : b' },
];

export default function FormulaEditor({
  value, onChange, columns, previewResolve,
}: {
  value: string;
  onChange: (v: string) => void;
  columns: Column[];
  previewResolve?: (name: string) => string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Insert text at the caret (or append), keeping the caret just after it.
  const insert = (text: string) => {
    const el = ref.current;
    const cur = value || '';
    if (!el) { onChange(cur + text); return; }
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + text + cur.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const preview = previewResolve ? evalFormula(value || '', previewResolve) : null;

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder="{Price} * {Qty} * (1 - {Discount}/100)"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-monday-blue"
      />

      {preview && (
        <div className="mt-1 text-xs">
          {preview.ok
            ? <span className="text-gray-500">Preview: <span className="font-medium text-gray-800">{preview.value || '—'}</span></span>
            : <span className="text-red-500">⚠ {preview.error}</span>}
        </div>
      )}

      {columns.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Columns</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {columns.map(c => (
              <button key={c.id} type="button" onClick={() => insert(`{${c.name}}`)}
                className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-monday-blue hover:bg-blue-100">
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <span className="text-[11px] text-gray-400 uppercase tracking-wide">Functions</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {FUNCTIONS.map(f => (
            <button key={f.label} type="button" onClick={() => insert(f.snippet)} title={f.snippet}
              className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-700 hover:border-monday-blue hover:text-monday-blue font-mono">
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2">
        <span className="text-[11px] text-gray-400 uppercase tracking-wide">Operators</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {OPERATORS.map(o => (
            <button key={o.label} type="button" onClick={() => insert(o.snippet)} title={o.snippet.trim()}
              className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-700 hover:border-monday-blue hover:text-monday-blue font-mono">
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
