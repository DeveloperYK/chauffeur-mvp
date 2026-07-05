import type { ZodIssue } from 'zod';

/**
 * Collapse a list of Zod issues into one message per top-level field, keyed by
 * the field name (the first path segment). The first issue for a field wins, so
 * the operator sees a single, specific message under each control rather than a
 * pile of messages in one banner. Issues with an empty path are grouped under
 * the `_form` key for a form-level notice.
 */
export function fieldErrorsFromIssues(issues: readonly ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form';
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}
