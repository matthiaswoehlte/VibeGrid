import type { Metadata } from 'next';
import { fontSans, fontMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeGrid',
  description: 'Music-animation studio'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${fontSans.variable} ${fontMono.variable}`}
      data-accent="electric"
    >
      <body>{children}</body>
    </html>
  );
}
