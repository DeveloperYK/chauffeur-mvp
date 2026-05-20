import { initialsFromName } from '@/components/ui/avatar';
import { describe, expect, it } from 'vitest';

describe('initialsFromName', () => {
  it('uses first + last initial for a full name', () => {
    expect(initialsFromName('Yousuf Khan')).toBe('YK');
    expect(initialsFromName('Priya Shah')).toBe('PS');
  });

  it('uses a single initial for a one-word name', () => {
    expect(initialsFromName('Alice')).toBe('A');
  });

  it('uses first and last of three-part names', () => {
    expect(initialsFromName('Sophia Anne Lefevre')).toBe('SL');
  });

  it('uppercases', () => {
    expect(initialsFromName('marcus bell')).toBe('MB');
  });

  it('handles extra whitespace', () => {
    expect(initialsFromName('  Tom   Wright  ')).toBe('TW');
  });

  it('falls back to ? for empty', () => {
    expect(initialsFromName('')).toBe('?');
    expect(initialsFromName('   ')).toBe('?');
  });
});
