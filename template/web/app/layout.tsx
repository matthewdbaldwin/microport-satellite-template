import './globals.css';
import { getLocale, getMessages } from 'next-intl/server';
import { themeScript } from '@/lib/theme';
import { AuthProvider } from '@/contexts/AuthContext';
import { LocaleProvider } from '@/components/LocaleProvider';
import { BugReportButton } from '@/components/BugReportButton';

// metadataBase resolves relative OG/canonical URLs against the real prod host
// (next warns + falls back to localhost without it). Fleet-wide 2026-07-01.
export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://__APP_SLUG__.microport.com'),
  title: '__APP_TITLE__',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Apply stored theme before paint (no flash). theme.ts is server-safe. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <LocaleProvider locale={locale} messages={messages}>
          <AuthProvider>
            {children}
            <BugReportButton />
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
