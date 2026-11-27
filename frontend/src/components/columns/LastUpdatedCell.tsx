import { useEffect, useState } from 'react';
import Avatar from '../ui/Avatar';
import api from '../../api/client';
import { useBoardStore } from '../../store/boardStore';
import type { User } from '../../types';

interface Props {
  itemId?: string;
  workspaceId?: string;
}

// Shared per-page cache of users so every cell resolves names from one fetch.
let _cache: User[] | null = null;
let _promise: Promise<User[]> | null = null;
async function fetchUsers(workspaceId?: string): Promise<User[]> {
  if (_cache) return _cache;
  if (!_promise) {
    _promise = (workspaceId ? api.get(`/workspaces/${workspaceId}/members`) : api.get('/auth/users'))
      .then(r => { _cache = Array.isArray(r.data) ? r.data : []; return _cache!; })
      .catch(() => { _promise = null; return [] as User[]; });
  }
  return _promise;
}

function relativeTime(iso: string): string {
  // SQLite CURRENT_TIMESTAMP is UTC without a zone suffix; treat it as UTC.
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

function fullTime(iso: string): string {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(t) ? iso : new Date(t).toLocaleString();
}

export default function LastUpdatedCell({ itemId, workspaceId }: Props) {
  const item = useBoardStore(s => s.board?.items.find(i => i.id === itemId));
  const [users, setUsers] = useState<User[]>(_cache || []);

  useEffect(() => { fetchUsers(workspaceId).then(setUsers).catch(() => {}); }, [workspaceId]);

  if (!item || !item.updated_at) return <div className="w-full h-full flex items-center px-2 text-gray-300 text-xs">—</div>;

  const by = item.updated_by ? users.find(u => u.id === item.updated_by) : null;
  const name = by?.name || (item.updated_by ? 'Someone' : '');

  return (
    <div className="w-full h-full flex items-center gap-2 px-2" title={`${name ? name + ' · ' : ''}${fullTime(item.updated_at)}`}>
      {by && <Avatar name={by.name} color={by.avatar_color} size="xs" />}
      <div className="min-w-0">
        <div className="text-xs text-gray-700 leading-tight truncate">{relativeTime(item.updated_at)}</div>
        {name && <div className="text-[10px] text-gray-400 leading-tight truncate">{name}</div>}
      </div>
    </div>
  );
}
