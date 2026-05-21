import { avatarInitials } from '@/components/console/avatar';
import { describe, expect, it } from 'vitest';

describe('avatarInitials', () => {
  it('uses first + second initial for a full name', () => {
    expect(avatarInitials('Yousuf Khan')).toBe('YK');
    expect(avatarInitials('Priya Shah')).toBe('PS');
  });

  it('uses a single initial for a one-word name', () => {
    expect(avatarInitials('Alice')).toBe('A');
  });

  it('uses the first two initials of three-part names', () => {
    expect(avatarInitials('Sophia Anne Lefevre')).toBe('SA');
  });

  it('uppercases', () => {
    expect(avatarInitials('marcus bell')).toBe('MB');
  });

  it('handles extra whitespace', () => {
    expect(avatarInitials('  Tom   Wright  ')).toBe('TW');
  });

  it('falls back to ? for empty', () => {
    expect(avatarInitials('')).toBe('?');
    expect(avatarInitials('   ')).toBe('?');
  });
});
