import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragStartEvent, DragOverEvent, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, ChevronDown, ChevronRight, MoreHorizontal, Trash2, GripVertical, Settings, ChevronUp, Filter, X, ArrowUpAZ, ArrowDownAZ, ArrowUp, ArrowDown, Sigma, Zap, Sparkles, ExternalLink } from 'lucide-react';
import { totalSecondsFromRaw, formatHMS } from '../../lib/timeTracking';
import { useBoardStore } from '../../store/boardStore';
import api from '../../api/client';
import type { Column, Group, Item } from '../../types';
import CellRenderer from '../columns/CellRenderer';
import ItemModal from './ItemModal';
import AddColumnModal from './AddColumnModal';
import ColumnSettingsModal from './ColumnSettingsModal';
import Dropdown, { DropdownItem } from '../ui/Dropdown';
import toast from 'react-hot-toast';

const GROUP_COLORS = ['#0073ea','#e2445c','#00c875','#fdab3d','#a25ddc','#037f4c','#bb3354','#ff642e'];
const NAME_COL_WIDTH = 300;
const DEFAULT_COL_WIDTH = 140;

// ─── Column summaries ────────────────────────────────────────────────────────
type SummaryType = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'empty' | 'pct_checked' | 'checked' | 'breakdown' | 'total_time';

const SUMMARY_LABELS: Record<SummaryType, string> = {
  sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', count: 'Count filled', empty: 'Count empty',
  pct_checked: '% checked', checked: 'Checked', breakdown: 'Breakdown', total_time: 'Total time',
};

function summaryOptionsFor(type: string): SummaryType[] {
  if (type === 'number') return ['sum', 'avg', 'min', 'max', 'count', 'empty'];
  if (type === 'checkbox') return ['pct_checked', 'checked', 'empty'];
  if (type === 'status' || type === 'priority') return ['count', 'empty', 'breakdown'];
  if (type === 'time_tracking') return ['total_time', 'count', 'empty'];
  return ['count', 'empty'];
}

