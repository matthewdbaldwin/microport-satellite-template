'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NotFoundPage } from '@matthewdbaldwin/microport-ui';

// / is both the dashboard/home route and the marketing "home" in this
// template (there's no separate landing page), so only the primary action
// renders — a secondary "back to home" button pointed at the same href would
// just duplicate it.
export default function NotFound() {
  const t = useTranslations('errors');

  return (
    <NotFoundPage
      linkComponent={Link}
      primaryHref="/"
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      primaryLabel={t('notFoundCtaDashboard')}
    />
  );
}
