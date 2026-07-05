import { fieldErrorsFromIssues } from '@/lib/form-errors';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function issuesFor(schema: z.ZodTypeAny, value: unknown) {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues;
}

describe('fieldErrorsFromIssues', () => {
  const schema = z
    .object({
      pickupAddress: z.string().min(3, 'Pickup address is required'),
      execMobile: z.string().min(1, 'Phone number is required'),
    })
    .strict();

  it('maps one message per field, keyed by the field name', () => {
    const errors = fieldErrorsFromIssues(issuesFor(schema, { pickupAddress: 'x', execMobile: '' }));
    expect(errors).toEqual({
      pickupAddress: 'Pickup address is required',
      execMobile: 'Phone number is required',
    });
  });

  it('keeps only the first message for a repeated field', () => {
    const dup: z.ZodIssue[] = [
      { code: 'custom', path: ['execMobile'], message: 'first' },
      { code: 'custom', path: ['execMobile'], message: 'second' },
    ];
    expect(fieldErrorsFromIssues(dup)).toEqual({ execMobile: 'first' });
  });

  it('groups a path-less issue under _form', () => {
    const formLevel: z.ZodIssue[] = [{ code: 'custom', path: [], message: 'Something is off' }];
    expect(fieldErrorsFromIssues(formLevel)).toEqual({ _form: 'Something is off' });
  });

  it('returns an empty object when there are no issues', () => {
    expect(fieldErrorsFromIssues([])).toEqual({});
  });
});
