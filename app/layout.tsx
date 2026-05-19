import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeGrid',
  description: 'Music-animation studio'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