function fmtNum(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function computeSummary(s: SummaryType, values: (string | null)[]): string {
  const total = values.length;
  const filled = values.filter(v => v != null && String(v).trim() !== '');
  switch (s) {
    case 'count': return String(filled.length);
    case 'empty': return String(total - filled.length);
    case 'checked': { const c = values.filter(v => v === 'true').length; return `${c}/${total}`; }
    case 'pct_checked': { const c = values.filter(v => v === 'true').length; return total ? `${Math.round((c / total) * 100)}%` : '0%'; }
    case 'total_time': return formatHMS(values.reduce((s, v) => s + totalSecondsFromRaw(v), 0));
    case 'breakdown': {
      const counts: Record<string, number> = {};
      filled.forEach(v => { counts[v as string] = (counts[v as string] || 0) + 1; });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const top = entries.slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ');
      return entries.length > 3 ? `${top} +${entries.length - 3}` : top;
    }
    default: {
      const nums = filled.map(v => Number(v)).filter(n => !isNaN(n));
      if (!nums.length) return '—';
      if (s === 'sum') return fmtNum(nums.reduce((a, b) => a + b, 0));
      if (s === 'avg') return fmtNum(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (s === 'min') return fmtNum(Math.min(...nums));
      if (s === 'max') return fmtNum(Math.max(...nums));
      return '';
    }
  }
}
const MIN_COL_WIDTH = 80;

function OptionFilterDropdown({ opts, value, onChange }: {
  opts: { label: string; color: string }[];
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = value.split(',').filter(Boolean);

  const openDropdown = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: Math.max(r.width, 160) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && btnRef.current.contains(e.target as Node) ||
        panelRef.current && panelRef.current.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (label: string) => {
    const next = selected.includes(label) ? selected.filter(s => s !== label) : [...selected, label];
    onChange(next.join(','));
  };

  const panel = open ? (
    <div ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-xl py-1">
      {opts.map(opt => {
        const active = selected.includes(opt.label);
        return (
          <button key={opt.label} onMouseDown={e => e.preventDefault()} onClick={() => toggle(opt.label)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-left">
            <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold ${active ? 'border-transparent' : 'border-gray-300'}`}
              style={active ? { backgroundColor: opt.color } : {}}>
              {active ? '✓' : ''}
            </span>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: opt.color }} />
            <span className="text-xs text-gray-700">{opt.label}</span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <div className="border-t border-gray-100 mt-1 pt-1">
          <button onMouseDown={e => e.preventDefault()} onClick={() => { onChange(''); setOpen(false); }}
            className="w-full text-xs text-red-500 hover:bg-red-50 px-3 py-1.5 text-left">
            Clear filter
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <button ref={btnRef} onClick={() => open ? setOpen(false) : openDropdown()}
        className="w-full flex items-center justify-between text-xs px-1.5 py-1 rounded border border-transparent hover:border-blue-300 hover:bg-white transition-colors">
        <span className={selected.length ? 'text-gray-700 font-medium truncate' : 'text-gray-400'}>
          {selected.length === 0 ? 'Filter…' : selected.length === 1 ? selected[0] : `${selected.length} selected`}
        </span>
        <ChevronDown size={10} className="text-gray-400 flex-shrink-0 ml-1" />
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  );
}

// ─── Sortable wrappers ───────────────────────────────────────────────────────

function SortableColumnHeader({ col, width, sortDir, onResize, onSettings, onDelete, onSort, onFilterOpen, onSummarize }: {
  col: Column; width: number; sortDir?: 'asc' | 'desc' | null;
  onResize: (colId: string, e: React.PointerEvent) => void;
  onSettings: (col: Column) => void;
  onDelete: (col: Column) => void;
  onSort: (colId: string, dir: 'asc' | 'desc') => void;
  onFilterOpen: (colId: string) => void;
  onSummarize: (col: Column, s: SummaryType | null) => void;
}) {
  const curSummary = (col.settings as { summary?: SummaryType })?.summary;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id, data: { type: 'column' } });
  return (
    <div ref={setNodeRef} style={{ width, minWidth: width, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="relative flex items-center justify-center border-r border-gray-200 bg-white text-xs font-medium text-gray-500 select-none group h-9 flex-shrink-0">
      <span {...attributes} {...listeners} className="absolute left-1 cursor-grab text-gray-300 hover:text-gray-500">
        <GripVertical size={12} />
      </span>
      <span className="truncate px-4 flex items-center gap-1">
        {col.name}
        {sortDir === 'asc' && <ArrowUp size={10} className="text-monday-blue flex-shrink-0" />}
        {sortDir === 'desc' && <ArrowDown size={10} className="text-monday-blue flex-shrink-0" />}
      </span>
      <Dropdown trigger={
        <button className="absolute right-3 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-700">
          <MoreHorizontal size={12} />
        </button>
      } align="right">
        <DropdownItem onClick={() => onSort(col.id, 'asc')}><ArrowUpAZ size={13} /> Sort A → Z</DropdownItem>
        <DropdownItem onClick={() => onSort(col.id, 'desc')}><ArrowDownAZ size={13} /> Sort Z → A</DropdownItem>
        <DropdownItem onClick={() => onFilterOpen(col.id)}><Filter size={13} /> Filter by this column</DropdownItem>
        <div className="border-t border-gray-100 my-1" />
        <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Summarize</div>
        {summaryOptionsFor(col.type).map(s => (
          <DropdownItem key={s} onClick={() => onSummarize(col, s)}>
            <Sigma size={13} /> <span className="flex-1">{SUMMARY_LABELS[s]}</span>
            {curSummary === s && <span className="text-monday-blue">✓</span>}
          </DropdownItem>
        ))}
        {curSummary && <DropdownItem onClick={() => onSummarize(col, null)}><X size={13} /> Clear summary</DropdownItem>}
        <div className="border-t border-gray-100 my-1" />
        <DropdownItem onClick={() => onSettings(col)}><Settings size={13} /> Edit Column</DropdownItem>
        <DropdownItem danger onClick={() => onDelete(col)}><Trash2 size={13} /> Delete</DropdownItem>
      </Dropdown>
      <div onPointerDown={e => onResize(col.id, e)}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-monday-blue/40 transition-colors" />
    </div>
  );
}

function SortableGroupHeader({ group, itemCount, collapsed, filterActive, onToggle, onRename, onColorChange, onDelete, onFilterToggle, selectState, onToggleSelectAll }: {
  group: Group; itemCount: number; collapsed: boolean; filterActive: boolean;
  onToggle: () => void; onRename: (name: string) => void;
  onColorChange: (color: string) => void; onDelete: () => void; onFilterToggle: () => void;
  selectState?: 'none' | 'some' | 'all'; onToggleSelectAll?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `group-${group.id}`, data: { type: 'group', groupId: group.id } });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="bg-gray-50">
      <div className="sticky left-0 z-10 flex items-center gap-2 px-4 py-2 bg-gray-50 w-fit">
        <span {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500"><GripVertical size={14} /></span>
        <button onClick={onToggle} className="text-gray-500 hover:text-gray-700">
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        {onToggleSelectAll && (
          <input type="checkbox" checked={selectState === 'all'}
            ref={el => { if (el) el.indeterminate = selectState === 'some'; }}
            onChange={onToggleSelectAll}
            title="Select all in group"
            className="w-3.5 h-3.5 cursor-pointer accent-monday-blue flex-shrink-0" />
        )}
        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: group.color }} />
        {editing ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft); }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft); } if (e.key === 'Escape') setEditing(false); }}
            className="font-semibold text-sm outline-none border-b border-monday-blue bg-transparent" />
        ) : (
          <span className="font-semibold text-sm cursor-pointer hover:text-monday-blue" onDoubleClick={() => setEditing(true)}>
            {group.name}
          </span>
        )}
        <span className="text-xs text-gray-400">{itemCount}</span>
        <button onClick={onFilterToggle}
          className={`p-0.5 rounded transition-colors ${filterActive ? 'text-monday-blue bg-blue-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'}`}
          title="Filter group">
          <Filter size={13} />
        </button>
        <Dropdown trigger={<button className="text-gray-400 hover:text-gray-600 p-0.5 rounded hover:bg-gray-200"><MoreHorizontal size={14} /></button>} align="left">
          <div className="px-2 py-1.5 flex flex-wrap gap-1">
            {GROUP_COLORS.map(c => (
              <button key={c} onClick={() => onColorChange(c)}
                className="w-5 h-5 rounded hover:scale-110 transition-transform" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="border-t border-gray-100 mt-1 pt-1">
            <DropdownItem danger onClick={onDelete}><Trash2 size={14} /> Delete Group</DropdownItem>
          </div>
        </Dropdown>
      </div>
    </div>
  );
}

function SortableItemRow({ item, group, columns, board, colWidths, onOpen, onDelete, onValueChange, isSubtask, subtaskCount, expanded, onToggleExpand, onAddSubtask, onPromote, onDemote, demoteTargets, hasSubtasks, templates, onRunTemplate, selected, onToggleSelect }: {
  item: Item; group: Group; columns: Column[];
  board: { workspace_id: string }; colWidths: Record<string, number>;
  onOpen: () => void; onDelete: () => void;
  onValueChange: (colId: string, val: string | null) => void;
  isSubtask?: boolean; subtaskCount?: number;
  expanded?: boolean; onToggleExpand?: () => void; onAddSubtask?: () => void;
  onPromote?: () => void; onDemote?: (parentId: string) => void;
  demoteTargets?: { id: string; name: string }[]; hasSubtasks?: boolean;
  templates?: { id: string; name: string }[]; onRunTemplate?: (templateId: string) => void;
  selected?: boolean; onToggleSelect?: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, data: { type: isSubtask ? 'subtask' : 'item', groupId: item.group_id, parentId: item.parent_item_id }
  });
  const { getValue } = useBoardStore();

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`flex border-b border-gray-100 hover:bg-gray-50 group ${selected ? 'bg-blue-50/60' : isSubtask ? 'bg-gray-50/50' : 'bg-white'}`}>
      {/* Grip + Name col (sticky) */}
      <div className={`sticky left-0 z-10 flex items-center gap-1 border-r border-gray-200 h-9 flex-shrink-0 ${selected ? 'bg-blue-50/60' : isSubtask ? 'bg-gray-50' : 'bg-white'} group-hover:bg-gray-50`} style={{ width: NAME_COL_WIDTH }}>
        <span {...attributes} {...listeners} className="cursor-grab text-gray-200 hover:text-gray-400 pl-2 flex-shrink-0"><GripVertical size={13} /></span>
        <input type="checkbox" checked={!!selected} onClick={e => onToggleSelect?.(e)} onChange={() => {}}
          className={`flex-shrink-0 w-3.5 h-3.5 cursor-pointer accent-monday-blue ${selected ? '' : 'opacity-0 group-hover:opacity-100'}`} />
        {isSubtask && <span className="w-4 flex-shrink-0" />}
        <div className="w-1 h-5 rounded flex-shrink-0" style={{ backgroundColor: group.color }} />
        <span className="flex-1 text-sm text-gray-800 cursor-pointer hover:text-monday-blue truncate px-1" onClick={onOpen}>
          {item.name}
        </span>
        {!isSubtask && onToggleExpand && (
          <button onClick={onToggleExpand}
            className={`flex-shrink-0 flex items-center gap-0.5 px-1 rounded text-xs font-medium transition-colors
              ${(subtaskCount ?? 0) > 0
                ? 'text-monday-blue bg-blue-50 hover:bg-blue-100'
                : 'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-monday-blue hover:bg-blue-50'}`}
            title={`${subtaskCount ?? 0} subtask${subtaskCount !== 1 ? 's' : ''}`}>
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {(subtaskCount ?? 0) > 0 && <span>{subtaskCount}</span>}
          </button>
        )}
        {!isSubtask && (
          <button onClick={e => { e.stopPropagation(); if (onAddSubtask) onAddSubtask(); }}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-monday-blue flex-shrink-0"
            title="Add subtask">
            <Plus size={12} />
          </button>
        )}
        {/* ⚡ Run template / action */}
        <Dropdown align="right" className="flex-shrink-0"
          trigger={
            <button type="button"
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-amber-500 flex-shrink-0"
              title="Run action">
              <Zap size={13} />
            </button>
          }>
          <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Run template</div>
          {templates && templates.length > 0
            ? templates.map(t => (
                <DropdownItem key={t.id} onClick={() => onRunTemplate?.(t.id)}>
                  <Sparkles size={13} /> <span className="truncate">{t.name}</span>
                </DropdownItem>
              ))
            : <DropdownItem disabled><Sparkles size={13} /> No templates yet</DropdownItem>}
        </Dropdown>

        {/* Promote / demote menu */}
        <Dropdown align="right" className="flex-shrink-0"
          trigger={
            <button type="button"
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-600 flex-shrink-0"
              title="Move in hierarchy">
              <MoreHorizontal size={13} />
            </button>
          }>
          {isSubtask ? (
            <DropdownItem onClick={() => onPromote?.()}><ArrowUp size={13} /> Promote to task</DropdownItem>
          ) : hasSubtasks ? (
            <DropdownItem disabled><ArrowDown size={13} /> Has subtasks — can't demote</DropdownItem>
          ) : (demoteTargets && demoteTargets.length > 0) ? (
            <>
              <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Make subtask of</div>
              <div className="max-h-56 overflow-y-auto">
                {demoteTargets.map(t => (
                  <DropdownItem key={t.id} onClick={() => onDemote?.(t.id)}>
                    <ArrowDown size={13} /> <span className="truncate">{t.name}</span>
                  </DropdownItem>
                ))}
              </div>
            </>
          ) : (
            <DropdownItem disabled><ArrowDown size={13} /> No other task to nest under</DropdownItem>
          )}
        </Dropdown>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 pr-2 flex-shrink-0">
          <Trash2 size={12} />
        </button>
      </div>
      {/* Value cells */}
      {columns.map(col => {
        const w = colWidths[col.id] || DEFAULT_COL_WIDTH;
        return (
          <div key={col.id} style={{ width: w, minWidth: w }} className="h-9 border-r border-gray-100 flex-shrink-0">
            <CellRenderer column={col} value={getValue(item.id, col.id)} onChange={v => onValueChange(col.id, v)} workspaceId={board.workspace_id} itemId={item.id} />
          </div>
        );
      })}
      <div className="flex-1" />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function TableView() {
  const store = useBoardStore();
  const { board, addItem, deleteItem, updateItem, addGroup, updateGroup, deleteGroup, updateItemValue, updateColumn, deleteColumn, reorderGroups, reorderItems, reorderColumns, getValue, templates, loadTemplates, runTemplate } = store;

  useEffect(() => { if (board) loadTemplates(board.id); }, [board?.id]);

  // Run a template against a row and report where the result landed.
  const runTpl = async (templateId: string, itemId: string) => {
    const tid = toast.loading('Generating…');
    try {
      const r = await runTemplate(templateId, itemId);
      toast.success(`Written to "${r.column_name}"`, { id: tid });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Failed to run template', { id: tid });
    }
  };
  const tplList = templates.map(t => ({ id: t.id, name: t.name }));

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkColId, setBulkColId] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const setGroupSelected = (ids: string[], on: boolean) => setSelected(s => {
    const n = new Set(s); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n;
  });
  const [openColId, setOpenColId] = useState('');
  const [blockedLinks, setBlockedLinks] = useState<string[]>([]);
  const clearSelection = () => { setSelected(new Set()); setBulkColId(''); setBulkValue(''); setOpenColId(''); };

  const bulkCol = board?.columns.find(c => c.id === bulkColId) || null;

  // Columns whose cells may hold a URL to open in bulk.
  const linkableCols = (board?.columns || []).filter(c => c.type === 'link' || c.type === 'text');

  // Turn a cell value into an openable URL, or '' if it isn't one.
  const toUrl = (raw: unknown): string => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[\w-]+(\.[\w-]+)+(\/|\?|#|$)/.test(s)) return 'https://' + s; // bare domain like foo.com/x
    return '';
  };

  const bulkOpenLinks = () => {
    if (!openColId || selected.size === 0) return;
    const urls = [...selected].map(id => toUrl(getValue(id, openColId))).filter(Boolean);
    const unique = [...new Set(urls)];
    if (unique.length === 0) { toast.error('No links found in that field for the selected items'); return; }
    if (unique.length > 10 && !confirm(`Open ${unique.length} tabs? Your browser may ask to allow multiple pop-ups.`)) return;
    // Browsers block all-but-the-first tab opened from one click as pop-ups.
    // Open each and detect which were blocked (window.open returns null), then
    // offer the blocked ones in a fallback panel the user can click through.
    // NOTE: don't pass 'noopener' in the features string — that makes
    // window.open always return null, defeating block detection; clear opener
    // manually instead.
    const blocked: string[] = [];
    unique.forEach(u => {
      const w = window.open(u, '_blank');
      if (w) { try { w.opener = null; } catch { /* cross-origin */ } }
      else blocked.push(u);
    });
    const skipped = selected.size - urls.length;
    const opened = unique.length - blocked.length;
    if (blocked.length) {
      setBlockedLinks(blocked);
    } else {
      toast.success(`Opened ${opened} link${opened > 1 ? 's' : ''}${skipped > 0 ? ` · ${skipped} item${skipped > 1 ? 's' : ''} had none` : ''}`);
    }
  };

  const applyBulkValue = async () => {
    if (!bulkColId || selected.size === 0) return;
    setBulkBusy(true);
    const ids = [...selected];
    try {
      for (const id of ids) {
        await updateItemValue(id, bulkColId, bulkValue === '' ? null : bulkValue);
      }
      toast.success(`Updated ${ids.length} item${ids.length > 1 ? 's' : ''}`);
    } catch { toast.error('Some updates failed'); }
    finally { setBulkBusy(false); }
  };

  const bulkDelete = async () => {
    if (selected.size === 0 || !confirm(`Delete ${selected.size} selected item(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    const ids = [...selected];
    try {
      for (const id of ids) await deleteItem(id);
      toast.success(`Deleted ${ids.length}`);
      clearSelection();
    } catch { toast.error('Some deletions failed'); }
    finally { setBulkBusy(false); }
  };

  // Set or clear a column's summary (stored inside the column's settings blob).
  const handleSummarize = (col: Column, s: SummaryType | null) => {
    const settings = { ...(col.settings || {}), summary: s || undefined };
    updateColumn(col.id, { settings } as never);
  };

  // Promote a subtask to a top-level task, or demote a task into a subtask.
  const changeParent = async (id: string, parentId: string | null) => {
    try {
      await updateItem(id, { parent_item_id: parentId } as never);
      toast.success(parentId ? 'Made subtask' : 'Promoted to task');
      if (parentId) setExpandedItems(e => ({ ...e, [parentId]: true }));
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Could not move item');
    }
  };

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [showAddCol, setShowAddCol] = useState(false);
  const [settingsCol, setSettingsCol] = useState<Column | null>(null);
  const [newItemGroup, setNewItemGroup] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [newSubtaskFor, setNewSubtaskFor] = useState<string | null>(null);
  const [newSubtaskName, setNewSubtaskName] = useState('');
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [showFilters, setShowFilters] = useState<Record<string, boolean>>({});
  const [groupFilters, setGroupFilters] = useState<Record<string, { name: string; cols: Record<string, string> }>>({});
  const [sortConfig, setSortConfig] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null);
  const [pageByGroup, setPageByGroup] = useState<Record<string, number>>({});
  const PAGE_SIZE = 100;

  // Active drag
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<Item | Group | Column | null>(null);

  // Track live widths in a ref so resize handlers always read the current value
  // without needing to be recreated on every mousemove.
  const colWidthsRef = useRef<Record<string, number>>({});
  const resizeRef = useRef<{ colId: string; startX: number; startWidth: number; currentWidth: number } | null>(null);

  // Keep colWidths synced from board (only on board change, not on every column update)
  useEffect(() => {
    if (!board) return;
    const w: Record<string, number> = {};
    board.columns.forEach(c => { w[c.id] = c.width || DEFAULT_COL_WIDTH; });
    setColWidths(w);
  }, [board?.id]);

  // Keep the ref in sync with state so resize closures can read it
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  const startResize = useCallback((colId: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Capture the pointer so pointermove/pointerup fire even if the cursor
    // leaves the element. This also prevents DnD-kit's PointerSensor from
    // stealing the event sequence.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const startWidth = colWidthsRef.current[colId] || DEFAULT_COL_WIDTH;
    resizeRef.current = { colId, startX: e.clientX, startWidth, currentWidth: startWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const newW = Math.max(MIN_COL_WIDTH, resizeRef.current.startWidth + ev.clientX - resizeRef.current.startX);
      resizeRef.current.currentWidth = newW;
      setColWidths(w => ({ ...w, [resizeRef.current!.colId]: newW }));
    };

    const onUp = () => {
      if (resizeRef.current) {
        const { colId: id, currentWidth } = resizeRef.current;
        // Bypass the store so we don't trigger a board re-render mid-resize.
        api.put(`/columns/${id}`, { width: currentWidth }).catch(() => {});
      }
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []); // no deps — reads colWidthsRef (always current) instead of colWidths state

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!board) return null;
  const { groups, items, columns } = board;
  const sortedGroups = [...groups].sort((a, b) => a.position - b.position);
  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);

  const topItems = (groupId: string) => {
    const base = items.filter(i => i.group_id === groupId && !i.parent_item_id).sort((a, b) => a.position - b.position);
    if (!sortConfig) return base;
    const { colId, dir } = sortConfig;
    const col = sortedColumns.find(c => c.id === colId);
    return [...base].sort((a, b) => {
      const av = store.getValue(a.id, colId) ?? '';
      const bv = store.getValue(b.id, colId) ?? '';
      let cmp = 0;
      if (col?.type === 'number') {
        cmp = (parseFloat(av) || 0) - (parseFloat(bv) || 0);
      } else {
        cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      }
      return dir === 'asc' ? cmp : -cmp;
    });
  };

  const handleSort = (colId: string, dir: 'asc' | 'desc') => {
    setSortConfig(prev => prev?.colId === colId && prev.dir === dir ? null : { colId, dir });
  };

  const handleFilterOpen = (colId: string) => {
    // Open all group filter rows and focus this column
    const allGroupIds = sortedGroups.map(g => g.id);
    setShowFilters(f => Object.fromEntries(allGroupIds.map(id => [id, true])));
    // Pre-populate filter tag so the column is highlighted
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-filter-col="${colId}"]`);
      if (input) { input.focus(); }
    }, 50);
  };
  const subtasksOf = (itemId: string) => items.filter(i => i.parent_item_id === itemId).sort((a, b) => a.position - b.position);

  const applyGroupFilter = (groupId: string, item: Item) => {
    const f = groupFilters[groupId];
    if (!f) return true;
    if (f.name && !item.name.toLowerCase().includes(f.name.toLowerCase())) return false;
    for (const [colId, val] of Object.entries(f.cols || {})) {
      if (!val) continue;
      const col = sortedColumns.find(c => c.id === colId);
      const cellVal = store.getValue(item.id, colId) ?? '';
      if (col?.type === 'status' || col?.type === 'priority') {
        const selected = val.split(',').filter(Boolean);
        if (selected.length > 0 && !selected.includes(cellVal)) return false;
      } else {
        if (!cellVal.toLowerCase().includes(val.toLowerCase())) return false;
      }
    }
    return true;
  };

  const setColFilter = (groupId: string, colId: string, val: string) => {
    setGroupFilters(f => ({ ...f, [groupId]: { name: f[groupId]?.name ?? '', cols: { ...f[groupId]?.cols, [colId]: val } } }));
  };
  const setNameFilter = (groupId: string, val: string) => {
    setGroupFilters(f => ({ ...f, [groupId]: { name: val, cols: f[groupId]?.cols ?? {} } }));
  };
  const clearGroupFilter = (groupId: string) => {
    setGroupFilters(f => { const n = { ...f }; delete n[groupId]; return n; });
  };
  const hasActiveFilter = (groupId: string) => {
    const f = groupFilters[groupId];
    if (!f) return false;
    return !!f.name || Object.values(f.cols || {}).some(v => !!v);
  };

  const handleAddItem = async (groupId: string) => {
    if (!newItemName.trim()) { setNewItemGroup(null); return; }
    await addItem(groupId, newItemName.trim());
    setNewItemName(''); setNewItemGroup(null);
  };

  const handleAddSubtask = async (parentId: string) => {
    const name = newSubtaskName.trim();
    setNewSubtaskName('');
    setNewSubtaskFor(null);
    if (!name) return;
    const parent = items.find(i => i.id === parentId)!;
    await addItem(parent.group_id, name, parentId);
    setExpandedItems(e => ({ ...e, [parentId]: true }));
  };

  // ─── DnD handlers ───────────────────────────────────────────────────────────
  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
    const type = active.data.current?.type;
    setActiveDragType(type);
    if (type === 'group') setActiveItem(groups.find(g => g.id === active.data.current?.groupId) || null);
    else if (type === 'item' || type === 'subtask') setActiveItem(items.find(i => i.id === active.id as string) || null);
    else if (type === 'column') setActiveItem(columns.find(c => c.id === active.id as string) || null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || activeDragType !== 'item') return;
    const overId = over.id as string;
    const activeItemObj = items.find(i => i.id === active.id as string);
    if (!activeItemObj) return;

    // Detect if over a different group (by group id or item in different group)
    const overGroup = groups.find(g => g.id === overId);
    const overItemObj = items.find(i => i.id === overId);
    const targetGroupId = overGroup?.id ?? overItemObj?.group_id;

    if (targetGroupId && targetGroupId !== activeItemObj.group_id) {
      // Optimistically move item to new group in store
      store.updateItem(activeItemObj.id, { group_id: targetGroupId } as never).catch(() => {});
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null); setActiveDragType(null); setActiveItem(null);
    if (!over) return;

    const type = active.data.current?.type;
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (type === 'group') {
      const activeGroupId = active.data.current?.groupId;
      const overGroupId = over.data.current?.groupId;
      if (!activeGroupId || !overGroupId || activeGroupId === overGroupId) return;
      const ids = sortedGroups.map(g => g.id);
      const oldIdx = ids.indexOf(activeGroupId);
      const newIdx = ids.indexOf(overGroupId);
      reorderGroups(arrayMove(ids, oldIdx, newIdx));
    }

    else if (type === 'item') {
      const itemObj = items.find(i => i.id === activeIdStr);
      if (!itemObj) return;
      const groupId = itemObj.group_id;
      const groupItemIds = topItems(groupId).map(i => i.id);
      const oldIdx = groupItemIds.indexOf(activeIdStr);
      const overInGroup = groupItemIds.includes(overIdStr);
      if (overInGroup) {
        const newIdx = groupItemIds.indexOf(overIdStr);
        reorderItems(groupId, arrayMove(groupItemIds, oldIdx, newIdx));
      }
    }

    else if (type === 'subtask') {
      const sub = items.find(i => i.id === activeIdStr);
      if (!sub?.parent_item_id) return;
      const siblingIds = subtasksOf(sub.parent_item_id).map(i => i.id);
      const oldIdx = siblingIds.indexOf(activeIdStr);
      const newIdx = siblingIds.indexOf(overIdStr);
      if (newIdx !== -1 && oldIdx !== newIdx) reorderItems(sub.group_id, arrayMove(siblingIds, oldIdx, newIdx));
    }

    else if (type === 'column') {
      const colIds = sortedColumns.map(c => c.id);
      const oldIdx = colIds.indexOf(activeIdStr);
      const newIdx = colIds.indexOf(overIdStr);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) reorderColumns(arrayMove(colIds, oldIdx, newIdx));
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  const totalWidth = NAME_COL_WIDTH + sortedColumns.reduce((s, c) => s + (colWidths[c.id] || DEFAULT_COL_WIDTH), 0) + 60;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: totalWidth }}>

          <SortableContext items={sortedGroups.map(g => `group-${g.id}`)} strategy={verticalListSortingStrategy}>
            {sortedGroups.map(group => {
              const groupItems = topItems(group.id);
              const collapsed = group.collapsed === 1;
              const filteredItems = groupItems.filter(item => applyGroupFilter(group.id, item));
              const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
              const page = Math.min(pageByGroup[group.id] || 0, pageCount - 1);
              const pagedItems = filteredItems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
              const setPage = (p: number) => setPageByGroup(s => ({ ...s, [group.id]: Math.max(0, Math.min(p, pageCount - 1)) }));

              const gIds = filteredItems.map(i => i.id);
              const gSel = gIds.filter(id => selected.has(id)).length;
              const gSelState: 'none' | 'some' | 'all' = gSel === 0 ? 'none' : gSel === gIds.length ? 'all' : 'some';

              return (
                <div key={group.id} className="mb-6">
                  <SortableGroupHeader
                    group={group} itemCount={groupItems.length} collapsed={collapsed}
                    filterActive={hasActiveFilter(group.id) || !!showFilters[group.id]}
                    onToggle={() => updateGroup(group.id, { collapsed: collapsed ? 0 : 1 } as never)}
                    onRename={name => updateGroup(group.id, { name })}
                    onColorChange={color => updateGroup(group.id, { color })}
                    onDelete={() => { if (confirm('Delete group?')) { deleteGroup(group.id); toast.success('Deleted'); } }}
                    onFilterToggle={() => setShowFilters(f => ({ ...f, [group.id]: !f[group.id] }))}
                    selectState={gSelState}
                    onToggleSelectAll={() => setGroupSelected(gIds, gSelState !== 'all')}
                  />

                  {!collapsed && (
                    <>
                      {/* Column header row */}
                      <div className="flex border-b border-gray-200 bg-white">
                        <div className="sticky left-0 z-10 bg-white border-r border-gray-200 flex items-center px-4 h-9 flex-shrink-0 text-xs font-medium text-gray-500" style={{ width: NAME_COL_WIDTH }}>
                          Item
                        </div>
                        <SortableContext items={sortedColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
                          {sortedColumns.map(col => (
                            <SortableColumnHeader key={col.id} col={col}
                              width={colWidths[col.id] || DEFAULT_COL_WIDTH}
                              sortDir={sortConfig?.colId === col.id ? sortConfig.dir : null}
                              onResize={startResize}
                              onSettings={setSettingsCol}
                              onDelete={c => { if (confirm(`Delete "${c.name}"?`)) deleteColumn(c.id); }}
                              onSort={handleSort}
                              onFilterOpen={handleFilterOpen}
                              onSummarize={handleSummarize}
                            />
                          ))}
                        </SortableContext>
                        <div className="flex items-center px-2 h-9 flex-shrink-0">
                          <button onClick={() => setShowAddCol(true)} className="text-xs text-gray-400 hover:text-monday-blue px-2 py-1 rounded hover:bg-gray-100 whitespace-nowrap">+ Add</button>
                        </div>
                      </div>

                      {/* Filter row */}
                      {showFilters[group.id] && (
                        <div className="flex border-b border-blue-200 bg-blue-50/40">
                          <div className="sticky left-0 z-10 bg-blue-50/60 border-r border-blue-200 flex items-center gap-2 px-3 h-9 flex-shrink-0" style={{ width: NAME_COL_WIDTH }}>
                            <Filter size={12} className="text-monday-blue flex-shrink-0" />
                            <input
                              value={groupFilters[group.id]?.name ?? ''}
                              onChange={e => setNameFilter(group.id, e.target.value)}
                              placeholder="Search items…"
                              className="flex-1 text-xs bg-transparent outline-none placeholder-gray-400"
                            />
                            {hasActiveFilter(group.id) && (
                              <button onClick={() => clearGroupFilter(group.id)}
                                className="flex-shrink-0 text-gray-400 hover:text-red-500">
                                <X size={11} />
                              </button>
                            )}
                          </div>
                          {sortedColumns.map(col => {
                            const w = colWidths[col.id] || DEFAULT_COL_WIDTH;
                            const isOptionType = col.type === 'status' || col.type === 'priority';
                            const opts = Array.isArray(col.settings?.options) ? col.settings.options : [];
                            const val = groupFilters[group.id]?.cols?.[col.id] ?? '';
                            return (
                              <div key={col.id} style={{ width: w, minWidth: w }}
                                className="h-9 border-r border-blue-100 flex-shrink-0 flex items-center px-2 gap-1">
                                {isOptionType ? (
                                  <OptionFilterDropdown
                                    opts={opts}
                                    value={val}
                                    onChange={v => setColFilter(group.id, col.id, v)}
                                  />
                                ) : (
                                  <input
                                    data-filter-col={col.id}
                                    value={val}
                                    onChange={e => setColFilter(group.id, col.id, e.target.value)}
                                    placeholder="Filter…"
                                    className="w-full text-xs bg-transparent outline-none placeholder-gray-400 border-b border-transparent focus:border-monday-blue"
                                  />
                                )}
                              </div>
                            );
                          })}
                          <div className="flex-1" />
                        </div>
                      )}

                      {/* Items */}
                      <SortableContext items={pagedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                        {pagedItems.map(item => {
                          const subs = subtasksOf(item.id);
                          const isExpanded = !!expandedItems[item.id];
                          return (
                            <div key={item.id}>
                              <SortableItemRow
                                item={item} group={group} columns={sortedColumns} board={board}
                                colWidths={colWidths}
                                onOpen={() => setSelectedItem(item)}
                                onDelete={() => deleteItem(item.id)}
                                onValueChange={(colId, val) => updateItemValue(item.id, colId, val)}
                                subtaskCount={subs.length}
                                expanded={isExpanded}
                                onToggleExpand={() => setExpandedItems(e => ({ ...e, [item.id]: !e[item.id] }))}
                                onAddSubtask={() => { setNewSubtaskFor(item.id); setNewSubtaskName(''); setExpandedItems(e => ({ ...e, [item.id]: true })); }}
                                hasSubtasks={subs.length > 0}
                                demoteTargets={filteredItems.filter(t => t.id !== item.id).map(t => ({ id: t.id, name: t.name }))}
                                onDemote={pid => changeParent(item.id, pid)}
                                templates={tplList}
                                onRunTemplate={id => runTpl(id, item.id)}
                                selected={selected.has(item.id)}
                                onToggleSelect={() => toggleSelect(item.id)}
                              />
                              {/* Subtask add row — always shown on hover */}
                              {newSubtaskFor === item.id ? (
                                <div className="flex items-center gap-2 h-8 border-b border-gray-100 bg-blue-50/40"
                                  style={{ paddingLeft: 48 }}>
                                  <div className="w-1 h-4 rounded flex-shrink-0" style={{ backgroundColor: group.color }} />
                                  <input autoFocus value={newSubtaskName} onChange={e => setNewSubtaskName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask(item.id); }
                                      if (e.key === 'Escape') { setNewSubtaskFor(null); setNewSubtaskName(''); }
                                    }}
                                    placeholder="Subtask name… (Enter to save, Esc to cancel)"
                                    className="flex-1 text-sm outline-none border-b border-monday-blue bg-transparent pr-4" />
                                </div>
                              ) : null}
                              {/* Expanded subtask rows */}
                              {isExpanded && (
                                <div className="border-b border-gray-100">
                                  <SortableContext items={subs.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                    {subs.map(sub => (
                                      <SortableItemRow key={sub.id} item={sub} group={group} columns={sortedColumns}
                                        board={board} colWidths={colWidths} isSubtask
                                        onOpen={() => setSelectedItem(sub)}
                                        onDelete={() => deleteItem(sub.id)}
                                        onValueChange={(colId, val) => updateItemValue(sub.id, colId, val)}
                                        onPromote={() => changeParent(sub.id, null)}
                                        templates={tplList}
                                        onRunTemplate={id => runTpl(id, sub.id)}
                                        selected={selected.has(sub.id)}
                                        onToggleSelect={() => toggleSelect(sub.id)}
                                      />
                                    ))}
                                  </SortableContext>
                                  <button onClick={() => { setNewSubtaskFor(item.id); setNewSubtaskName(''); }}
                                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-monday-blue py-1.5"
                                    style={{ paddingLeft: 52 }}>
                                    <Plus size={11} /> Add subtask
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </SortableContext>

                      {/* Pagination — 100 rows at a time. Sticky to the left so the
                          controls stay visible no matter how wide the board scrolls. */}
                      {pageCount > 1 && (
                        <div className="border-b border-gray-100 bg-gray-50/60">
                          <div className="sticky left-0 w-fit max-w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-600 flex-wrap">
                            <span className="whitespace-nowrap">
                              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredItems.length)} of {filteredItems.length}
                            </span>
                            <div className="flex items-center gap-1">
                              <button onClick={() => setPage(page - 1)} disabled={page === 0}
                                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40">‹</button>
                              {(() => {
                                // Windowed page numbers: always show first & last, a window
                                // around the current page, and … gaps between.
                                const nums: number[] = [];
                                for (let i = 0; i < pageCount; i++) {
                                  if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) nums.push(i);
                                }
                                const out: React.ReactNode[] = [];
                                let prev = -1;
                                for (const i of nums) {
                                  if (prev >= 0 && i - prev > 1) out.push(<span key={`g${i}`} className="px-1 text-gray-400">…</span>);
                                  out.push(
                                    <button key={i} onClick={() => setPage(i)}
                                      className={`min-w-7 px-2 py-1 rounded ${i === page ? 'bg-monday-blue text-white' : 'hover:bg-gray-200'}`}>
                                      {i + 1}
                                    </button>
                                  );
                                  prev = i;
                                }
                                return out;
                              })()}
                              <button onClick={() => setPage(page + 1)} disabled={page >= pageCount - 1}
                                className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-40">›</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Add item row */}
                      {newItemGroup === group.id ? (
                        <div className="bg-white">
                          <div className="sticky left-0 w-fit flex items-center gap-2 h-9 border-b border-gray-100 bg-white" style={{ paddingLeft: 20, paddingRight: 16 }}>
                            <div className="w-1 h-5 rounded" style={{ backgroundColor: group.color }} />
                            <input autoFocus value={newItemName} onChange={e => setNewItemName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddItem(group.id); if (e.key === 'Escape') { setNewItemGroup(null); setNewItemName(''); } }}
                              onBlur={() => handleAddItem(group.id)}
                              placeholder="Item name…" className="flex-1 text-sm outline-none border-b border-monday-blue min-w-48" />
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white">
                          <button onClick={() => { setNewItemGroup(group.id); setNewItemName(''); }}
                            className="sticky left-0 flex items-center gap-2 text-xs text-gray-400 hover:text-monday-blue py-1.5 px-4 bg-white">
                            <Plus size={13} /> Add Item
                          </button>
                        </div>
                      )}

                      {/* Summary footer — per-column totals over the whole group */}
                      {sortedColumns.some(c => (c.settings as { summary?: SummaryType })?.summary) && (
                        <div className="flex border-t-2 border-gray-200 bg-gray-50/80 text-xs">
                          <div className="sticky left-0 z-10 flex items-center border-r border-gray-200 h-8 flex-shrink-0 bg-gray-50 font-medium text-gray-500 px-4" style={{ width: NAME_COL_WIDTH }}>
                            Summary
                          </div>
                          {sortedColumns.map(col => {
                            const w = colWidths[col.id] || DEFAULT_COL_WIDTH;
                            const s = (col.settings as { summary?: SummaryType })?.summary;
                            const text = s ? computeSummary(s, filteredItems.map(it => getValue(it.id, col.id))) : '';
                            return (
                              <div key={col.id} style={{ width: w, minWidth: w }}
                                className="h-8 border-r border-gray-100 flex-shrink-0 flex flex-col items-center justify-center px-2 overflow-hidden">
                                {s && <>
                                  <span className="font-semibold text-gray-700 truncate max-w-full leading-tight">{text}</span>
                                  <span className="text-[10px] text-gray-400 leading-tight">{SUMMARY_LABELS[s]}</span>
                                </>}
                              </div>
                            );
                          })}
                          <div className="flex-1" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </SortableContext>

          <div className="bg-white">
            <button onClick={() => addGroup(`Group ${sortedGroups.length + 1}`)}
              className="sticky left-0 flex items-center gap-2 text-sm text-gray-500 hover:text-monday-blue py-2 px-4 bg-white">
              <Plus size={15} /> Add Group
            </button>
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeId && activeDragType === 'item' && activeItem && (
          <div className="flex items-center bg-white shadow-xl rounded border border-monday-blue/30 h-9 px-4 opacity-90" style={{ width: NAME_COL_WIDTH }}>
            <GripVertical size={13} className="text-gray-400 mr-2" />
            <span className="text-sm text-gray-800 truncate">{(activeItem as Item).name}</span>
          </div>
        )}
        {activeId && activeDragType === 'group' && activeItem && (
          <div className="flex items-center bg-gray-100 shadow-xl rounded border border-gray-300 h-9 px-4 opacity-90 gap-2">
            <GripVertical size={14} className="text-gray-400" />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: (activeItem as Group).color }} />
            <span className="font-semibold text-sm">{(activeItem as Group).name}</span>
          </div>
        )}
        {activeId && activeDragType === 'column' && activeItem && (
          <div className="flex items-center justify-center bg-white shadow-xl rounded border border-monday-blue/30 h-9 px-3 opacity-90" style={{ width: colWidths[(activeItem as Column).id] || DEFAULT_COL_WIDTH }}>
            <span className="text-xs font-medium text-gray-600">{(activeItem as Column).name}</span>
          </div>
        )}
      </DragOverlay>

      {selectedItem && <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {showAddCol && <AddColumnModal onClose={() => setShowAddCol(false)} />}
      {settingsCol && <ColumnSettingsModal column={settingsCol} onClose={() => setSettingsCol(null)} />}

      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-white shadow-2xl border border-gray-200 rounded-xl px-4 py-2.5 max-w-[95vw] flex-wrap">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span className="bg-monday-blue text-white rounded-full w-6 h-6 flex items-center justify-center text-xs">{selected.size}</span>
            selected
          </span>
          <div className="h-5 w-px bg-gray-200" />
          <span className="text-sm text-gray-500">Set</span>
          <select value={bulkColId} onChange={e => { setBulkColId(e.target.value); setBulkValue(''); }}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 max-w-[150px]">
            <option value="">column…</option>
            {(board?.columns || [])
              .filter(c => !['formula', 'time_tracking', 'attachments', 'person', 'timeline'].includes(c.type))
              .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {bulkCol && (bulkCol.type === 'status' || bulkCol.type === 'priority') ? (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">(empty)</option>
              {(bulkCol.settings?.options || []).map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
            </select>
          ) : bulkCol && bulkCol.type === 'checkbox' ? (
            <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">(unset)</option>
              <option value="true">Checked</option>
              <option value="false">Unchecked</option>
            </select>
          ) : bulkCol ? (
            <input value={bulkValue} onChange={e => setBulkValue(e.target.value)}
              type={bulkCol.type === 'number' ? 'number' : bulkCol.type === 'date' ? 'date' : 'text'}
              placeholder="value" className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-36" />
          ) : null}

          <button onClick={applyBulkValue} disabled={!bulkColId || bulkBusy}
            className="text-sm bg-monday-blue text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-40">
            {bulkBusy ? 'Applying…' : 'Apply'}
          </button>

          {linkableCols.length > 0 && (
            <>
              <div className="h-5 w-px bg-gray-200" />
              <span className="text-sm text-gray-500">Open links from</span>
              <select value={openColId} onChange={e => setOpenColId(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 max-w-[150px]">
                <option value="">field…</option>
                {linkableCols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={bulkOpenLinks} disabled={!openColId}
                className="flex items-center gap-1 text-sm bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-40">
                <ExternalLink size={14} /> Open
              </button>
            </>
          )}

          <div className="h-5 w-px bg-gray-200" />
          <button onClick={bulkDelete} disabled={bulkBusy}
            className="flex items-center gap-1 text-sm text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg disabled:opacity-40">
            <Trash2 size={14} /> Delete
          </button>
          <button onClick={clearSelection} className="flex items-center gap-1 text-sm text-gray-500 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg">
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* ── Blocked-links fallback ───────────────────────────────────────── */}
      {blockedLinks.length > 0 && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={() => setBlockedLinks([])}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2"><ExternalLink size={16} /> Your browser blocked {blockedLinks.length} tab{blockedLinks.length > 1 ? 's' : ''}</h3>
              <p className="text-xs text-gray-500 mt-1">Click a link below to open it. To open them all automatically next time, allow pop-ups for this site in your browser's address bar.</p>
            </div>
            <div className="overflow-auto px-5 py-3 space-y-1">
              {blockedLinks.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-monday-blue hover:underline py-1.5 truncate">
                  <ExternalLink size={13} className="flex-shrink-0" /><span className="truncate">{u.replace(/^https?:\/\//, '')}</span>
                </a>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button onClick={() => setBlockedLinks([])} className="text-sm text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg">Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </DndContext>
  );
}
