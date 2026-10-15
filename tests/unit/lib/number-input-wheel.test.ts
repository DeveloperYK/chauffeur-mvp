import { wheelTargetToBlur } from '@/lib/number-input-wheel';
import { describe, expect, it } from 'vitest';

// A focused <input type="number"> changes its value when the pointer wheel or
// trackpad scrolls over it. Operators scrolling the booking form were silently
// editing the price. The guard blurs the input so the scroll goes to the page.

type FakeInput = { tagName: string; type: string; blur: () => void };
const input = (type: string): FakeInput => ({ tagName: 'INPUT', type, blur: () => {} });

describe('wheelTargetToBlur', () => {
  it('returns the focused number input when the wheel event lands on it', () => {
    const el = input('number');
    expect(wheelTargetToBlur(el, el)).toBe(el);
  });

  it('ignores a number input that is hovered but not focused', () => {
    const el = input('number');
    expect(wheelTargetToBlur(el, null)).toBeNull();
    expect(wheelTargetToBlur(el, input('number'))).toBeNull();
  });

  it('ignores a focused number input when the wheel lands elsewhere', () => {
    const el = input('number');
    expect(wheelTargetToBlur({ tagName: 'DIV', type: '', blur: () => {} }, el)).toBeNull();
  });

  it('ignores text, email and datetime inputs', () => {
    for (const t of ['text', 'email', 'datetime-local', 'tel']) {
      const el = input(t);
      expect(wheelTargetToBlur(el, el)).toBeNull();
    }
  });

  it('ignores non-element targets', () => {
    expect(wheelTargetToBlur(null, input('number'))).toBeNull();
    expect(wheelTargetToBlur(undefined, null)).toBeNull();
  });
});
