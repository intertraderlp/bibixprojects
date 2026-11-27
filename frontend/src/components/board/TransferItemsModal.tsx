import { useEffect, useState } from 'react';
import { Copy, CornerUpRight, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import api from '../../api/client';
import toast from 'react-hot-toast';

// Copy or move the selected items (with subtasks + values) to another board.
export default function TransferItemsModal({ itemIds, currentBoardId, defaultMode, onClose, onDone }: {
  itemIds: string[];
  currentBoardId: string;
  defaultMode: 'copy' | 'move';
  onClose: () => void;
  onDone: () => void;
}) {
  const { workspaces, boards, sharedBoards } = useWorkspaceStore();
  const [mode, setMode] = useState<'copy' | 'move'>(defaultMode);
  const [targetId, setTargetId] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupId, setGroupId] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [busy, setBusy] = useState(false);

  const groupsByWs = workspaces
    .map(ws => ({ label: ws.name, boards: (boards[ws.id] || []).filter(b => b.id !== currentBoardId) }))
    .filter(g => g.boards.length > 0);
  const shared = (sharedBoards || []).filter(b => b.id !== currentBoardId);

  // Load the chosen board's groups so the user can pick a destination group.
  useEffect(() => {
    if (!targetId) { setGroups([]); setGroupId(''); return; }
    setLoadingGroups(true);
    api.get(`/boards/${targetId}`)
      .then(({ data }) => {
        const g = (data.groups || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name }));
        setGroups(g);
        setGroupId(g[0]?.id || '');
      })
      .catch(() => setGroups([]))
      .finally(() => setLoadingGroups(false));
  }, [targetId]);

  const run = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      const { data } = await api.post('/items/transfer', {
        itemIds, targetBoardId: targetId, targetGroupId: groupId || undefined, mode,
      });
      const n = data.count || 0;
      const created = (data.columnsCreated || []).length;
      toast.success(
        `${mode === 'copy' ? 'Copied' : 'Moved'} ${n} item${n !== 1 ? 's' : ''}` +
        (created > 0 ? ` · created ${created} column${created > 1 ? 's' : ''} on the target` : '')
      );
      onDone();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Transfer failed');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`${mode === 'copy' ? 'Copy' : 'Move'} ${itemIds.length} item${itemIds.length !== 1 ? 's' : ''} to another board`} onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        {/* Copy / Move toggle */}
        <div className="flex gap-2">
          <button onClick={() => setMode('copy')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg border ${mode === 'copy' ? 'border-monday-blue bg-blue-50 text-monday-blue font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <Copy size={14} /> Copy
          </button>
          <button onClick={() => setMode('move')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg border ${mode === 'move' ? 'border-monday-blue bg-blue-50 text-monday-blue font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <CornerUpRight size={14} /> Move
          </button>
        </div>

        <p className="text-xs text-gray-500">
          {mode === 'copy'
            ? 'A copy is added to the target board. Subtasks and cell values come along.'
            : 'The items are removed from this board and placed on the target. Subtasks and values come along.'}
          {' '}Columns are matched by name &amp; type; any missing ones are created on the target so nothing is lost.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Target board</label>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue">
            <option value="">Select a board…</option>
            {groupsByWs.map(g => (
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

        {targetId && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Destination group</label>
            {loadingGroups ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 size={14} className="animate-spin" /> Loading groups…</div>
            ) : (
              <select value={groupId} onChange={e => setGroupId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue">
                {groups.length === 0 && <option value="">First group (auto)</option>}
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={run} disabled={!targetId || busy}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : (mode === 'copy' ? <Copy size={15} /> : <CornerUpRight size={15} />)}
            {mode === 'copy' ? 'Copy here' : 'Move here'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
