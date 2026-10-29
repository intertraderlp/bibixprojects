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
import { Plus, ChevronDown, ChevronRight, MoreHorizontal, Trash2, GripVertical, Settings, ChevronUp, Filter, X, ArrowUpAZ, ArrowDownAZ, ArrowUp, ArrowDown } from 'lucide-react';
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

function SortableColumnHeader({ col, width, sortDir, onResize, onSettings, onDelete, onSort, onFilterOpen }: {
  col: Column; width: number; sortDir?: 'asc' | 'desc' | null;
  onResize: (colId: string, e: React.PointerEvent) => void;
  onSettings: (col: Column) => void;
  onDelete: (col: Column) => void;
  onSort: (colId: string, dir: 'asc' | 'desc') => void;
  onFilterOpen: (colId: string) => void;
}) {
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
        <DropdownItem onClick={() => onSettings(col)}><Settings size={13} /> Edit Column</DropdownItem>
        <DropdownItem danger onClick={() => onDelete(col)}><Trash2 size={13} /> Delete</DropdownItem>
      </Dropdown>
      <div onPointerDown={e => onResize(col.id, e)}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-monday-blue/40 transition-colors" />
    </div>
  );
}

function SortableGroupHeader({ group, itemCount, collapsed, filterActive, onToggle, onRename, onColorChange, onDelete, onFilterToggle }: {
  group: Group; itemCount: number; collapsed: boolean; filterActive: boolean;
  onToggle: () => void; onRename: (name: string) => void;
  onColorChange: (color: string) => void; onDelete: () => void; onFilterToggle: () => void;
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

function SortableItemRow({ item, group, columns, board, colWidths, onOpen, onDelete, onValueChange, isSubtask, subtaskCount, expanded, onToggleExpand, onAddSubtask }: {
  item: Item; group: Group; columns: Column[];
  board: { workspace_id: string }; colWidths: Record<string, number>;
  onOpen: () => void; onDelete: () => void;
  onValueChange: (colId: string, val: string | null) => void;
  isSubtask?: boolean; subtaskCount?: number;
  expanded?: boolean; onToggleExpand?: () => void; onAddSubtask?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, data: { type: isSubtask ? 'subtask' : 'item', groupId: item.group_id, parentId: item.parent_item_id }
  });
  const { getValue } = useBoardStore();

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`flex border-b border-gray-100 hover:bg-gray-50 group ${isSubtask ? 'bg-gray-50/50' : 'bg-white'}`}>
      {/* Grip + Name col (sticky) */}
      <div className={`sticky left-0 z-10 flex items-center gap-1 border-r border-gray-200 h-9 flex-shrink-0 ${isSubtask ? 'bg-gray-50' : 'bg-white'} group-hover:bg-gray-50`} style={{ width: NAME_COL_WIDTH }}>
        <span {...attributes} {...listeners} className="cursor-grab text-gray-200 hover:text-gray-400 pl-2 flex-shrink-0"><GripVertical size={13} /></span>
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
  const { board, addItem, deleteItem, addGroup, updateGroup, deleteGroup, updateItemValue, deleteColumn, reorderGroups, reorderItems, reorderColumns } = store;

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
    </DndContext>
  );
}
