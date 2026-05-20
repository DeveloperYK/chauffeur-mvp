'use client';

import { Select } from '@/components/ui/field';
import type { OperatorSummary } from '@/server/services/operators';

interface Props {
  action: (formData: FormData) => void | Promise<void>;
  bookingId: string;
  operators: OperatorSummary[];
  currentOperatorId: string | null;
}

/**
 * Assignee picker that saves the moment a selection is made — no confirm
 * button. Submits the enclosing form on change (Jira-style instant assign).
 */
export function AssigneeSelect({ action, bookingId, operators, currentOperatorId }: Props) {
  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <Select
        name="operatorId"
        defaultValue={currentOperatorId ?? ''}
        className="max-w-[220px]"
        aria-label="Assign operator"
        onChange={(e) => {
          e.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="">Unassigned</option>
        {operators.map((op) => (
          <option key={op.id} value={op.id}>
            {op.name}
          </option>
        ))}
      </Select>
    </form>
  );
}
