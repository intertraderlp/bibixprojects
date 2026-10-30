export type UserRole = 'super_admin' | 'admin' | 'user' | 'readonly';

export type AppModule = 'boards' | 'calendar' | 'bibixbot' | 'scheduling' | 'crm' | 'instagram' | 'linkedin' | 'marketing' | 'invoices';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  role?: UserRole;
  permissions?: Partial<Record<AppModule, boolean>>;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  created_at: string;
  role: string;
}

export interface Board {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  icon: string;
  created_by: string;
  created_at: string;
  workspace_name?: string; // populated for boards shared directly (not via workspace)
  access?: string;
}

export interface UserGroup {
  id: string;
  name: string;
  color: string;
  member_count?: number;
  created_at?: string;
}

export type ColumnType = 'text' | 'status' | 'person' | 'date' | 'number' | 'checkbox' | 'tags' | 'priority' | 'link' | 'timeline' | 'attachments' | 'formula' | 'time_tracking';

export interface StatusOption {
  label: string;
  color: string;
}

export interface ColumnSettings {
  options?: StatusOption[];
  summary?: string;
  formula?: string;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  position: number;
  width?: number;
}

export interface MessageTemplate {
  id: string;
  board_id: string;
  name: string;
  target_column: string;
  body: string;
  ai_provider: string | null;
  apply_styling: number;
  position: number;
  created_by?: string;
  created_at?: string;
}

export interface Group {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
  collapsed: number;
}

export interface Item {
  id: string;
  group_id: string;
  board_id: string;
  name: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  parent_item_id?: string | null;
}

export interface ItemValue {
  id: string;
  item_id: string;
  column_id: string;
  value: string | null;
  updated_at: string;
}

export interface Update {
  id: string;
  item_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_color: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: number;
  created_at: string;
}

export interface Automation {
  id: string;
  board_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  enabled: number;
  created_at: string;
}

export interface BoardData extends Board {
  columns: Column[];
  groups: Group[];
  items: Item[];
  values: ItemValue[];
}

export type ViewType = 'table' | 'kanban' | 'calendar' | 'gantt';
