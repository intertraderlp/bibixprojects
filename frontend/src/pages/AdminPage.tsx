import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Shield, User, Eye, Settings2, ToggleLeft, ToggleRight, ChevronRight, Crown, Users, Tag, X, Check } from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { User as UserType, UserRole, AppModule, UserGroup } from '../types';
import Avatar from '../components/ui/Avatar';
import Modal from '../components/ui/Modal';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_META: Record<UserRole, { label: string; color: string; icon: React.ReactNode }> = {
  super_admin: { label: 'Super Admin', color: 'bg-yellow-100 text-yellow-700', icon: <Crown size={12} /> },
  admin:       { label: 'Admin',       color: 'bg-purple-100 text-purple-700', icon: <Shield size={12} /> },
  user:        { label: 'User',        color: 'bg-blue-100 text-blue-700',     icon: <User size={12} /> },
  readonly:    { label: 'Read Only',   color: 'bg-gray-100 text-gray-600',     icon: <Eye size={12} /> },
};

const MODULES: { id: AppModule; label: string; description: string; emoji: string }[] = [
  { id: 'boards',     label: 'Boards & Workspaces', description: 'View and manage project boards',  emoji: '📋' },
  { id: 'calendar',   label: 'Calendar',             description: 'Access the calendar view',        emoji: '📅' },
  { id: 'bibixbot',   label: 'BibixBot',             description: 'Use the AI assistant',            emoji: '🤖' },
  { id: 'scheduling', label: 'Scheduling',           description: 'Manage bookings and schedules',   emoji: '🗓️' },
  { id: 'crm',        label: 'CRM',                  description: 'Contacts, forms and reports',     emoji: '👥' },
  { id: 'invoices',   label: 'Invoices',             description: 'Create and manage invoices',      emoji: '🧾' },
  { id: 'marketing',  label: 'Marketing',            description: 'Social media and campaigns',      emoji: '📣' },
  { id: 'extensions', label: 'Extensions Download',   description: 'Download & install browser extensions', emoji: '🧩' },
];

// Sub-modules nested under "marketing" → toggleable when marketing is on.
const MARKETING_CHILDREN: { key: string; label: string; description: string; emoji: string }[] = [
  { key: 'marketing.instagram', label: 'Instagram', description: 'Access the Instagram tools',  emoji: '📷' },
  { key: 'marketing.linkedin',  label: 'LinkedIn',  description: 'Access the LinkedIn tools',   emoji: '💼' },
];
// Per-extension visibility nested under "extensions" → which downloads a user sees.
const EXTENSION_CHILDREN: { key: string; label: string; description: string; emoji: string }[] = [
  { key: 'extensions.linkedin',  label: 'LinkedIn',  description: 'LinkedIn Assistant extension',  emoji: '💼' },
  { key: 'extensions.instagram', label: 'Instagram', description: 'Instagram Assistant extension', emoji: '📷' },
  { key: 'extensions.tiktok',    label: 'TikTok',    description: 'TikTok Assistant extension',    emoji: '🎵' },
  { key: 'extensions.idealista', label: 'Idealista', description: 'Idealista Scraper extension',   emoji: '🏠' },
];
// Tabs nested under "marketing.instagram" → visible in the Chrome extension popup.
const INSTAGRAM_EXT_TABS: { key: string; label: string; description: string }[] = [
  { key: 'marketing.instagram.engagement', label: 'Engagement',  description: 'Like, reply, follow, unfollow' },
  { key: 'marketing.instagram.messaging',  label: 'Messaging',   description: 'Auto-reply unread DMs' },
  { key: 'marketing.instagram.insights',   label: 'Insights',    description: 'Scan notifications, follower snapshots' },
  { key: 'marketing.instagram.accounts',   label: 'Accounts',    description: 'Multi-account scan and switch' },
  { key: 'marketing.instagram.schedule',   label: 'Schedule',    description: 'Check scheduled posts in the extension' },
  { key: 'marketing.instagram.pages',      label: 'Pages',       description: 'History, Dashboard, Campaigns links' },
];

