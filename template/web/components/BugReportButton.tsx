'use client';

// Floating "Report a bug" — the launcher + form come from microport-ui; this
// file supplies only __APP_NAME__'s transport, strings and testIds. Every AUTHED
// user can file; the report POSTs to /api/bug-reports, which signs + forwards it
// to the central queue (hub-first, SalesPort fallback). bug-report-fanout.
//
// Three things a hoisted shell still needs FROM the app — copy this shape into
// every other lib shell you mount (microport-ui >= 0.60.1):
//   • `labels.close` — the Dialog ✕ falls back to a hardcoded English "Close"
//     when it is absent, which is a live zh/fr regression, not a nit.
//   • `slotProps` — the shell owns the DOM, so the app's `testId(NS, ...)`
//     spreads have to be handed in per slot or e2e loses every inner selector.
//     (The launcher BUTTON is the exception: address it by its own
//     `[data-bug-report-launcher]` attribute. `buttonProps` is typed as a bare
//     `ButtonHTMLAttributes` in 0.60.1, so a `data-*` spread does not fit it.)
//   • `capturePageUrl` — the payload default is `pathname + search`; this app
//     files the absolute URL, so it asks for "href" rather than re-deriving it
//     in `submit`.
import { useTranslations } from 'next-intl';
import { BugReportLauncher } from '@matthewdbaldwin/microport-ui';
import type { BugReportPayload, BugReportResult } from '@matthewdbaldwin/microport-ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { testId } from '@/lib/i18nIds';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
// testId namespace for the bug-report surface — matches the `bug` i18n namespace.
const NS = 'bug';

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
      // The absolute URL, not pathname+search: HubPort's queue shows the full
      // link back to the page the reporter was on.
      capturePageUrl="href"
      // The form's DOM lives in the lib; these put this app's testIds back on
      // it. `content` is the dialog surface — data-testid only, never a
      // landmark() `id`, because Radix owns the Content element's id.
      slotProps={{
        content:     testId(NS, 'panel'),
        close:       testId(NS, 'close'),
        title:       testId(NS, 'title'),
        description: testId(NS, 'description'),
        priority:    testId(NS, 'priority'),
        screenshot:  testId(NS, 'screenshotInput'),
        cancel:      testId(NS, 'cancel'),
        submit:      testId(NS, 'submit'),
      }}
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
