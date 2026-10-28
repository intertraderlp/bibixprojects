import { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import api from '../../api/client';
import { useBoardStore } from '../../store/boardStore';
import type { Automation } from '../../types';
import Modal from '../ui/Modal';
import toast from 'react-hot-toast';

interface Props { onClose: () => void; }

const TRIGGERS = [
  { value: 'value_changed', label: 'When a column value changes' },
  { value: 'item_created', label: 'When an item is created' },
];

const ACTIONS = [
  { value: 'notify', label: 'Send a notification' },
  { value: 'set_value', label: 'Set a column value' },
  { value: 'generate_messages', label: 'Generate LinkedIn + Email (AI)' },
];

export default function AutomationsPanel({ onClose }: Props) {
  const { board } = useBoardStore();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [providers, setProviders] = useState<{ id: string; display: string }[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [form, setForm] = useState({
    name: '', trigger_type: 'value_changed', action_type: 'notify',
    column_id: '', to_value: '', provider: 'openai', model: '', action_config: '{}',
  });

  const saveApiKey = async () => {
    if (apiKey.trim().length < 8) { toast.error('Enter a valid API key'); return; }
    try {
      await api.post('/ai/providers', { provider: form.provider, api_key: apiKey.trim(), set_default: true });
      setApiKey('');
      toast.success(`${form.provider} key saved`);
    } catch { toast.error('Could not save key'); }
  };

  useEffect(() => {
    if (!board) return;
    api.get(`/automations/board/${board.id}`).then(r => setAutomations(r.data));
  }, [board?.id]);

  useEffect(() => {
    api.get('/ai/catalog').then(r => setProviders(r.data || [])).catch(() => {});
  }, []);

  const create = async () => {
    if (!board) return;
    try {
      const trigger_config = form.trigger_type === 'value_changed'
        ? { ...(form.column_id ? { column_id: form.column_id } : {}), ...(form.to_value ? { to_value: form.to_value } : {}) }
        : {};
      let action_config: Record<string, unknown>;
      if (form.action_type === 'generate_messages') {
        action_config = { provider: form.provider, ...(form.model.trim() ? { model: form.model.trim() } : {}) };
      } else {
        action_config = JSON.parse(form.action_config || '{}');
      }
      const { data } = await api.post('/automations', {
        board_id: board.id, name: form.name || 'New Automation',
        trigger_type: form.trigger_type, trigger_config,
        action_type: form.action_type, action_config,
      });
      setAutomations(a => [...a, data]);
      setShowNew(false);
      toast.success('Automation created');
    } catch { toast.error('Could not create automation (check the config)'); }
  };

  const toggle = async (id: string, enabled: boolean) => {
    const { data } = await api.put(`/automations/${id}`, { enabled: !enabled });
    setAutomations(a => a.map(x => x.id === id ? data : x));
  };

  const remove = async (id: string) => {
    await api.delete(`/automations/${id}`);
    setAutomations(a => a.filter(x => x.id !== id));
    toast.success('Automation deleted');
  };

  return (
    <Modal title="Automations" onClose={onClose} size="lg">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">Set up automated workflows for this board</p>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-2 bg-monday-blue text-white text-sm rounded-lg hover:bg-blue-600">
            <Plus size={16} /> New Automation
          </button>
        </div>

        {automations.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Zap size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No automations yet</p>
            <p className="text-xs mt-1">Create automations to save time on repetitive tasks</p>
          </div>
        )}

        <div className="space-y-3">
          {automations.map(a => (
            <div key={a.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap size={16} className={a.enabled ? 'text-monday-blue' : 'text-gray-400'} />
                  <div>
                    <div className="font-medium text-sm text-gray-900">{a.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {TRIGGERS.find(t => t.value === a.trigger_type)?.label} →{' '}
                      {ACTIONS.find(t => t.value === a.action_type)?.label}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(a.id, !!a.enabled)}>
                    {a.enabled ? <ToggleRight size={22} className="text-monday-blue" /> : <ToggleLeft size={22} className="text-gray-400" />}
                  </button>
                  <button onClick={() => remove(a.id)} className="text-gray-400 hover:text-red-500 p-1 rounded"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showNew && (
        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <h3 className="font-semibold text-sm mb-4">New Automation</h3>
          <div className="space-y-3">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Automation name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Trigger</label>
                <select value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <select value={form.action_type} onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>
            {form.trigger_type === 'value_changed' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">When this column…</label>
                  <select value={form.column_id} onChange={e => setForm(f => ({ ...f, column_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Any column</option>
                    {(board?.columns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">…changes to this value</label>
                  <input value={form.to_value} onChange={e => setForm(f => ({ ...f, to_value: e.target.value }))}
                    placeholder="e.g. follow accepted Linkedin"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}

            {form.action_type === 'generate_messages' ? (
              <div>
                <label className="block text-xs text-gray-500 mb-1">AI provider</label>
                <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {(providers.length ? providers : [{ id: 'openai', display: 'OpenAI' }, { id: 'anthropic', display: 'Anthropic' }, { id: 'gemini', display: 'Gemini' }])
                    .map(p => <option key={p.id} value={p.id}>{p.display}</option>)}
                </select>
                <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="Model (optional, e.g. gemini-2.0-flash) — leave blank for the default"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-2" />
                <p className="text-xs text-gray-400 mt-1">
                  Writes a personalised LinkedIn message and intro email into the “Linkedin 1st Message”
                  and “Intro email” columns (created automatically).
                </p>
                <div className="mt-2 flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">{form.provider} API key (stored securely, once)</label>
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                      placeholder="Paste API key…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <button type="button" onClick={saveApiKey}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100">Save key</button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Action Config (JSON)</label>
                <textarea value={form.action_config} onChange={e => setForm(f => ({ ...f, action_config: e.target.value }))}
                  rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono" />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded-lg">Cancel</button>
              <button onClick={create} className="px-4 py-2 text-sm bg-monday-blue text-white rounded-lg hover:bg-blue-600">Create</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
