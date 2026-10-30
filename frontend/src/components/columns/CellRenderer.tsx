import type { Column } from '../../types';
import StatusCell from './StatusCell';
import TextCell from './TextCell';
import DateCell from './DateCell';
import PersonCell from './PersonCell';
import NumberCell from './NumberCell';
import CheckboxCell from './CheckboxCell';
import TagsCell from './TagsCell';
import LinkCell from './LinkCell';
import AttachmentsCell from './AttachmentsCell';
import FormulaCell from './FormulaCell';

interface Props {
  column: Column;
  value: string | null;
  onChange: (value: string | null) => void;
  workspaceId?: string;
  itemId?: string;
}

export default function CellRenderer({ column, value, onChange, workspaceId, itemId }: Props) {
  const opts = Array.isArray(column.settings?.options) ? column.settings.options : [];

  switch (column.type) {
    case 'status':
    case 'priority':
      return <StatusCell value={value} options={opts} onChange={onChange} />;
    case 'text':
      return <TextCell value={value} onChange={onChange} />;
    case 'date':
      return <DateCell value={value} onChange={onChange} />;
    case 'person':
      return <PersonCell value={value} onChange={onChange} workspaceId={workspaceId} />;
    case 'number':
      return <NumberCell value={value} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxCell value={value} onChange={onChange} />;
    case 'tags':
      return <TagsCell value={value} onChange={onChange} />;
    case 'link':
      return <LinkCell value={value} onChange={onChange} />;
    case 'attachments':
      return itemId ? <AttachmentsCell itemId={itemId} /> : null;
    case 'formula':
      return <FormulaCell itemId={itemId} formula={(column.settings as { formula?: string })?.formula} />;
    default:
      return <TextCell value={value} onChange={onChange} />;
  }
}
