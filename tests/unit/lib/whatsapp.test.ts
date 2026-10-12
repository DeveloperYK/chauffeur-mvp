import { whatsappLinkForPhone, whatsappMobileLink, whatsappWebLink } from '@/lib/whatsapp';
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

describe('whatsappMobileLink', () => {
  it('targets wa.me with digits only and an encoded message', () => {
    expect(whatsappMobileLink('+44 7700 900001', 'Hi Mario, job?')).toBe(
      'https://wa.me/447700900001?text=Hi%20Mario%2C%20job%3F',
    );
  });
});

describe('whatsappLinkForPhone', () => {
  it('rewrites a WhatsApp Web send link to wa.me so the phone opens the app', () => {
    expect(
      whatsappLinkForPhone('https://web.whatsapp.com/send?phone=447700900001&text=Hi%20Mario'),
    ).toBe('https://wa.me/447700900001?text=Hi%20Mario');
  });

  it('keeps the encoded message exactly as built', () => {
    const web = whatsappWebLink('+447911000001', 'Job for Tom & co: 50% off?');
    expect(whatsappLinkForPhone(web)).toBe(
      'https://wa.me/447911000001?text=Job%20for%20Tom%20%26%20co%3A%2050%25%20off%3F',
    );
  });

  it('round-trips with whatsappMobileLink', () => {
    expect(whatsappLinkForPhone(whatsappWebLink('+447700900001', 'Hello there'))).toBe(
      whatsappMobileLink('+447700900001', 'Hello there'),
    );
  });

  it('leaves a link alone when it is not a WhatsApp Web send link', () => {
    expect(whatsappLinkForPhone('https://wa.me/447700900001?text=Hi')).toBe(
      'https://wa.me/447700900001?text=Hi',
    );
    expect(whatsappLinkForPhone('tel:+447700900001')).toBe('tel:+447700900001');
    expect(whatsappLinkForPhone('not a url')).toBe('not a url');
  });

  it('only rewrites https links to the real host, never http or credentialed ones', () => {
    expect(whatsappLinkForPhone('http://web.whatsapp.com/send?phone=447700900001&text=Hi')).toBe(
      'http://web.whatsapp.com/send?phone=447700900001&text=Hi',
    );
    expect(
      whatsappLinkForPhone('https://user:pw@web.whatsapp.com/send?phone=447700900001&text=Hi'),
    ).toBe('https://user:pw@web.whatsapp.com/send?phone=447700900001&text=Hi');
  });

  it('leaves a link alone when the phone has no digits', () => {
    expect(whatsappLinkForPhone('https://web.whatsapp.com/send?phone=abc&text=Hi')).toBe(
      'https://web.whatsapp.com/send?phone=abc&text=Hi',
    );
  });

  it('leaves a WhatsApp Web link without a phone alone', () => {
    expect(whatsappLinkForPhone('https://web.whatsapp.com/send?text=Hi')).toBe(
      'https://web.whatsapp.com/send?text=Hi',
    );
  });
});
