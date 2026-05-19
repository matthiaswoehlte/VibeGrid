import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';

export const fontSans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap'
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap'
});
