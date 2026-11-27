import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Pencil, Copy, Sparkles, Wand2 } from 'lucide-react';
import api from '../../api/client';
import { useBoardStore } from '../../store/boardStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { MessageTemplate } from '../../types';
import Modal from '../ui/Modal';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

const EMPTY = { id: '', name: '', target_column: '', body: '', ai_provider: '', apply_styling: false };

export default function TemplatesPanel({ onClose }: Props) {
  const { board, templates, loadTemplates } = useBoardStore();
  const { boards, sharedBoards } = useWorkspaceStore();
  const [providers, setProviders] = useState<{ id: string; display: string }[]>([]);
  const [editing, setEditing] = useState<typeof EMPTY | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (board) loadTemplates(board.id); }, [board?.id]);
  useEffect(() => { api.get('/ai/catalog').then(r => setProviders(r.data || [])).catch(() => {}); }, []);

  const allBoards = [...Object.values(boards).flat(), ...sharedBoards]
    .filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i);

  const columns = board?.columns || [];

  const startNew = () => setEditing({ ...EMPTY });
  const startEdit = (t: MessageTemplate) => setEditing({
    id: t.id, name: t.name, target_column: t.target_column, body: t.body,
    ai_provider: t.ai_provider || '', apply_styling: !!t.apply_styling,
  });

  const insertAtCursor = (text: string) => {
    const el = bodyRef.current;
    const cur = editing?.body || '';
    if (!el) { setEditing(e => e && { ...e, body: cur + text }); return; }
    const s = el.selectionStart ?? cur.length, e2 = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, s) + text + cur.slice(e2);
    setEditing(e => e && { ...e, body: next });
    requestAnimationFrame(() => { el.focus(); const p = s + text.length; el.setSelectionRange(p, p); });
  };

  const save = async () => {
    if (!board || !editing) return;
    if (!editing.name.trim()) { toast.error('Name the template'); return; }
    const payload = {
      board_id: board.id, name: editing.name.trim(), target_column: editing.target_column.trim(),
      body: editing.body, ai_provider: editing.ai_provider || null, apply_styling: editing.apply_styling,
    };
    try {
      if (editing.id) await api.put(`/templates/${editing.id}`, payload);
      else await api.post('/templates', payload);
      await loadTemplates(board.id);
      setEditing(null);
      toast.success('Template saved');
    } catch { toast.error('Failed to save'); }
  };

  const remove = async (t: MessageTemplate) => {
    if (!board || !confirm(`Delete "${t.name}"?`)) return;
    await api.delete(`/templates/${t.id}`);
    loadTemplates(board.id);
  };

  const duplicate = async (t: MessageTemplate, targetBoardId: string) => {
    try {
      await api.post(`/templates/${t.id}/duplicate`, { board_id: targetBoardId });
      if (targetBoardId === board?.id) loadTemplates(board.id);
      toast.success(targetBoardId === board?.id ? 'Duplicated' : 'Copied to board');
    } catch { toast.error('Failed to copy'); }
  };

  return (
    <Modal title="Message templates" onClose={onClose} size="lg">
      <div className="p-5">
        {!editing ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">Run these from the ⚡ button on any row.</p>
              <button onClick={startNew} className="flex items-center gap-1.5 text-sm bg-monday-blue text-white px-3 py-1.5 rounded-lg hover:bg-blue-600">
                <Plus size={15} /> New template
              </button>
            </div>

            {templates.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-10">No templates yet. Create one to generate messages per row.</div>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2.5 hover:border-gray-300">
                    <Sparkles size={16} className="text-monday-blue flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{t.name}</div>
                      <div className="text-xs text-gray-400 truncate">→ {t.target_column || t.name}{t.body.includes('[[AI') ? ' · AI' : ''}</div>
                    </div>
                    <select defaultValue="" onChange={e => { if (e.target.value) { duplicate(t, e.target.value); e.target.value = ''; } }}
                      className="text-xs border border-gray-200 rounded px-1.5 py-1 text-gray-500 max-w-[120px]" title="Copy to board">
                      <option value="">Copy to…</option>
                      <option value={board?.id}>This board</option>
                      {allBoards.filter(b => b.id !== board?.id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <button onClick={() => startEdit(t)} className="text-gray-400 hover:text-monday-blue p-1" title="Edit"><Pencil size={14} /></button>
                    <button onClick={() => remove(t)} className="text-gray-400 hover:text-red-500 p-1" title="Delete"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Template name</label>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. LinkedIn first message"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Write result into column</label>
              <input list="tpl-cols" value={editing.target_column} onChange={e => setEditing({ ...editing, target_column: e.target.value })}
                placeholder="Pick a column or type a new name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
              <datalist id="tpl-cols">{columns.map(c => <option key={c.id} value={c.name} />)}</datalist>
              <p className="text-xs text-gray-400 mt-1">A new text column is created if it doesn't exist.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Message body</label>
              <textarea ref={bodyRef} value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={8}
                placeholder={'Hi {{First name}},\n\n[[AI: write one warm sentence about {{Company}} in {{Industry}}]]\n\nWould you like more info?'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-monday-blue" />
              <div className="mt-2">
                <span className="text-[11px] text-gray-400 uppercase tracking-wide">Insert column value</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {columns.map(c => (
                    <button key={c.id} type="button" onClick={() => insertAtCursor(`{{${c.name}}}`)}
                      className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-monday-blue hover:bg-blue-100">{c.name}</button>
                  ))}
                  <button type="button" onClick={() => insertAtCursor(' {{Item name}}')}
                    className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-monday-blue hover:bg-blue-100">Item name</button>
                </div>
                <button type="button" onClick={() => insertAtCursor('[[AI: write a short, personalized sentence using {{Company}} ]]')}
                  className="mt-2 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100">
                  <Wand2 size={13} /> Insert AI section
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={editing.apply_styling} onChange={e => setEditing({ ...editing, apply_styling: e.target.checked })} />
                Convert <code className="bg-gray-100 px-1 rounded">**bold**</code> / <code className="bg-gray-100 px-1 rounded">*italic*</code> to unicode (LinkedIn)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">AI model</span>
                <select value={editing.ai_provider} onChange={e => setEditing({ ...editing, ai_provider: e.target.value })}
                  className="text-sm border border-gray-200 rounded px-2 py-1">
                  <option value="">Default</option>
                  {(providers.length ? providers : [{ id: 'openai', display: 'OpenAI' }, { id: 'anthropic', display: 'Anthropic' }, { id: 'groq', display: 'Groq' }])
                    .map(p => <option key={p.id} value={p.id}>{p.display}</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400"><code className="bg-gray-100 px-1 rounded">{'{{Column}}'}</code> = item field · <code className="bg-gray-100 px-1 rounded">[[AI: … ]]</code> = AI-written (can include {'{{Column}}'})</p>
              <div className="flex gap-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={save} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
