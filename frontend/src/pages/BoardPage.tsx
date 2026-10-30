import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { LayoutList, Columns, Calendar, Zap, Users, Upload, GanttChart, Sparkles } from 'lucide-react';
import { useBoardStore } from '../store/boardStore';
import { useSSE } from '../hooks/useSSE';
import type { ViewType } from '../types';
import TableView from '../components/board/TableView';
import KanbanView from '../components/board/KanbanView';
import CalendarView from '../components/board/CalendarView';
import GanttView from '../components/board/GanttView';
import AutomationsPanel from '../components/board/AutomationsPanel';
import TemplatesPanel from '../components/board/TemplatesPanel';
import BoardMembersModal from '../components/board/BoardMembersModal';
import ImportModal from '../components/board/ImportModal';

const VIEWS: { type: ViewType; label: string; icon: React.ReactNode }[] = [
  { type: 'table',    label: 'Table',    icon: <LayoutList size={16} /> },
  { type: 'kanban',   label: 'Kanban',   icon: <Columns size={16} /> },
  { type: 'calendar', label: 'Calendar', icon: <Calendar size={16} /> },
  { type: 'gantt',    label: 'Gantt',    icon: <GanttChart size={16} /> },
];

export default function BoardPage() {
  const { boardId } = useParams();
  const { board, loading, error, loadBoard, refreshBoard, updateBoard } = useBoardStore();
  const [view, setView] = useState<ViewType>('table');
  const [showAutomations, setShowAutomations] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [boardName, setBoardName] = useState('');
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;

  useEffect(() => {
    if (boardId) loadBoard(boardId);
  }, [boardId]);

  useEffect(() => {
    if (board) setBoardName(board.name);
  }, [board?.id]);

  // Live-refresh when the Telegram bot (or anyone else) changes this board
  const handleSSE = useCallback((event: string, data: unknown) => {
    if (event === 'board_updated') {
      const { boardId: updatedId } = data as { boardId: string };
      if (updatedId === boardIdRef.current) {
        refreshBoard(updatedId);
      }
    }
  }, [refreshBoard]);

  useSSE(handleSSE);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-monday-blue border-t-transparent rounded-full" />
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
  );

  if (!board) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{board.icon}</span>
          {editingName ? (
            <input autoFocus value={boardName} onChange={e => setBoardName(e.target.value)}
              onBlur={() => { setEditingName(false); updateBoard({ name: boardName }); }}
              onKeyDown={e => { if (e.key === 'Enter') { setEditingName(false); updateBoard({ name: boardName }); } }}
              className="text-xl font-bold text-gray-900 outline-none border-b-2 border-monday-blue bg-transparent" />
          ) : (
            <h1 className="text-xl font-bold text-gray-900 cursor-pointer hover:text-monday-blue"
              onClick={() => setEditingName(true)}>{board.name}</h1>
          )}
        </div>
        <div className="flex items-center gap-2 justify-between">
          <div className="flex gap-1">
            {VIEWS.map(v => (
              <button key={v.type} onClick={() => setView(v.type)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === v.type ? 'bg-monday-blue text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <Upload size={16} /> Import
            </button>
            <button onClick={() => setShowMembers(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <Users size={16} /> Share
            </button>
            <button onClick={() => setShowAutomations(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <Zap size={16} /> Automations
            </button>
            <button onClick={() => setShowTemplates(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <Sparkles size={16} /> Templates
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {view === 'table'    && <TableView />}
        {view === 'kanban'   && <KanbanView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'gantt'    && <GanttView />}
      </div>

      {showAutomations && <AutomationsPanel onClose={() => setShowAutomations(false)} />}
      {showTemplates && <TemplatesPanel onClose={() => setShowTemplates(false)} />}
      {showMembers && <BoardMembersModal boardId={board.id} boardName={board.name} onClose={() => setShowMembers(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
