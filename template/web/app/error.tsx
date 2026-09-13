'use client';

import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { ErrorPage } from '@matthewdbaldwin/microport-ui';

// No route groups in this template's flat app/ scaffold (see layout.tsx), so
// this is the single top-level error boundary rather than a segment-scoped one.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors');

  return (
    <ErrorPage
      error={error}
      reset={reset}
      linkComponent={Link}
      backHref="/"
      onError={(err) => Sentry.captureException(err)}
      title={t('inAppErrorTitle')}
      description={t('inAppErrorDescription')}
      refLabel={t('errorRef')}
      tryAgainLabel={t('tryAgain')}
      backLabel={t('backToDashboard')}
    />
  );
}