const AVATAR_COLORS = ['#0073ea','#e2445c','#00c875','#ffcb00','#a25ddc','#037f4c','#bb3354','#ff642e'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser extends UserType {
  role: UserRole;
  permissions: Partial<Record<AppModule, boolean>>;
  created_at: string;
  workspace_count?: number;
  groups: UserGroup[];
}

interface FormState {
  name: string; email: string; password: string; role: UserRole; avatar_color: string;
}
const emptyForm = (): FormState => ({ name: '', email: '', password: '', role: 'user', avatar_color: '#0073ea' });

// ── Permissions panel ─────────────────────────────────────────────────────────

function PermissionsPanel({ user, canEdit, onClose, onSaved }: {
  user: AdminUser;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (updated: AdminUser) => void;
}) {
  // We extended the permissions JSON with nested dotted keys
  // (marketing.instagram, marketing.instagram.engagement, etc), so the panel
  // works in a generic Record<string, boolean> shape rather than the
  // narrower AppModule one.
  const [perms, setPerms] = useState<Record<string, boolean>>(
    (user.permissions ?? {}) as Record<string, boolean>
  );
  const [saving, setSaving] = useState(false);

  const isElevated = user.role === 'super_admin' || user.role === 'admin';

  // Generic toggle works for any permission key (top-level or nested).
  const toggleKey = (key: string) => {
    setPerms(p => {
      const current = p[key] !== false;
      return { ...p, [key]: !current };
    });
  };
  const getKey = (key: string) => perms[key] !== false;

  // Back-compat helpers for the AppModule-typed loop below.
  const toggle = (mod: AppModule) => toggleKey(mod);
  const getValue = (mod: AppModule) => getKey(mod);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/admin/users/${user.id}/permissions`, { permissions: perms });
      onSaved(data);
      toast.success('Permissions updated');
      onClose();
    } catch {
      toast.error('Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/30" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="h-full w-full max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-1">
            <Avatar name={user.name} color={user.avatar_color} size="sm" />
            <div>
              <div className="font-semibold text-gray-800 text-sm">{user.name}</div>
              <div className="text-xs text-gray-400">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ROLE_META[user.role]?.color}`}>
              {ROLE_META[user.role]?.icon} {ROLE_META[user.role]?.label}
            </span>
            {isElevated && (
              <span className="text-xs text-purple-500 font-medium">Elevated roles always have full access</span>
            )}
          </div>
        </div>

        {/* Module toggles */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Module Access</p>

          <div className="space-y-2">
            {MODULES.map(mod => {
              const on = getValue(mod.id);
              const disabled = isElevated || !canEdit;
              return (
                <div key={mod.id}>
                  <div
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-colors ${
                      disabled
                        ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                        : on
                          ? 'border-blue-200 bg-blue-50/50 cursor-pointer hover:bg-blue-50'
                          : 'border-gray-200 bg-white cursor-pointer hover:bg-gray-50'
                    }`}
                    onClick={() => !disabled && toggle(mod.id)}
                  >
                    <span className="text-xl flex-shrink-0">{mod.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{mod.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{mod.description}</div>
                    </div>
                    <div className="flex-shrink-0">
                      {isElevated || on
                        ? <ToggleRight size={22} className="text-blue-500" />
                        : <ToggleLeft  size={22} className="text-gray-300" />
                      }
                    </div>
                  </div>

                  {/* Marketing → Instagram / LinkedIn children */}
                  {mod.id === 'marketing' && (isElevated || on) && (
                    <div className="ml-6 mt-2 pl-3 border-l-2 border-gray-100 space-y-2">
                      {MARKETING_CHILDREN.map(child => {
                        const childOn = getKey(child.key);
                        const childDisabled = isElevated || !canEdit;
                        return (
                          <div key={child.key}>
                            <div
                              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                childDisabled
                                  ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                  : childOn
                                    ? 'border-blue-200 bg-blue-50/50 cursor-pointer hover:bg-blue-50'
                                    : 'border-gray-200 bg-white cursor-pointer hover:bg-gray-50'
                              }`}
                              onClick={() => !childDisabled && toggleKey(child.key)}
                            >
                              <span className="text-lg flex-shrink-0">{child.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-800">{child.label}</div>
                                <div className="text-xs text-gray-400 mt-0.5">{child.description}</div>
                              </div>
                              <div className="flex-shrink-0">
                                {isElevated || childOn
                                  ? <ToggleRight size={20} className="text-blue-500" />
                                  : <ToggleLeft  size={20} className="text-gray-300" />
                                }
                              </div>
                            </div>

                            {/* Instagram extension-tab toggles, only when Instagram is on */}
                            {child.key === 'marketing.instagram' && (isElevated || childOn) && (
                              <div className="ml-6 mt-1.5 pl-3 border-l-2 border-gray-100 space-y-1.5">
                                <p className="text-[11px] uppercase tracking-wider text-gray-400 mt-1 mb-1">
                                  Extension popup tabs
                                </p>
                                {INSTAGRAM_EXT_TABS.map(tab => {
                                  const tabOn = getKey(tab.key);
                                  const tabDisabled = isElevated || !canEdit;
                                  return (
                                    <div key={tab.key}
                                      className={`flex items-center gap-3 px-3 py-2 rounded-md border text-sm transition-colors ${
                                        tabDisabled
                                          ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                          : tabOn
                                            ? 'border-blue-200 bg-blue-50/40 cursor-pointer hover:bg-blue-50'
                                            : 'border-gray-200 bg-white cursor-pointer hover:bg-gray-50'
                                      }`}
                                      onClick={() => !tabDisabled && toggleKey(tab.key)}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-gray-800">{tab.label}</div>
                                        <div className="text-xs text-gray-400">{tab.description}</div>
                                      </div>
                                      {isElevated || tabOn
                                        ? <ToggleRight size={18} className="text-blue-500" />
                                        : <ToggleLeft  size={18} className="text-gray-300" />
                                      }
                                    </div>
                                  );
                                })}
                                <p className="text-[11px] text-gray-400 italic mt-1">
                                  Sync is always visible so users can paste their token.
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Extensions → per-extension visibility */}
                  {mod.id === 'extensions' && (isElevated || on) && (
                    <div className="ml-6 mt-2 pl-3 border-l-2 border-gray-100 space-y-2">
                      <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Which extensions this user can see</p>
                      {EXTENSION_CHILDREN.map(child => {
                        const childOn = getKey(child.key);
                        const childDisabled = isElevated || !canEdit;
                        return (
                          <div key={child.key}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                              childDisabled
                                ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                                : childOn
                                  ? 'border-blue-200 bg-blue-50/50 cursor-pointer hover:bg-blue-50'
                                  : 'border-gray-200 bg-white cursor-pointer hover:bg-gray-50'
                            }`}
                            onClick={() => !childDisabled && toggleKey(child.key)}
                          >
                            <span className="text-lg flex-shrink-0">{child.emoji}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-800">{child.label}</div>
                              <div className="text-xs text-gray-400 mt-0.5">{child.description}</div>
                            </div>
                            <div className="flex-shrink-0">
                              {isElevated || childOn
                                ? <ToggleRight size={20} className="text-blue-500" />
                                : <ToggleLeft  size={20} className="text-gray-300" />
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">
            Cancel
          </button>
          {canEdit && !isElevated && (
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Role change modal ─────────────────────────────────────────────────────────

function RoleModal({ user, onClose, onSaved }: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (updated: AdminUser) => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);
  const selectableRoles: UserRole[] = ['super_admin', 'admin', 'user', 'readonly'];

  const handleSave = async () => {
    if (role === user.role) { onClose(); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/admin/users/${user.id}/role`, { role });
      onSaved(data);
      toast.success('Role updated');
      onClose();
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Change Role" onClose={onClose} size="sm">
      <div className="p-6 space-y-4">
        <div>
          <p className="text-sm text-gray-500 mb-1">Changing role for <span className="font-medium text-gray-800">{user.name}</span></p>
          <p className="text-xs text-gray-400">{user.email}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {selectableRoles.map(r => {
            const meta = ROLE_META[r];
            return (
              <button key={r} onClick={() => setRole(r)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors ${role === r ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <span className={`p-1.5 rounded-full ${meta.color}`}>{meta.icon}</span>
                <span className="text-xs font-medium text-gray-700">{meta.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving || role === user.role}
            className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60">
            {saving ? 'Saving…' : 'Update Role'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── User Groups Panel ─────────────────────────────────────────────────────────

const GROUP_COLORS = ['#0073ea','#e2445c','#00c875','#ffcb00','#a25ddc','#037f4c','#ff642e','#9aadbd','#bb3354'];

function GroupsTab({ users, onUsersChanged, isSuperAdmin }: {
  users: AdminUser[];
  onUsersChanged: (users: AdminUser[]) => void;
  isSuperAdmin: boolean;
}) {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#0073ea');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  // user group assignment modal
  const [assignUser, setAssignUser] = useState<AdminUser | null>(null);
  const [assignSelections, setAssignSelections] = useState<Set<string>>(new Set());

  useEffect(() => { loadGroups(); }, []);

  const loadGroups = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/groups');
      setGroups(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/admin/groups', { name: newName.trim(), color: newColor });
      setGroups(g => [...g, { ...data, member_count: 0 }]);
      setNewName(''); setNewColor('#0073ea'); setShowCreate(false);
      toast.success('Group created');
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } | string }; message?: string };
      const detail = (typeof err?.response?.data === 'object' ? err?.response?.data?.error : String(err?.response?.data ?? '')) || err?.message || 'unknown';
      toast.error(`Error ${err?.response?.status ?? ''}: ${detail}`.trim());
    } finally { setSaving(false); }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return setEditingId(null);
    try {
      await api.put(`/admin/groups/${id}`, { name: editName.trim() });
      setGroups(g => g.map(x => x.id === id ? { ...x, name: editName.trim() } : x));
      toast.success('Renamed');
    } catch { toast.error('Failed'); }
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this group? Users will be removed from it.')) return;
    try {
      await api.delete(`/admin/groups/${id}`);
      setGroups(g => g.filter(x => x.id !== id));
      // update users list to remove group
      onUsersChanged(users.map(u => ({ ...u, groups: (u.groups ?? []).filter(g => g.id !== id) })));
      toast.success('Group deleted');
    } catch { toast.error('Failed'); }
  };

  const openAssign = (u: AdminUser) => {
    setAssignUser(u);
    setAssignSelections(new Set((u.groups ?? []).map(g => g.id)));
  };

  const handleSaveAssign = async () => {
    if (!assignUser) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/admin/users/${assignUser.id}/groups`, { group_ids: Array.from(assignSelections) });
      const updated = users.map(u => u.id === assignUser.id ? { ...u, groups: data } : u);
      onUsersChanged(updated);
      await loadGroups(); // refresh counts
      toast.success('Groups updated');
      setAssignUser(null);
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-6 h-6 border-4 border-monday-blue border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6">
      {/* Groups list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-800">User Groups</h2>
            <p className="text-xs text-gray-400 mt-0.5">Users in the same group can see each other. Users with no group cannot see other users.</p>
          </div>
          {isSuperAdmin && (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 bg-monday-blue text-white rounded-lg text-sm font-medium hover:bg-blue-600">
              <Plus size={14} /> New Group
            </button>
          )}
        </div>

        {showCreate && (
          <div className="px-6 py-4 border-b border-gray-100 bg-blue-50/40">
            <div className="flex items-center gap-3">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false); }}
                placeholder="Group name" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
              <div className="flex gap-1.5">
                {GROUP_COLORS.map(c => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${newColor === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <button onClick={handleCreate} disabled={saving || !newName.trim()} className="px-3 py-2 bg-monday-blue text-white rounded-lg text-sm disabled:opacity-60">Create</button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-gray-500 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {groups.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">No groups yet. Create one to control user visibility.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Group</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Members</th>
              {isSuperAdmin && <th className="px-6 py-3" />}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {groups.map(g => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    {editingId === g.id ? (
                      <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); handleRename(g.id); }}>
                        <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => e.key === 'Escape' && setEditingId(null)}
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                        <button type="submit" className="text-green-500"><Check size={14} /></button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-gray-400"><X size={14} /></button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                        <span className="text-sm font-medium text-gray-800">{g.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">{g.member_count ?? 0} member{g.member_count !== 1 ? 's' : ''}</td>
                  {isSuperAdmin && (
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => { setEditingId(g.id); setEditName(g.name); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(g.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Users with their group assignments */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">User Assignments</h2>
          <p className="text-xs text-gray-400 mt-0.5">Assign users to groups to control who can see whom.</p>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-gray-100 bg-gray-50">
            <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
            <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Groups</th>
            {isSuperAdmin && <th className="px-6 py-3" />}
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={u.name} color={u.avatar_color} size="sm" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{u.name}</div>
                      <div className="text-xs text-gray-400">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-3">
                  {u.groups?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.groups.map(g => (
                        <span key={g.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: g.color }}>
                          {g.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">No group — hidden from others</span>
                  )}
                </td>
                {isSuperAdmin && (
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => openAssign(u)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-gray-200 hover:border-blue-200 transition-colors ml-auto">
                      <Tag size={12} /> Assign groups
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign groups modal */}
      {assignUser && (
        <Modal title={`Assign groups — ${assignUser.name}`} onClose={() => setAssignUser(null)} size="sm">
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-500">Select which groups this user belongs to.</p>
            {groups.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No groups yet. Create some in the Groups tab.</p>
            ) : (
              <div className="space-y-2">
                {groups.map(g => {
                  const on = assignSelections.has(g.id);
                  return (
                    <button key={g.id} onClick={() => setAssignSelections(s => { const n = new Set(s); on ? n.delete(g.id) : n.add(g.id); return n; })}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${on ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                      <span className="text-sm font-medium text-gray-800 flex-1">{g.name}</span>
                      {on && <Check size={16} className="text-monday-blue flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setAssignUser(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveAssign} disabled={saving} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user: me } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [permUser, setPermUser] = useState<AdminUser | null>(null);
  const [roleUser, setRoleUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [accessLevel, setAccessLevel] = useState<'none' | 'admin' | 'super_admin'>('none');
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');

  const isSuperAdmin = accessLevel === 'super_admin';

  useEffect(() => { checkAndLoad(); }, []);

  const checkAndLoad = async () => {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(Array.isArray(data) ? data : []);
      // Determine caller's level from the me store (already loaded by App)
      const myRole = me?.role;
      setAccessLevel(myRole === 'super_admin' ? 'super_admin' : myRole === 'admin' ? 'admin' : 'none');
    } catch {
      setAccessLevel('none');
    } finally { setLoading(false); }
  };

  const promoteToAdmin = async () => {
    try {
      await api.post('/admin/promote-self');
      toast.success('You are now an admin! Reloading…');
      window.location.reload();
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    }
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit   = (u: AdminUser) => { setEditing(u); setForm({ name: u.name, email: u.email, password: '', role: u.role, avatar_color: u.avatar_color }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name || !form.email) return toast.error('Name and email required');
    if (!editing && !form.password) return toast.error('Password required');
    setSaving(true);
    try {
      if (editing) {
        const payload: Partial<FormState> = { name: form.name, email: form.email, role: form.role, avatar_color: form.avatar_color };
        if (form.password) payload.password = form.password;
        const { data } = await api.put(`/admin/users/${editing.id}`, payload);
        setUsers(u => u.map(x => x.id === editing.id ? { ...x, ...data } : x));
        toast.success('User updated');
      } else {
        const { data } = await api.post('/admin/users', form);
        setUsers(u => [...u, { ...data, permissions: {} }]);
        toast.success('User created');
      }
      setShowModal(false);
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setUsers(u => u.filter(x => x.id !== id));
      toast.success('User deleted');
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-monday-blue border-t-transparent rounded-full" />
    </div>
  );

  if (accessLevel === 'none') return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
      <Shield size={48} className="text-gray-300" />
      <h2 className="text-xl font-bold text-gray-800">Admin Access Required</h2>
      <p className="text-sm text-gray-500 max-w-sm">You don't have admin privileges. If you're the first user, you can promote yourself.</p>
      <button onClick={promoteToAdmin} className="flex items-center gap-2 px-5 py-2.5 bg-monday-blue text-white rounded-lg hover:bg-blue-600 text-sm font-medium">
        <Shield size={16} /> Become Admin
      </button>
    </div>
  );

  const myRoleMeta = me?.role ? ROLE_META[me.role as UserRole] : null;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
              {myRoleMeta && (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${myRoleMeta.color}`}>
                  {myRoleMeta.icon} {myRoleMeta.label}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {users.length} user{users.length !== 1 ? 's' : ''}
              {isSuperAdmin ? ' — showing all users' : ' — showing users in your workspaces'}
            </p>
          </div>
          {isSuperAdmin && activeTab === 'users' && (
            <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-monday-blue text-white rounded-lg hover:bg-blue-600 text-sm font-medium">
              <Plus size={16} /> New User
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'users' ? 'border-monday-blue text-monday-blue' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <User size={15} /> Users
          </button>
          <button onClick={() => setActiveTab('groups')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'groups' ? 'border-monday-blue text-monday-blue' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <Users size={15} /> Groups
          </button>
        </div>

        {activeTab === 'groups' ? (
          <GroupsTab users={users} onUsersChanged={setUsers} isSuperAdmin={isSuperAdmin} />
        ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Groups</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Access</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => {
                const roleMeta = ROLE_META[u.role] ?? ROLE_META.user;
                const isElevated = u.role === 'super_admin' || u.role === 'admin';

                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} color={u.avatar_color} size="sm" />
                        <div>
                          <div className="font-medium text-sm text-gray-900">
                            {u.name}
                            {u.id === me?.id && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                          </div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleMeta.color}`}>
                          {roleMeta.icon} {roleMeta.label}
                        </span>
                        {isSuperAdmin && u.id !== me?.id && (
                          <button onClick={() => setRoleUser(u)} title="Change role"
                            className="p-1 text-gray-300 hover:text-purple-500 hover:bg-purple-50 rounded transition-colors">
                            <Shield size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {u.groups?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {u.groups.map(g => (
                            <span key={g.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: g.color }}>
                              {g.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No group</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => setPermUser(u)}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 group"
                      >
                        <div className="flex gap-1">
                          {MODULES.map(m => {
                            const on = isElevated || (u.permissions ?? {})[m.id] !== false;
                            return (
                              <span key={m.id} title={m.label}
                                className={`w-5 h-5 rounded flex items-center justify-center text-[11px] ${on ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-300'}`}>
                                {m.emoji}
                              </span>
                            );
                          })}
                        </div>
                        <ChevronRight size={13} className="text-gray-300 group-hover:text-blue-500" />
                      </button>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => setPermUser(u)} title="Manage permissions"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                          <Settings2 size={15} />
                        </button>
                        {isSuperAdmin && (
                          <>
                            <button onClick={() => openEdit(u)}
                              className="p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded">
                              <Pencil size={15} />
                            </button>
                            {u.id !== me?.id && u.role !== 'super_admin' && (
                              <button onClick={() => handleDelete(u.id)}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Edit / Create user modal (super_admin only) */}
      {showModal && isSuperAdmin && (
        <Modal title={editing ? 'Edit User' : 'New User'} onClose={() => setShowModal(false)} size="sm">
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Avatar Color</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button key={c} onClick={() => setForm(f => ({ ...f, avatar_color: c }))}
                    className={`w-7 h-7 rounded-full hover:scale-110 transition-transform ${form.avatar_color === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            {(['name', 'email'] as const).map(field => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-500 mb-1 capitalize">{field}</label>
                <input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  type={field === 'email' ? 'email' : 'text'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Password {editing && <span className="text-gray-400">(leave blank to keep current)</span>}
              </label>
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder={editing ? '••••••' : 'At least 6 characters'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(ROLE_META) as [UserRole, typeof ROLE_META[UserRole]][]).map(([role, meta]) => (
                  <button key={role} onClick={() => setForm(f => ({ ...f, role }))}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors ${form.role === role ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <span className={`p-1.5 rounded-full ${meta.color}`}>{meta.icon}</span>
                    <span className="text-xs font-medium text-gray-700">{meta.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-60">
                {saving ? 'Saving…' : editing ? 'Update' : 'Create User'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Permissions side panel */}
      {permUser && (
        <PermissionsPanel
          user={permUser}
          canEdit={isSuperAdmin}
          onClose={() => setPermUser(null)}
          onSaved={updated => setUsers(u => u.map(x => x.id === updated.id ? { ...x, ...updated } : x))}
        />
      )}

      {/* Role change modal (super_admin only) */}
      {roleUser && isSuperAdmin && (
        <RoleModal
          user={roleUser}
          onClose={() => setRoleUser(null)}
          onSaved={updated => setUsers(u => u.map(x => x.id === updated.id ? { ...x, ...updated } : x))}
        />
      )}
    </div>
  );
}
