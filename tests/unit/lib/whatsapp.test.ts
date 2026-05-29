import { whatsappWebLink } from '@/lib/whatsapp';
import { describe, expect, it } from 'vitest';

describe('whatsappWebLink', () => {
  it('builds a WhatsApp Web send link with the number digits and pre-filled text', () => {
    expect(whatsappWebLink('+447911000001', 'Hi Tom')).toBe(
      'https://web.whatsapp.com/send?phone=447911000001&text=Hi%20Tom',
    );
  });

  it('strips the leading + and any spaces or dashes from the number', () => {
    expect(whatsappWebLink('+44 7911-000 001', 'Hello')).toBe(
      'https://web.whatsapp.com/send?phone=447911000001&text=Hello',
    );
  });

  it('accepts a number with no leading +', () => {
    expect(whatsappWebLink('447911000001', 'Hello')).toBe(
      'https://web.whatsapp.com/send?phone=447911000001&text=Hello',
    );
  });

  it('URL-encodes special characters in the message body', () => {
    expect(whatsappWebLink('+447911000001', 'Job for Tom & co: 50% off?')).toBe(
      'https://web.whatsapp.com/send?phone=447911000001&text=Job%20for%20Tom%20%26%20co%3A%2050%25%20off%3F',
    );
  });

  it('always targets web.whatsapp.com so the open session is reused (not wa.me)', () => {
    const link = whatsappWebLink('+447911000001', 'Anything');
    expect(link.startsWith('https://web.whatsapp.com/send?')).toBe(true);
    expect(link).not.toContain('wa.me');
  });
});
