import { create } from 'zustand';
import api from '../api/client';
import type { BoardData, Column, Group, Item, ItemValue, ColumnType } from '../types';

interface BoardState {
  board: BoardData | null;
  loading: boolean;
  error: string | null;
  loadBoard: (id: string) => Promise<void>;
  refreshBoard: (id: string) => Promise<void>;
  updateItemValue: (itemId: string, columnId: string, value: string | null) => Promise<void>;
  addItem: (groupId: string, name: string, parentItemId?: string) => Promise<Item>;
  reorderGroups: (orderedIds: string[]) => void;
  reorderItems: (groupId: string, orderedIds: string[]) => void;
  reorderColumns: (orderedIds: string[]) => void;
  updateItem: (itemId: string, data: Partial<Item>) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
  moveItem: (itemId: string, groupId: string, position: number) => Promise<void>;
  addGroup: (name: string, color?: string) => Promise<void>;
  updateGroup: (groupId: string, data: Partial<Group>) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
  addColumn: (name: string, type: ColumnType) => Promise<void>;
  updateColumn: (columnId: string, data: Partial<Column>) => Promise<void>;
  deleteColumn: (columnId: string) => Promise<void>;
  updateBoard: (data: { name?: string; description?: string; icon?: string }) => Promise<void>;
  getItemValues: (itemId: string) => ItemValue[];
  getValue: (itemId: string, columnId: string) => string | null;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  board: null,
  loading: false,
  error: null,

