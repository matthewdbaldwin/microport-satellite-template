'use client';

// Floating "Report a bug" — the launcher + form come from microport-ui; this
// file supplies only __APP_NAME__'s transport and strings. Every AUTHED user can
// file; the report POSTs to /api/bug-reports, which signs + forwards it to the
// central queue (hub-first, SalesPort fallback). bug-report-fanout.
import { useTranslations } from 'next-intl';
import { BugReportLauncher } from '@matthewdbaldwin/microport-ui';
import type { BugReportPayload, BugReportResult } from '@matthewdbaldwin/microport-ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

export function BugReportButton() {
  const t = useTranslations('bug');
  const { user } = useAuth();

  async function submit(p: BugReportPayload): Promise<BugReportResult> {
    try {
      if (p.screenshot) {
        // Multipart path — the api() helper forces a JSON Content-Type, which
        // breaks the multipart boundary, so raw fetch with the CSRF header +
        // cookies (NO Content-Type; the browser sets the multipart boundary).
        const form = new FormData();
        form.append('title', p.title);
        form.append('description', p.description);
        form.append('priority', p.priority);
        form.append('pageUrl', p.pageUrl);
        if (p.browserAgent) form.append('browserAgent', p.browserAgent);
        if (p.viewportSize) form.append('viewportSize', p.viewportSize);
        if (p.appVersion) form.append('appVersion', p.appVersion);
        form.append('eventId', p.eventId);
        form.append('screenshot', p.screenshot);
        const res = await fetch('/api/bug-reports', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': '__APP_SLUG__-web' },
          body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const { screenshot: _screenshot, ...json } = p;
        await api('/api/bug-reports', { method: 'POST', body: JSON.stringify(json) });
      }
      return { ok: true };
    } catch {
      return { error: t('errorSend') };
    }
  }

  return (
    <BugReportLauncher
      enabled={!!user}
      appVersion={APP_VERSION}
      submit={submit}
      labels={{
        launcher: t('label'),
        title: t('label'),
        close: t('close'),
        fieldTitle: t('titleLabel'),
        fieldTitlePlaceholder: t('titlePlaceholder'),
        fieldDescription: t('detailLabel'),
        fieldDescriptionPlaceholder: t('detailPlaceholder'),
        fieldPriority: t('priorityLabel'),
        priorityLow: t('priority_low'),
        priorityNormal: t('priority_normal'),
        priorityHigh: t('priority_high'),
        priorityCritical: t('priority_critical'),
        fieldScreenshot: t('screenshotLabel'),
        screenshotPrivacyWarning: t('screenshotPrivacyWarning'),
        screenshotAddTitle: t('screenshotAddTitle'),
        screenshotDropHint: t('screenshotHint'),
        screenshotDropActive: t('screenshotDropActive'),
        screenshotMaxSize: t('screenshotMaxSize'),
        screenshotOptimizing: t('screenshotOptimizing'),
        screenshotPreviewAlt: t('screenshotPreviewAlt'),
        chooseScreenshot: t('screenshotChoose'),
        replaceScreenshot: t('screenshotReplace'),
        removeScreenshot: t('screenshotRemove'),
        capturedContext: t('capturedContext'),
        ctxPage: t('ctxPage'),
        ctxViewport: t('ctxViewport'),
        ctxAppVersion: t('ctxAppVersion'),
        ctxBrowser: t('ctxBrowser'),
        errorTitleRequired: t('errorTitle'),
        errorDescriptionRequired: t('errorDetail'),
        errorScreenshotTooLarge: t('errorScreenshotTooLarge'),
        errorScreenshotNotAnImage: t('errorScreenshotNotAnImage'),
        errorSubmitFailed: t('errorSend'),
        cancel: t('cancel'),
        submit: t('send'),
        submitting: t('sending'),
      }}
    />
  );
}
