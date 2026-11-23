import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Trash2, Clock, Paperclip, FileText, Download, Image, Bell, Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../../api/client';
import { useBoardStore } from '../../store/boardStore';
import { useAuthStore } from '../../store/authStore';
import type { Item, Update } from '../../types';
import Avatar from '../ui/Avatar';
import CellRenderer from '../columns/CellRenderer';

interface Attachment {
  id: string; item_id: string; update_id?: string; filename: string;
  original_name: string; mime_type: string; size: number;
  uploaded_by: string; created_at: string;
}

interface Props { item: Item; onClose: () => void; }

const API_BASE = '/api';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ att, onDelete, canDelete }: { att: Attachment; onDelete?: () => void; canDelete?: boolean }) {
  const isImage = att.mime_type.startsWith('image/');
  const url = `${API_BASE}/uploads/${att.filename}`;
  return (
    <div className="group relative flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-2 hover:border-gray-300">
      {isImage ? (
        <img src={url} alt={att.original_name}
          className="w-10 h-10 object-cover rounded flex-shrink-0 cursor-pointer hover:opacity-90"
          onClick={() => window.open(url, '_blank')} />
      ) : (
        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
          <FileText size={16} className="text-gray-400" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">{att.original_name}</p>
        <p className="text-xs text-gray-400">{formatBytes(att.size)}</p>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
        <a href={url} download={att.original_name} className="p-1 text-gray-400 hover:text-monday-blue rounded" title="Download">
          <Download size={12} />
        </a>
        {canDelete && onDelete && (
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Remove">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

interface Reminder { id: string; remind_at: string; note: string | null; done: boolean }

function RemindersSection({ itemId }: { itemId: string }) {
  const [list, setList] = useState<Reminder[]>([]);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get(`/reminders/item/${itemId}`).then(r => setList(r.data)).catch(() => {});
  }, [itemId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!when) return;
    setSaving(true);
    try {
      await api.post('/reminders', { item_id: itemId, remind_at: when, note: note.trim() || undefined });
      setWhen(''); setNote('');
      load();
      window.dispatchEvent(new Event('reminders:changed'));
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    await api.delete(`/reminders/${id}`);
    setList(l => l.filter(x => x.id !== id));
    window.dispatchEvent(new Event('reminders:changed'));
  };

  return (
    <div className="p-6 border-b border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <Bell size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Reminders</span>
      </div>
      {list.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {list.map(r => (
            <div key={r.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${r.done ? 'bg-gray-50 text-gray-400 line-through' : 'bg-blue-50 text-gray-700'}`}>
              <Clock size={13} className="flex-shrink-0 text-monday-blue" />
              <span className="flex-shrink-0">{format(parseISO(r.remind_at), 'EEE, MMM d · h:mm a')}</span>
              {r.note && <span className="text-gray-500 truncate">— {r.note}</span>}
              <button onClick={() => remove(r.id)} className="ml-auto text-gray-300 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          className="flex-1 min-w-[140px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
        <button onClick={add} disabled={!when || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-monday-blue text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50">
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

export default function ItemModal({ item, onClose }: Props) {
  const { board, updateItemValue, getValue, deleteItem, updateItem } = useBoardStore();
  const { user } = useAuthStore();
  const [updates, setUpdates] = useState<(Update & { attachments?: Attachment[] })[]>([]);
  const [comment, setComment] = useState('');
  const [itemName, setItemName] = useState(item.name);
  const [editingName, setEditingName] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get(`/items/${item.id}`).then(r => setUpdates(r.data.updates || []));
  }, [item.id]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post(`/items/${item.id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPendingAttachments(a => [...a, data]);
    } finally {
      setUploading(false);
    }
  }, [item.id]);

  // Paste screenshot
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))?.getAsFile();
      if (file) { e.preventDefault(); uploadFile(file); }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [uploadFile]);

  const removePending = async (id: string) => {
    await api.delete(`/items/${item.id}/attachments/${id}`);
    setPendingAttachments(a => a.filter(x => x.id !== id));
  };

  const submitComment = async () => {
    if (!comment.trim() && pendingAttachments.length === 0) return;
    const { data } = await api.post('/updates', {
      item_id: item.id,
      content: comment.trim() || '📎',
      attachment_ids: pendingAttachments.map(a => a.id),
    });
    setUpdates(u => [...u, data]);
    setComment('');
    setPendingAttachments([]);
  };

  const deleteUpdate = async (id: string) => {
    await api.delete(`/updates/${id}`);
    setUpdates(u => u.filter(x => x.id !== id));
  };

  const handleDelete = async () => {
    if (confirm('Delete this item?')) { await deleteItem(item.id); onClose(); }
  };

  const columns = board?.columns || [];
  const group = board?.groups.find(g => g.id === item.group_id);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {group && <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: group.color }} />}
            {editingName ? (
              <input autoFocus value={itemName} onChange={e => setItemName(e.target.value)}
                onBlur={() => { setEditingName(false); updateItem(item.id, { name: itemName }); }}
                onKeyDown={e => { if (e.key === 'Enter') { setEditingName(false); updateItem(item.id, { name: itemName }); } }}
                className="flex-1 font-semibold text-lg text-gray-900 outline-none border-b-2 border-monday-blue" />
            ) : (
              <h2 className="font-semibold text-lg text-gray-900 cursor-pointer hover:text-monday-blue truncate"
                onClick={() => setEditingName(true)}>{itemName}</h2>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2">
            <button onClick={handleDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 size={16} /></button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Columns */}
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={14} className="text-gray-400" />
              <span className="text-xs text-gray-400">Created {format(parseISO(item.created_at), 'MMM d, yyyy')}</span>
            </div>
            <div className="space-y-1">
              {columns.map(col => (
                <div key={col.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-500 w-32 flex-shrink-0">{col.name}</span>
                  <div className="flex-1 h-8 border border-transparent hover:border-gray-200 rounded overflow-hidden">
                    <CellRenderer column={col} value={getValue(item.id, col.id)}
                      onChange={v => updateItemValue(item.id, col.id, v)}
                      workspaceId={board?.workspace_id} itemId={item.id} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reminders */}
          <RemindersSection itemId={item.id} />

          {/* Updates */}
          <div className="p-6">
            <h3 className="font-semibold text-sm text-gray-700 mb-4">Updates</h3>

            <div className="space-y-4 mb-6">
              {updates.map(u => (
                <div key={u.id} className="flex gap-3 group">
                  <Avatar name={u.author_name} color={u.author_color} size="sm" />
                  <div className="flex-1 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-gray-900">{u.author_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{format(parseISO(u.created_at), 'MMM d, h:mm a')}</span>
                        {u.user_id === user?.id && (
                          <button onClick={() => deleteUpdate(u.id)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    {u.content !== '📎' && (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{u.content}</p>
                    )}
                    {u.attachments && u.attachments.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {u.attachments.map(att => (
                          <AttachmentPreview key={att.id} att={att} canDelete={false} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {updates.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No updates yet</p>}
            </div>

            {/* Composer */}
            <div className="flex gap-3">
              {user && <Avatar name={user.name} color={user.avatar_color} size="sm" />}
              <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden focus-within:border-monday-blue focus-within:ring-1 focus-within:ring-monday-blue">
                <textarea value={comment} onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(); }}
                  placeholder="Write an update... (Cmd+Enter to submit)"
                  rows={3} className="w-full px-3 py-2 text-sm outline-none resize-none" />

                {/* Pending attachments */}
                {(pendingAttachments.length > 0 || uploading) && (
                  <div className="px-3 pb-2 grid grid-cols-2 gap-2">
                    {pendingAttachments.map(att => (
                      <AttachmentPreview key={att.id} att={att} canDelete onDelete={() => removePending(att.id)} />
                    ))}
                    {uploading && (
                      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
                        <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center flex-shrink-0">
                          <div className="w-4 h-4 border-2 border-monday-blue border-t-transparent rounded-full animate-spin" />
                        </div>
                        <span className="text-xs text-gray-400">Uploading…</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between px-2 pb-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-monday-blue px-2 py-1 rounded hover:bg-gray-100"
                      title="Attach file">
                      <Paperclip size={14} />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-monday-blue px-2 py-1 rounded hover:bg-gray-100"
                      title="Attach image / paste screenshot">
                      <Image size={14} />
                    </button>
                    <input ref={fileInputRef} type="file" multiple className="hidden"
                      onChange={e => { Array.from(e.target.files || []).forEach(uploadFile); e.target.value = ''; }} />
                    <span className="text-xs text-gray-300 ml-1">or paste a screenshot</span>
                  </div>
                  <button onClick={submitComment}
                    disabled={!comment.trim() && pendingAttachments.length === 0}
                    className="flex items-center gap-2 px-3 py-1.5 bg-monday-blue text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Send size={14} /> Update
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
