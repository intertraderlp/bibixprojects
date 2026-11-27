import { useBoardStore } from '../../store/boardStore';
import { evalFormula } from '../../lib/formula';

// Read-only computed cell. Resolves {Column name} references from the item's
// other columns; a referenced formula column is evaluated recursively (cycle-
// guarded) so formulas can build on each other.
export default function FormulaCell({ itemId, formula }: { itemId?: string; formula?: string }) {
  const { board, getValue } = useBoardStore();

  if (!itemId || !board) return <div className="px-3 h-full flex items-center text-sm text-gray-300">—</div>;

  const resolve = (name: string, depth = 0): string | null => {
    const col = board.columns.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!col) return null;
    if (col.type === 'formula') {
      if (depth > 12) return '';
      const sub = (col.settings as { formula?: string })?.formula || '';
      const r = evalFormula(sub, n => resolve(n, depth + 1));
      return r.ok ? r.value : '';
    }
    return getValue(itemId, col.id);
  };

  const res = evalFormula(formula || '', n => resolve(n));
  if (!res.ok) {
    return <div className="px-3 h-full flex items-center text-sm text-red-400 truncate" title={res.error}>⚠ error</div>;
  }
  return (
    <div className="px-3 h-full flex items-center text-sm text-gray-800 truncate" title={res.value}>
      {res.value || <span className="text-gray-300">—</span>}
    </div>
  );
}
