import { useState } from 'react';
import {
  Plus, Trash2, GripVertical, AlertTriangle,
  Type, Star, Flag, User, Calendar, Hash, CheckSquare,
  Tag, Link, Paperclip, ArrowRight, Calculator, Timer,
} from 'lucide-react';
import { useBoardStore } from '../../store/boardStore';
import type { Column, ColumnType, StatusOption } from '../../types';
import Modal from '../ui/Modal';
import FormulaEditor from './FormulaEditor';
import toast from 'react-hot-toast';

interface Props { column: Column; onClose: () => void; }

// ── Column type definitions ────────────────────────────────────────────────────

const COLUMN_TYPES: { type: ColumnType; label: string; icon: React.ReactNode }[] = [
  { type: 'text',        label: 'Text',        icon: <Type size={14} />        },
  { type: 'status',      label: 'Status',      icon: <Star size={14} />        },
  { type: 'priority',    label: 'Priority',    icon: <Flag size={14} />        },
  { type: 'date',        label: 'Date',        icon: <Calendar size={14} />    },
  { type: 'number',      label: 'Number',      icon: <Hash size={14} />        },
  { type: 'checkbox',    label: 'Checkbox',    icon: <CheckSquare size={14} /> },
  { type: 'tags',        label: 'Tags',        icon: <Tag size={14} />         },
  { type: 'link',        label: 'Link',        icon: <Link size={14} />        },
  { type: 'timeline',    label: 'Timeline',    icon: <ArrowRight size={14} />  },
  { type: 'person',      label: 'Person',      icon: <User size={14} />        },
  { type: 'attachments', label: 'Attachments', icon: <Paperclip size={14} />   },
  { type: 'formula',     label: 'Formula',     icon: <Calculator size={14} />  },
  { type: 'time_tracking', label: 'Time',      icon: <Timer size={14} />       },
];

// ── Default options for status/priority ───────────────────────────────────────

const DEFAULT_OPTIONS: Record<string, StatusOption[]> = {
  status: [
    { label: 'Done',          color: '#00c875' },
    { label: 'Working on it', color: '#fdab3d' },
    { label: 'Stuck',         color: '#e2445c' },
    { label: 'Not started',   color: '#c4c4c4' },
  ],
  priority: [
    { label: 'Critical', color: '#333333' },
    { label: 'High',     color: '#401694' },
    { label: 'Medium',   color: '#fdab3d' },
    { label: 'Low',      color: '#579bfc' },
  ],
};

const PRESET_COLORS = [
  '#00c875','#fdab3d','#e2445c','#0073ea','#a25ddc','#037f4c',
  '#bb3354','#ff642e','#9aadbd','#333333','#ffcb00','#7f5347',
  '#66ccff','#ff3399','#00aaff','#aabb00',
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ColumnSettingsModal({ column, onClose }: Props) {
  const { updateColumn, board } = useBoardStore();

  const [name, setName]       = useState(column.name);
  const [type, setType]       = useState<ColumnType>(column.type);
  const [formula, setFormula] = useState<string>((column.settings as { formula?: string })?.formula || '');
  const [options, setOptions] = useState<StatusOption[]>(
    Array.isArray(column.settings?.options) ? [...column.settings.options] : []
  );
  const [saving, setSaving]   = useState(false);

  const typeChanged    = type !== column.type;
  const isOptionType   = type === 'status' || type === 'priority';
  const isFormula      = type === 'formula';
  const otherColumns   = (board?.columns || []).filter(c => c.id !== column.id);

  // When user picks a new type, seed default options if switching TO status/priority
  const handleTypeChange = (newType: ColumnType) => {
    setType(newType);
    if (
      (newType === 'status' || newType === 'priority') &&
      !(column.type === 'status' || column.type === 'priority')
    ) {
      setOptions(DEFAULT_OPTIONS[newType] ?? []);
    }
  };

  // Option helpers
  const addOption = () => {
    const usedColors = new Set(options.map(o => o.color));
    const color = PRESET_COLORS.find(c => !usedColors.has(c)) ?? '#9aadbd';
    setOptions(o => [...o, { label: 'New Option', color }]);
  };

  const updateOption = (i: number, field: 'label' | 'color', value: string) =>
    setOptions(opts => opts.map((o, idx) => idx === i ? { ...o, [field]: value } : o));

  const removeOption = (i: number) =>
    setOptions(opts => opts.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateColumn(column.id, {
        name:     name.trim() || column.name,
        type,
        settings: isFormula ? { formula } : isOptionType ? { ...column.settings, options } : {},
      });
      toast.success('Column updated');
      onClose();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit Column: ${column.name}`} onClose={onClose} size="md">
      <div className="p-6 space-y-5">

        {/* ── Name ──────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
            Column Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue"
          />
        </div>

        {/* ── Type selector ─────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
            Column Type
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {COLUMN_TYPES.map(ct => {
              const active = type === ct.type;
              return (
                <button
                  key={ct.type}
                  onClick={() => handleTypeChange(ct.type)}
                  className={[
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm font-medium transition-colors',
                    active
                      ? 'border-monday-blue bg-blue-50 text-monday-blue'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span className={active ? 'text-monday-blue' : 'text-gray-400'}>
                    {ct.icon}
                  </span>
                  {ct.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Type-change warning ────────────────────────────────────────── */}
        {typeChanged && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              Changing the column type may affect how existing cell values are displayed. The values themselves are preserved — only the display format will change.
            </p>
          </div>
        )}

        {/* ── Options editor (status / priority) ────────────────────────── */}
        {isOptionType && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
              Options
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <GripVertical size={14} className="text-gray-300 flex-shrink-0" />

                  {/* Color swatch + picker */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-7 h-7 rounded cursor-pointer border-2 border-white shadow-sm hover:scale-110 transition-transform"
                      style={{ backgroundColor: opt.color }}
                      onClick={e => {
                        const popup = e.currentTarget.nextSibling as HTMLElement;
                        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
                      }}
                    />
                    <div
                      className="absolute z-50 top-8 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1"
                      style={{ display: 'none' }}
                    >
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={e => {
                            updateOption(i, 'color', c);
                            const grid = (e.currentTarget.closest('.grid') as HTMLElement);
                            (grid.parentElement as HTMLElement).style.display = 'none';
                          }}
                          className={`w-6 h-6 rounded hover:scale-110 transition-transform ${opt.color === c ? 'ring-2 ring-offset-1 ring-gray-500' : ''}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Label */}
                  <input
                    value={opt.label}
                    onChange={e => updateOption(i, 'label', e.target.value)}
                    className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-monday-blue"
                  />

                  {/* Delete */}
                  <button
                    onClick={() => removeOption(i)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 rounded flex-shrink-0 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addOption}
              className="mt-3 flex items-center gap-2 text-sm text-monday-blue hover:text-blue-700 font-medium"
            >
              <Plus size={15} /> Add Option
            </button>
          </div>
        )}

        {/* ── Formula editor ─────────────────────────────────────────────── */}
        {isFormula && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
              Formula
            </label>
            <FormulaEditor value={formula} onChange={setFormula} columns={otherColumns} />
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
