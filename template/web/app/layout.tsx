import './globals.css';
import { getLocale, getMessages } from 'next-intl/server';
import { themeScript } from '@/lib/theme';
import { AuthProvider } from '@/contexts/AuthContext';
import { LocaleProvider } from '@/components/LocaleProvider';
import { BugReportButton } from '@/components/BugReportButton';

export const metadata = { title: '__APP_TITLE__' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Apply stored theme before paint (no flash). theme.ts is server-safe. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
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
