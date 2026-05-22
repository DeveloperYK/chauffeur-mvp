import type { Metadata } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chauffeur Dispatch',
  description: 'Operator dashboard',
  robots: { index: false, follow: false },
};

const googlePlacesApiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full">
        {children}
        {googlePlacesApiKey ? (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${googlePlacesApiKey}&libraries=places`}
            strategy="lazyOnload"
          />
        ) : null}
      </body>
    </html>
  );
}
