import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import api from '../../api/client';
import toast from 'react-hot-toast';

// Copy this board's column layout onto another existing board.
export default function CopyStructureModal({ sourceBoardId, sourceBoardName, onClose }: {
  sourceBoardId: string; sourceBoardName: string; onClose: () => void;
}) {
  const { workspaces, boards, sharedBoards } = useWorkspaceStore();
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);

  // Flat list of boards the user can target (everything except the source).
  const groups = workspaces
    .map(ws => ({ label: ws.name, boards: (boards[ws.id] || []).filter(b => b.id !== sourceBoardId) }))
    .filter(g => g.boards.length > 0);
  const shared = (sharedBoards || []).filter(b => b.id !== sourceBoardId);

  const run = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/boards/${sourceBoardId}/copy-structure`, { targetBoardId: targetId });
      const parts: string[] = [];
      if (data.added > 0) parts.push(`added ${data.added} column${data.added > 1 ? 's' : ''}`);
      if (data.updated > 0) parts.push(`updated ${data.updated}`);
      toast.success(parts.length ? `Copied format — ${parts.join(', ')}` : 'That board already matches this layout');
      onClose();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Could not copy structure');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Copy columns to another board" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <p className="text-sm text-gray-500">
          Copy the column layout of <span className="font-medium text-gray-700">{sourceBoardName}</span> onto another board.
          New columns are added; columns that board already has (same name &amp; type) keep their place but get this board&apos;s
          options (status / priority / checkbox choices). Rows and values aren&apos;t touched.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Target board</label>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue">
            <option value="">Select a board…</option>
            {groups.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.boards.map(b => <option key={b.id} value={b.id}>{b.icon} {b.name}</option>)}
              </optgroup>
            ))}
            {shared.length > 0 && (
              <optgroup label="Shared with me">
                {shared.map(b => <option key={b.id} value={b.id}>{b.icon} {b.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={run} disabled={!targetId || busy}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />} Copy columns
          </button>
        </div>
      </div>
    </Modal>
  );
}
