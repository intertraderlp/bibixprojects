import { useState } from 'react';
import { useBoardStore } from '../../store/boardStore';
import Modal from '../ui/Modal';
import type { ColumnType } from '../../types';
import { Hash, Type, Calendar, User, CheckSquare, Tag, Link, Star, Paperclip, Calculator } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

const COLUMN_TYPES: { type: ColumnType; label: string; icon: React.ReactNode; desc: string }[] = [
  { type: 'text', label: 'Text', icon: <Type size={18} />, desc: 'Free-form text' },
  { type: 'status', label: 'Status', icon: <Star size={18} />, desc: 'Colored status labels' },
  { type: 'priority', label: 'Priority', icon: <Star size={18} />, desc: 'Priority levels' },
  { type: 'person', label: 'Person', icon: <User size={18} />, desc: 'Assign team members' },
  { type: 'date', label: 'Date', icon: <Calendar size={18} />, desc: 'Date picker' },
  { type: 'number', label: 'Number', icon: <Hash size={18} />, desc: 'Numeric values' },
  { type: 'checkbox', label: 'Checkbox', icon: <CheckSquare size={18} />, desc: 'Yes / No' },
  { type: 'tags', label: 'Tags', icon: <Tag size={18} />, desc: 'Multi-tag labels' },
  { type: 'link', label: 'Link', icon: <Link size={18} />, desc: 'URL links' },
  { type: 'attachments', label: 'Attachments', icon: <Paperclip size={18} />, desc: 'Files & images' },
  { type: 'formula', label: 'Formula', icon: <Calculator size={18} />, desc: 'Compute from columns' },
];

export default function AddColumnModal({ onClose }: Props) {
  const { addColumn, board } = useBoardStore();
  const [selectedType, setSelectedType] = useState<ColumnType>('text');
  const [name, setName] = useState('');
  const [formula, setFormula] = useState('');

  const handleAdd = async () => {
    const colName = name.trim() || COLUMN_TYPES.find(c => c.type === selectedType)?.label || 'Column';
    await addColumn(colName, selectedType, selectedType === 'formula' ? { formula } : undefined);
    toast.success('Column added');
    onClose();
  };

  return (
    <Modal title="Add Column" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Column Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Column name (optional)"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Column Type</label>
          <div className="grid grid-cols-2 gap-2">
            {COLUMN_TYPES.map(ct => (
              <button key={ct.type} onClick={() => setSelectedType(ct.type)}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${selectedType === ct.type ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className={selectedType === ct.type ? 'text-monday-blue' : 'text-gray-500'}>{ct.icon}</span>
                <div>
                  <div className="text-sm font-medium text-gray-900">{ct.label}</div>
                  <div className="text-xs text-gray-400">{ct.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {selectedType === 'formula' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Formula</label>
            <textarea value={formula} onChange={e => setFormula(e.target.value)} rows={2}
              placeholder="{Price} * {Qty}"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            <p className="text-xs text-gray-400 mt-1">Use {'{Column name}'} refs. Functions: IF, ROUND, SUM, MIN, MAX, CONCAT… (edit later in column settings).</p>
            {board && board.columns.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {board.columns.map(c => (
                  <button key={c.id} type="button" onClick={() => setFormula(f => `${f}{${c.name}}`)}
                    className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:border-monday-blue hover:text-monday-blue">
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleAdd} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Add Column</button>
        </div>
      </div>
    </Modal>
  );
}
