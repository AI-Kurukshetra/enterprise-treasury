import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/lib/query-provider';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  variable: '--font-plex-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700']
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '500']
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  display: 'swap',
  weight: ['400']
});

export const metadata: Metadata = {
  title: {
    default: 'Atlas Treasury',
    template: '%s | Atlas Treasury'
  },
  description:
    'Enterprise Treasury & Cash Flow Command Center for global finance teams managing liquidity, risk, and payment operations.',
  applicationName: 'Atlas Treasury'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <a
          href="#main-content"
          className="focus-ring sr-only left-4 top-4 z-50 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-panel focus:not-sr-only focus:absolute"
        >
          Skip to content
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
