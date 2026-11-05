import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ChevronDown, ChevronRight, LayoutGrid, Bell, Search, Settings, LogOut, Home, Trash2, Users, Shield, Calendar, Bot, CalendarDays, ContactRound, FileText, Megaphone, Instagram, Linkedin, Database, Pencil, Check, X, Puzzle } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAuthStore } from '../../store/authStore';
import Avatar from '../ui/Avatar';
import Modal from '../ui/Modal';
import WorkspaceMembersModal from '../workspace/WorkspaceMembersModal';
import toast from 'react-hot-toast';

export default function Sidebar() {
  const { workspaces, boards, sharedBoards, createWorkspace, createBoard, deleteBoard, deleteWorkspace, updateWorkspace } = useWorkspaceStore();
  const { user, logout, hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const { boardId } = useParams();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showNewWs, setShowNewWs] = useState(false);
  const [showNewBoard, setShowNewBoard] = useState<string | null>(null);
  const [membersWs, setMembersWs] = useState<{ id: string; name: string } | null>(null);
  const [wsName, setWsName] = useState('');
  const [boardName, setBoardName] = useState('');
  const [boardIcon, setBoardIcon] = useState('📋');

  const toggle = (id: string) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const handleNewWorkspace = async () => {
    if (!wsName.trim()) return;
    const ws = await createWorkspace(wsName.trim());
    setExpanded(e => ({ ...e, [ws.id]: true }));
    setWsName(''); setShowNewWs(false);
    toast.success('Workspace created');
  };

  const handleNewBoard = async (wsId: string) => {
    if (!boardName.trim()) return;
    const board = await createBoard(wsId, boardName.trim(), boardIcon);
    setBoardName(''); setBoardIcon('📋'); setShowNewBoard(null);
    navigate(`/board/${board.id}`);
    toast.success('Board created');
  };

  const ICONS = ['📋','🚀','💡','🎯','🔥','📊','🏆','⚡','🛠️','🎨','📱','🌍'];
  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const [marketingOpen, setMarketingOpen] = useState(false);
  const [socialMediaOpen, setSocialMediaOpen] = useState(false);
  const [editingWs, setEditingWs] = useState<string | null>(null);
  const [editingWsName, setEditingWsName] = useState('');

  return (
    <aside className="w-64 bg-monday-sidebar flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-center">
        <img src="/bibix-logo.png" alt="Bibix Projects" className="h-16 w-auto object-contain" />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <Link to="/" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
          <Home size={16} /> Home
        </Link>
        <button className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm w-full" onClick={() => navigate('/search')}>
          <Search size={16} /> Search
        </button>
        <button className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm w-full" onClick={() => navigate('/notifications')}>
          <Bell size={16} /> Notifications
        </button>
        {hasPermission('calendar') && (
          <Link to="/calendar" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <Calendar size={16} /> Calendar
          </Link>
        )}
        {hasPermission('bibixbot') && (
          <Link to="/bibixbot" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <Bot size={16} /> BibixBot
          </Link>
        )}
        {hasPermission('scheduling') && (
          <Link to="/scheduling" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <CalendarDays size={16} /> Scheduling
          </Link>
        )}
        {hasPermission('crm') && (
          <Link to="/crm" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <ContactRound size={16} /> CRM
          </Link>
        )}
        {hasPermission('invoices') && (
          <Link to="/invoices" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <FileText size={16} /> Invoices
          </Link>
        )}
        {hasPermission('marketing') && (
          <div>
            <button
              onClick={() => setMarketingOpen(o => !o)}
              className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm w-full">
              <Megaphone size={16} />
              <span className="flex-1 text-left">Marketing</span>
              {marketingOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {marketingOpen && (
              <div className="ml-4">
                {/* Social Media */}
                <button
                  onClick={() => setSocialMediaOpen(o => !o)}
                  className="flex items-center gap-3 px-4 py-2 text-white/60 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm w-full">
                  <span className="flex-1 text-left">Social Media</span>
                  {socialMediaOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {socialMediaOpen && (
                  <div className="ml-4">
                    <Link to="/marketing/instagram" className="flex items-center gap-3 px-4 py-2 text-white/50 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
                      <Instagram size={13} /> Instagram
                    </Link>
                    <Link to="/marketing/linkedin" className="flex items-center gap-3 px-4 py-2 text-white/50 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
                      <Linkedin size={13} /> LinkedIn
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {hasPermission('extensions') && (
          <Link to="/extensions" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <Puzzle size={16} /> Extensions
          </Link>
        )}
        <Link to="/admin" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
          <Shield size={16} /> User Management
        </Link>
        {isSuperAdmin && (
          <Link to="/backups" className="flex items-center gap-3 px-4 py-2.5 text-white/70 hover:text-white hover:bg-monday-sidebar-hover rounded-lg mx-2 text-sm">
            <Database size={16} /> Backups
          </Link>
        )}

        <div className="mt-4 px-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Workspaces</span>
            <button onClick={() => setShowNewWs(true)} className="text-white/40 hover:text-white p-1 rounded">
              <Plus size={14} />
            </button>
          </div>

          {(workspaces || []).map(ws => (
            <div key={ws.id} className="mb-1">
              <div className="flex items-center justify-between group px-2 py-1.5 rounded hover:bg-monday-sidebar-hover">
                {editingWs === ws.id ? (
                  /* ── Inline edit mode ── */
                  <form className="flex items-center gap-1 flex-1 min-w-0"
                    onSubmit={async e => {
                      e.preventDefault();
                      const name = editingWsName.trim();
                      if (name && name !== ws.name) { await updateWorkspace(ws.id, { name }); toast.success('Renamed'); }
                      setEditingWs(null);
                    }}>
                    <input autoFocus value={editingWsName}
                      onChange={e => setEditingWsName(e.target.value)}
                      onKeyDown={e => e.key === 'Escape' && setEditingWs(null)}
                      className="flex-1 bg-white/10 text-white text-sm rounded px-2 py-0.5 outline-none border border-white/30 min-w-0" />
                    <button type="submit" className="text-green-400 hover:text-green-300 p-0.5"><Check size={13} /></button>
                    <button type="button" onClick={() => setEditingWs(null)} className="text-white/40 hover:text-white p-0.5"><X size={13} /></button>
                  </form>
                ) : (
                  /* ── Normal mode ── */
                  <button className="flex items-center gap-2 flex-1 text-white/80 hover:text-white text-sm min-w-0"
                    onClick={() => toggle(ws.id)}>
                    {expanded[ws.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <LayoutGrid size={14} />
                    <span className="truncate">{ws.name}</span>
                  </button>
                )}
                {editingWs !== ws.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button onClick={() => { setEditingWs(ws.id); setEditingWsName(ws.name); }}
                      className="text-white/50 hover:text-white p-0.5 rounded" title="Rename workspace">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setMembersWs({ id: ws.id, name: ws.name })}
                      className="text-white/50 hover:text-white p-0.5 rounded" title="Manage members">
                      <Users size={13} />
                    </button>
                    <button onClick={() => { setShowNewBoard(ws.id); setBoardName(''); setBoardIcon('📋'); }}
                      className="text-white/50 hover:text-white p-0.5 rounded"><Plus size={13} /></button>
                    <button onClick={async () => { if (confirm('Delete workspace?')) { await deleteWorkspace(ws.id); toast.success('Deleted'); } }}
                      className="text-white/50 hover:text-red-400 p-0.5 rounded"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>

              {expanded[ws.id] && (
                <div className="ml-4 mt-0.5">
                  {(boards[ws.id] || []).map(board => (
                    <div key={board.id} className={`group flex items-center justify-between px-2 py-1.5 rounded text-sm ${boardId === board.id ? 'bg-monday-blue text-white' : 'text-white/70 hover:text-white hover:bg-monday-sidebar-hover'}`}>
                      <Link to={`/board/${board.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                        <span>{board.icon}</span>
                        <span className="truncate">{board.name}</span>
                      </Link>
                      <button onClick={async () => { if (confirm('Delete board?')) { await deleteBoard(board.id, ws.id); if (boardId === board.id) navigate('/'); toast.success('Deleted'); } }}
                        className="opacity-0 group-hover:opacity-100 text-white/50 hover:text-red-400 p-0.5 rounded flex-shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => { setShowNewBoard(ws.id); setBoardName(''); setBoardIcon('📋'); }}
                    className="flex items-center gap-2 px-2 py-1.5 text-white/40 hover:text-white text-xs w-full rounded hover:bg-monday-sidebar-hover">
                    <Plus size={12} /> Add board
                  </button>
                </div>
              )}
            </div>
          ))}
        {/* Shared with me */}
        {(sharedBoards || []).length > 0 && (
          <div className="mt-4 px-2">
            <div className="px-2 mb-1">
              <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Shared with me</span>
            </div>
            {(sharedBoards || []).map(board => (
              <div key={board.id} className={`group flex items-center justify-between px-2 py-1.5 rounded text-sm mx-0 ${boardId === board.id ? 'bg-monday-blue text-white' : 'text-white/70 hover:text-white hover:bg-monday-sidebar-hover'}`}>
                <Link to={`/board/${board.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                  <span>{board.icon}</span>
                  <span className="truncate">{board.name}</span>
                </Link>
                <span className="text-white/30 text-xs truncate ml-1 hidden group-hover:block">{board.workspace_name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          {user && <Avatar name={user.name} color={user.avatar_color} size="sm" />}
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium truncate">{user?.name}</div>
            <div className="text-white/40 text-xs truncate">{isAdmin ? '👑 Admin' : user?.email}</div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => navigate('/settings')} className="text-white/40 hover:text-white p-1 rounded"><Settings size={15} /></button>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-white/40 hover:text-red-400 p-1 rounded"><LogOut size={15} /></button>
          </div>
        </div>
      </div>

      {showNewWs && (
        <Modal title="New Workspace" onClose={() => setShowNewWs(false)} size="sm">
          <div className="p-6 space-y-4">
            <input autoFocus value={wsName} onChange={e => setWsName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNewWorkspace()}
              placeholder="Workspace name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewWs(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleNewWorkspace} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Create</button>
            </div>
          </div>
        </Modal>
      )}

      {showNewBoard && (
        <Modal title="New Board" onClose={() => setShowNewBoard(null)} size="sm">
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICONS.map(icon => (
                  <button key={icon} onClick={() => setBoardIcon(icon)}
                    className={`w-9 h-9 text-xl rounded-lg hover:bg-gray-100 flex items-center justify-center ${boardIcon === icon ? 'bg-blue-50 ring-2 ring-monday-blue' : ''}`}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <input autoFocus value={boardName} onChange={e => setBoardName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNewBoard(showNewBoard)}
              placeholder="Board name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewBoard(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={() => handleNewBoard(showNewBoard)} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Create</button>
            </div>
          </div>
        </Modal>
      )}

      {membersWs && (
        <WorkspaceMembersModal
          workspaceId={membersWs.id}
          workspaceName={membersWs.name}
          onClose={() => setMembersWs(null)}
        />
      )}
    </aside>
  );
}