  loadBoard: async (id) => {
    set({ loading: true, error: null });
    try {
      const { data } = await api.get(`/boards/${id}`);
      set({ board: data, loading: false });
    } catch (e: unknown) {
      set({ error: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load board', loading: false });
    }
  },

  // Silent background refresh — no spinner, no error state change
  refreshBoard: async (id) => {
    try {
      const { data } = await api.get(`/boards/${id}`);
      set({ board: data });
    } catch { /* silently ignore */ }
  },

  updateItemValue: async (itemId, columnId, value) => {
    // Optimistic: flip the value in local state immediately so the UI reflects the
    // change instantly, then persist in the background. Revert if the save fails.
    const prevValues = get().board?.values;
    set(state => {
      if (!state.board) return state;
      const existing = state.board.values.findIndex(v => v.item_id === itemId && v.column_id === columnId);
      const newValues = [...state.board.values];
      if (existing >= 0) newValues[existing] = { ...newValues[existing], value };
      else newValues.push({ id: `tmp-${itemId}-${columnId}`, item_id: itemId, column_id: columnId, value } as typeof newValues[number]);
      return { board: { ...state.board, values: newValues } };
    });
    try {
      const { data } = await api.put(`/items/${itemId}/values`, { column_id: columnId, value });
      // Reconcile with the server row (real id / updated_at).
      set(state => {
        if (!state.board) return state;
        const existing = state.board.values.findIndex(v => v.item_id === itemId && v.column_id === columnId);
        const newValues = [...state.board.values];
        if (existing >= 0) newValues[existing] = data;
        else newValues.push(data);
        return { board: { ...state.board, values: newValues } };
      });
    } catch (e) {
      if (prevValues) set(state => state.board ? { board: { ...state.board, values: prevValues } } : state);
      throw e;
    }
  },

  addItem: async (groupId, name, parentItemId) => {
    const { data } = await api.post('/items', { group_id: groupId, name, parent_item_id: parentItemId });
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, items: [...state.board.items, data] } };
    });
    return data;
  },

  reorderGroups: (orderedIds) => {
    set(state => {
      if (!state.board) return state;
      const updated = orderedIds.map((id, i) => {
        const g = state.board!.groups.find(g => g.id === id)!;
        api.put(`/groups/${id}/reorder`, { position: i }).catch(() => {});
        return { ...g, position: i };
      });
      return { board: { ...state.board, groups: updated } };
    });
  },

  reorderItems: (groupId, orderedIds) => {
    set(state => {
      if (!state.board) return state;
      const others = state.board.items.filter(i => i.group_id !== groupId);
      const updated = orderedIds.map((id, i) => {
        const item = state.board!.items.find(it => it.id === id)!;
        api.put(`/items/${id}/move`, { group_id: groupId, position: i }).catch(() => {});
        return { ...item, group_id: groupId, position: i };
      });
      return { board: { ...state.board, items: [...others, ...updated] } };
    });
  },

  reorderColumns: (orderedIds) => {
    set(state => {
      if (!state.board) return state;
      const updated = orderedIds.map((id, i) => {
        const c = state.board!.columns.find(c => c.id === id)!;
        api.put(`/columns/${id}`, { position: i }).catch(() => {});
        return { ...c, position: i };
      });
      return { board: { ...state.board, columns: updated } };
    });
  },

  updateItem: async (itemId, updates) => {
    const { data } = await api.put(`/items/${itemId}`, updates);
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, items: state.board.items.map(i => i.id === itemId ? data : i) } };
    });
  },

  deleteItem: async (itemId) => {
    await api.delete(`/items/${itemId}`);
    set(state => {
      if (!state.board) return state;
      return {
        board: {
          ...state.board,
          items: state.board.items.filter(i => i.id !== itemId),
          values: state.board.values.filter(v => v.item_id !== itemId),
        }
      };
    });
  },

  moveItem: async (itemId, groupId, position) => {
    await api.put(`/items/${itemId}/move`, { group_id: groupId, position });
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, items: state.board.items.map(i => i.id === itemId ? { ...i, group_id: groupId, position } : i) } };
    });
  },

  addGroup: async (name, color) => {
    if (!get().board) return;
    const { data } = await api.post('/groups', { board_id: get().board!.id, name, color });
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, groups: [...state.board.groups, data] } };
    });
  },

  updateGroup: async (groupId, updates) => {
    const { data } = await api.put(`/groups/${groupId}`, updates);
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, groups: state.board.groups.map(g => g.id === groupId ? data : g) } };
    });
  },

  deleteGroup: async (groupId) => {
    await api.delete(`/groups/${groupId}`);
    set(state => {
      if (!state.board) return state;
      const deletedItemIds = state.board.items.filter(i => i.group_id === groupId).map(i => i.id);
      return {
        board: {
          ...state.board,
          groups: state.board.groups.filter(g => g.id !== groupId),
          items: state.board.items.filter(i => i.group_id !== groupId),
          values: state.board.values.filter(v => !deletedItemIds.includes(v.item_id)),
        }
      };
    });
  },

  addColumn: async (name, type) => {
    if (!get().board) return;
    const { data } = await api.post('/columns', { board_id: get().board!.id, name, type });
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, columns: [...state.board.columns, data] } };
    });
  },

  updateColumn: async (columnId, updates) => {
    const { data } = await api.put(`/columns/${columnId}`, updates);
    set(state => {
      if (!state.board) return state;
      return { board: { ...state.board, columns: state.board.columns.map(c => c.id === columnId ? data : c) } };
    });
  },

  deleteColumn: async (columnId) => {
    await api.delete(`/columns/${columnId}`);
    set(state => {
      if (!state.board) return state;
      return {
        board: {
          ...state.board,
          columns: state.board.columns.filter(c => c.id !== columnId),
          values: state.board.values.filter(v => v.column_id !== columnId),
        }
      };
    });
  },

  updateBoard: async (updates) => {
    if (!get().board) return;
    const { data } = await api.put(`/boards/${get().board!.id}`, updates);
    set(state => state.board ? { board: { ...state.board, ...data } } : state);
  },

  getItemValues: (itemId) => get().board?.values.filter(v => v.item_id === itemId) ?? [],

  getValue: (itemId, columnId) => get().board?.values.find(v => v.item_id === itemId && v.column_id === columnId)?.value ?? null,
}));
