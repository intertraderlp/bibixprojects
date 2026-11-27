import { useState } from 'react';
import { Eye, Pencil, Copy } from 'lucide-react';
import Modal from '../ui/Modal';
import toast from 'react-hot-toast';

interface Props {
  value: string | null;
  onChange: (value: string | null) => void;
}

export default function TextCell({ value, onChange }: Props) {
  const [inline, setInline] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [preview, setPreview] = useState(false);
  const [editPopup, setEditPopup] = useState(false);
  const text = value || '';

  const commitInline = () => { setInline(false); if (draft !== text) onChange(draft || null); };
  const savePopup = () => { setEditPopup(false); if (draft !== text) onChange(draft || null); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); }
    catch { toast.error('Copy failed'); }
  };

  if (inline) {
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commitInline}
        onKeyDown={e => { if (e.key === 'Enter') commitInline(); if (e.key === 'Escape') { setDraft(text); setInline(false); } }}
        className="w-full h-full px-2 text-sm outline-none bg-white border border-monday-blue" />
    );
  }

  return (
    <div className="relative w-full h-full group/tc flex items-center">
      <div onClick={() => { setDraft(text); setInline(true); }}
        className="flex-1 min-w-0 px-2 h-full flex items-center text-sm text-gray-700 cursor-text hover:bg-gray-50 truncate">
        {text}
      </div>

      {text && (
        <div className="absolute right-0 top-0 h-full hidden group-hover/tc:flex items-center gap-0.5 pl-4 pr-1 bg-gradient-to-l from-white via-white to-transparent">
          <button onClick={e => { e.stopPropagation(); setPreview(true); }} title="Preview"
            className="p-1 rounded text-gray-400 hover:text-monday-blue hover:bg-gray-100"><Eye size={13} /></button>
          <button onClick={e => { e.stopPropagation(); setDraft(text); setEditPopup(true); }} title="Edit"
            className="p-1 rounded text-gray-400 hover:text-monday-blue hover:bg-gray-100"><Pencil size={13} /></button>
          <button onClick={e => { e.stopPropagation(); copy(); }} title="Copy to clipboard"
            className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-gray-100"><Copy size={13} /></button>
        </div>
      )}

      {preview && (
        <Modal title="Preview" onClose={() => setPreview(false)} size="md">
          <div className="p-5">
            <div className="whitespace-pre-wrap break-words text-sm text-gray-800 max-h-[60vh] overflow-auto border border-gray-100 rounded-lg p-3 bg-gray-50">
              {text}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                <Copy size={14} /> Copy
              </button>
              <button onClick={() => { setDraft(text); setPreview(false); setEditPopup(true); }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">
                <Pencil size={14} /> Edit
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editPopup && (
        <Modal title="Edit text" onClose={() => setEditPopup(false)} size="md">
          <div className="p-5">
            <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} rows={12}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) savePopup(); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            <div className="flex justify-between items-center mt-3">
              <button onClick={copy} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800">
                <Copy size={14} /> Copy
              </button>
              <div className="flex gap-2">
                <button onClick={() => setEditPopup(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={savePopup} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Save</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
