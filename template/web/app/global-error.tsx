'use client';

import * as Sentry from '@sentry/nextjs';
import { GlobalErrorPage } from '@matthewdbaldwin/microport-ui';

// Replaces the root layout when IT throws, so globals.css/theme/LocaleProvider
// are all gone too — no next-intl here, English defaults only.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return <GlobalErrorPage error={error} onError={(err) => Sentry.captureException(err)} />;
}
