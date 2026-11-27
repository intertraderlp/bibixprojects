import { useState, useEffect } from 'react';
import { X, Calendar, Clock, MapPin, FileText, Users, Plus, Trash2, ChevronDown, Eye, EyeOff, UserPlus } from 'lucide-react';
import api from '../../api/client';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface CalConn { id: string; provider: 'google' | 'microsoft'; calendar_email: string; }
interface ShareTarget { subject_type: 'user' | 'group'; subject_id: string; name: string; }

interface Props {
  defaultDate?: Date;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateEventModal({ defaultDate, onClose, onCreated }: Props) {
  const defaultDateStr = defaultDate ? format(defaultDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
  const [connections, setConnections] = useState<CalConn[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>(''); // '' = Bibix only
  const [title, setTitle]               = useState('');
  const [date, setDate]                 = useState(defaultDateStr);
  const [startTime, setStartTime]       = useState('09:00');
  const [endTime, setEndTime]           = useState('10:00');
  const [allDay, setAllDay]             = useState(false);
  const [location, setLocation]         = useState('');
  const [description, setDescription]   = useState('');
  const [visibility, setVisibility]     = useState<'details' | 'busy'>('details');
  const [attendees, setAttendees]       = useState<string[]>([]);
  const [newEmail, setNewEmail]         = useState('');
  const [saving, setSaving]             = useState(false);

  // internal sharing (Bibix users + groups)
  const [targetUsers, setTargetUsers]   = useState<{ id: string; name: string; email: string }[]>([]);
  const [targetGroups, setTargetGroups] = useState<{ id: string; name: string }[]>([]);
  const [shareWith, setShareWith]       = useState<ShareTarget[]>([]);

  useEffect(() => {
    api.get('/calendar/status').then(r => {
      const all: CalConn[] = [
        ...(r.data.google    || []).map((c: CalConn) => ({ ...c, provider: 'google'    as const })),
        ...(r.data.microsoft || []).map((c: CalConn) => ({ ...c, provider: 'microsoft' as const })),
      ];
      setConnections(all);
    }).catch(() => {});
    api.get('/calendar/meetings/share-targets').then(r => {
      setTargetUsers(r.data.users || []);
      setTargetGroups(r.data.groups || []);
    }).catch(() => {});
  }, []);

  const selectedConn = connections.find(c => c.id === selectedConnId);

  const addAttendee = () => {
    if (!newEmail.trim() || !newEmail.includes('@')) { toast.error('Enter a valid email'); return; }
    if (attendees.includes(newEmail.trim())) return;
    setAttendees(a => [...a, newEmail.trim()]);
    setNewEmail('');
  };

  const addShare = (value: string) => {
    if (!value) return;
    const [subject_type, subject_id] = value.split(':') as ['user' | 'group', string];
    if (shareWith.some(s => s.subject_type === subject_type && s.subject_id === subject_id)) return;
    const name = subject_type === 'user'
      ? (targetUsers.find(u => u.id === subject_id)?.name || 'User')
      : (targetGroups.find(g => g.id === subject_id)?.name || 'Group');
    setShareWith(s => [...s, { subject_type, subject_id, name }]);
  };
  const removeShare = (s: ShareTarget) =>
    setShareWith(list => list.filter(x => !(x.subject_type === s.subject_type && x.subject_id === s.subject_id)));

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Please enter a title'); return; }
    setSaving(true);
    try {
      const start = allDay ? date : `${date}T${startTime}:00`;
      const end   = allDay ? date : `${date}T${endTime}:00`;
      const { data } = await api.post('/calendar/meetings', {
        title: title.trim(), start, end, allDay, location, description, visibility,
        shares: shareWith.map(s => ({ subject_type: s.subject_type, subject_id: s.subject_id })),
        externalConnId: selectedConnId || undefined,
        attendees: selectedConnId ? attendees : [],
      });
      if (data.externalWarning) toast(data.externalWarning, { icon: '⚠️' });
      else toast.success('Meeting created!');
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create meeting.');
    } finally { setSaving(false); }
  };

  const providerLabel = (p: string) => p === 'google' ? 'Google Calendar' : 'Outlook / Microsoft 365';

  // options available to add (exclude already-chosen)
  const chosen = new Set(shareWith.map(s => `${s.subject_type}:${s.subject_id}`));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-lg">Create Meeting</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 rounded-lg p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Title */}
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Meeting title"
            autoFocus
            className="w-full text-lg font-medium border-0 border-b-2 border-gray-200 focus:border-monday-blue pb-2 outline-none placeholder-gray-300" />

          {/* All day toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="rounded" />
            All day
          </label>

          {/* Date & Time */}
          <div className="flex items-center gap-3 flex-wrap">
            <Calendar size={16} className="text-gray-400 flex-shrink-0" />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
            {!allDay && (
              <>
                <Clock size={16} className="text-gray-400 flex-shrink-0" />
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                <span className="text-gray-400 text-sm">→</span>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
              </>
            )}
          </div>

          {/* Location */}
          <div className="flex items-center gap-3">
            <MapPin size={16} className="text-gray-400 flex-shrink-0" />
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Add location (optional)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
          </div>

          {/* Description */}
          <div className="flex items-start gap-3">
            <FileText size={16} className="text-gray-400 flex-shrink-0 mt-2" />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Add description (optional)"
              rows={2} className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue resize-none" />
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            {/* Who can see it — internal sharing */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                <UserPlus size={13} /> Share with people here
              </label>
              {shareWith.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {shareWith.map(s => (
                    <span key={`${s.subject_type}:${s.subject_id}`}
                      className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-monday-blue">
                      {s.subject_type === 'group' ? '👥 ' : ''}{s.name}
                      <button onClick={() => removeShare(s)} className="hover:text-red-500"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <select value="" onChange={e => { addShare(e.target.value); e.target.value = ''; }}
                  className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue pr-8 cursor-pointer text-gray-500">
                  <option value="">+ Add a person or group…</option>
                  {targetGroups.filter(g => !chosen.has(`group:${g.id}`)).length > 0 && (
                    <optgroup label="Groups">
                      {targetGroups.filter(g => !chosen.has(`group:${g.id}`)).map(g => (
                        <option key={g.id} value={`group:${g.id}`}>{g.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="People">
                    {targetUsers.filter(u => !chosen.has(`user:${u.id}`)).map(u => (
                      <option key={u.id} value={`user:${u.id}`}>{u.name} ({u.email})</option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* What they see — visibility */}
            {shareWith.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">What they can see</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setVisibility('details')}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border-2 text-left transition-colors ${visibility === 'details' ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <Eye size={15} className={visibility === 'details' ? 'text-monday-blue mt-0.5' : 'text-gray-400 mt-0.5'} />
                    <div>
                      <div className="text-sm font-medium text-gray-800">Full details</div>
                      <div className="text-[11px] text-gray-400">Title, time & notes</div>
                    </div>
                  </button>
                  <button type="button" onClick={() => setVisibility('busy')}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border-2 text-left transition-colors ${visibility === 'busy' ? 'border-monday-blue bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <EyeOff size={15} className={visibility === 'busy' ? 'text-monday-blue mt-0.5' : 'text-gray-400 mt-0.5'} />
                    <div>
                      <div className="text-sm font-medium text-gray-800">Just “Busy”</div>
                      <div className="text-[11px] text-gray-400">Hide the details</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Optional: also add to an external calendar */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Also add to calendar</label>
              <div className="relative">
                <select value={selectedConnId} onChange={e => setSelectedConnId(e.target.value)}
                  className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue pr-8 cursor-pointer">
                  <option value="">Bibix only</option>
                  {connections.map(c => (
                    <option key={c.id} value={c.id}>{c.calendar_email} — {providerLabel(c.provider)}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {connections.length === 0 && (
                <p className="text-[11px] text-gray-400 mt-1">Connect Google or Outlook in Settings to also push meetings there and email attendees.</p>
              )}
            </div>

            {/* External attendees (only when a calendar is selected) */}
            {selectedConn && (
              <div className="flex items-start gap-3">
                <Users size={16} className="text-gray-400 flex-shrink-0 mt-2" />
                <div className="flex-1 space-y-2">
                  <label className="block text-xs text-gray-400">Email invites (external)</label>
                  {attendees.map(email => (
                    <div key={email} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                      <span className="flex-1 text-sm text-gray-700">{email}</span>
                      <button onClick={() => setAttendees(a => a.filter(e => e !== email))} className="text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addAttendee()}
                      placeholder="Add attendee email"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue" />
                    <button onClick={addAttendee} className="px-3 py-1.5 bg-gray-100 rounded-lg text-gray-600 hover:bg-gray-200"><Plus size={14} /></button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60">
            {saving ? 'Creating...' : 'Create Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}
