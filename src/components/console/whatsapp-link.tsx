'use client';
import { whatsappLinkForPhone } from '@/lib/whatsapp';
import type { ReactNode } from 'react';
import { useIsPhone } from './use-is-phone';

interface WhatsappLinkProps {
  /** A link built by `whatsappWebLink` (server or client side). */
  href: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * A WhatsApp hand-off that opens the right thing for the device: WhatsApp Web
 * on a desk (reusing the operator's open tab), the WhatsApp app via `wa.me` on
 * a phone. The links themselves are minted on the server, which cannot know
 * the device, so the swap happens here at render time.
 */
export function WhatsappLink({ href, className, onClick, children }: WhatsappLinkProps) {
  const isPhone = useIsPhone();
  return (
    <a
      className={className}
      href={isPhone ? whatsappLinkForPhone(href) : href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {children}
    </a>
  );
}
