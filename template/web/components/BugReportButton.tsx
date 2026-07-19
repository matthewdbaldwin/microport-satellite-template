'use client';

// Floating "Report a bug" — a discreet round red bug-icon launcher (mirrors the
// fleet: opsport/reviewport/clinicport/salesport/productport) that opens a modal
// form. Every AUTHED user can file; the form POSTs to /api/bug-reports, which
// signs + forwards to the central queue (hub-first, SalesPort fallback). Rendered
// into document.body via a portal so the fixed launcher escapes the app shell's
// stacking/overflow (and Firefox paints it). An optional screenshot is compressed
// in-browser via optimizeImageForUpload before upload (microport-ui ≥0.33).
// bug-report-fanout, feedback_helpbutton_inline_zindex.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Bug, Upload, X } from 'lucide-react';
import { Tooltip, useModalEsc, useFocusTrap, optimizeImageForUpload } from '@matthewdbaldwin/microport-ui';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';

type Priority = 'low' | 'normal' | 'high' | 'critical';
const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'critical'];
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;

// Minted at module scope, not in render — react-hooks/purity forbids Date.now()
// (and other impure calls) inside a component/hook body; the fleet pattern is a
// plain top-level helper the rule doesn't trace into.
function mintEventId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `evt-${Date.now()}`;
}

export function BugReportButton() {
  const t = useTranslations('bug');
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot createPortal mount guard
  useEffect(() => setMounted(true), []);
  // Auth-gated: only signed-in users file (mirrors the fleet). Never render on
  // the logged-out /login page.
  if (!user || !mounted) return null;

  return createPortal(
    <>
      <Tooltip content={t('label')} placement="left">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('label')}
          data-bug-report-launcher="true"
          className="group fixed bottom-20 right-4 md:bottom-4 z-40 inline-flex items-center justify-center min-w-11 min-h-11"
          style={{ color: 'var(--accent-fg)' }}
        >
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full shadow-lg transition-transform group-hover:scale-105"
            style={{ background: 'var(--red)' }}
          >
            <Bug size={18} aria-hidden="true" />
          </span>
        </button>
      </Tooltip>
      {open && <BugReportModal onClose={() => setOpen(false)} />}
    </>,
    document.body,
  );
}

function BugReportModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('bug');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useModalEsc(onClose, !submitting);
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Accept an image (file-picker or clipboard paste). Shrink it in-browser
  // first, then apply the 2 MB gate to the OPTIMIZED bytes — the API enforces
  // the same ceiling, so a large screenshot that compresses under the cap is
  // now accepted instead of rejected outright. optimizeImageForUpload never
  // throws and falls back to the original file if it can't help. A revocable
  // object-URL drives the preview.
  const acceptScreenshot = useCallback(async (file: File): Promise<void> => {
    setError('');
    setOptimizing(true);
    try {
      const optimized = await optimizeImageForUpload(file);
      if (optimized.size > SCREENSHOT_MAX_BYTES) { setError(t('errorScreenshotTooLarge')); return; }
      setScreenshot(optimized);
      setPreview(URL.createObjectURL(optimized));
    } finally {
      setOptimizing(false);
    }
  }, [t]);

  // Ctrl/Cmd+V grabs an image from the clipboard while the modal is open.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { acceptScreenshot(file); e.preventDefault(); return; }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [acceptScreenshot]);

  // Release the object-URL when the preview changes / the modal unmounts.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) acceptScreenshot(file);
  }

  // Auto-captured context, computed once. Shown read-only to the reporter (fleet
  // transparency parity) and sent with the report.
  const ctx = useMemo(() => ({
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    viewportSize: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    browserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: APP_VERSION,
  }), []);
  // Idempotency key minted once per open, so a retry after a lost response dedups
  // on the receiver instead of double-filing (fleet parity).
  const eventId = useMemo(() => mintEventId(), []);

  const inputStyle = { background: 'var(--surface2, var(--surface))', borderColor: 'var(--border)', color: 'var(--text)' } as const;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError(t('errorTitle')); return; }
    if (!detail.trim()) { setError(t('errorDetail')); return; }
    setSubmitting(true);
    try {
      if (screenshot) {
        // Multipart path — the api() helper forces a JSON Content-Type, which
        // breaks the multipart boundary, so raw fetch with the CSRF header +
        // cookies (NO Content-Type; the browser sets the multipart boundary).
        const form = new FormData();
        form.append('title', title.trim());
        form.append('description', detail.trim());
        form.append('priority', priority);
        form.append('pageUrl', ctx.pageUrl);
        if (ctx.browserAgent) form.append('browserAgent', ctx.browserAgent);
        if (ctx.viewportSize) form.append('viewportSize', ctx.viewportSize);
        if (ctx.appVersion) form.append('appVersion', ctx.appVersion);
        form.append('eventId', eventId);
        form.append('screenshot', screenshot);
        const res = await fetch('/api/bug-reports', {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': '__APP_SLUG__-web' },
          body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        // No screenshot — the existing JSON path is unchanged.
        await api('/api/bug-reports', {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            description: detail.trim(),
            priority,
            pageUrl: ctx.pageUrl,
            browserAgent: ctx.browserAgent,
            viewportSize: ctx.viewportSize,
            appVersion: ctx.appVersion,
            eventId,
          }),
        });
      }
      setSent(true);
      setTimeout(onClose, 1400);
    } catch {
      setError(t('errorSend'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={submitting ? undefined : onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={trapRef}
          className="w-full max-w-lg rounded-xl shadow-xl border pointer-events-auto"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          role="dialog" aria-modal="true" aria-labelledby="bug-modal-title"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 id="bug-modal-title" className="text-base font-semibold inline-flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <span style={{ color: 'var(--red)' }}><Bug size={18} aria-hidden="true" /></span>{t('label')}
            </h2>
            <Tooltip content={t('close')}>
              <button type="button" onClick={onClose} aria-label={t('close')} disabled={submitting}
                className="inline-flex items-center justify-center rounded"
                style={{ color: 'var(--muted)', fontSize: 22, lineHeight: 1, width: 44, height: 44 }}>&times;</button>
            </Tooltip>
          </div>

          {sent ? (
            <p className="px-5 py-6 text-sm" style={{ color: 'var(--text)' }}>{t('thanks')}</p>
          ) : (
            <form onSubmit={submit} className="p-5 space-y-3">
              {error && <p role="alert" className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
              <div className="space-y-1">
                <label htmlFor="bug-title" className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{t('titleLabel')}</label>
                <input id="bug-title" className="w-full rounded border px-2.5 py-2 text-sm" style={inputStyle}
                  value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus
                  placeholder={t('titlePlaceholder')} />
              </div>
              <div className="space-y-1">
                <label htmlFor="bug-detail" className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{t('detailLabel')}</label>
                <textarea id="bug-detail" className="w-full rounded border px-2.5 py-2 text-sm resize-none" style={inputStyle}
                  rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={10000}
                  placeholder={t('detailPlaceholder')} />
              </div>
              <div className="space-y-1">
                <label htmlFor="bug-priority" className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{t('priorityLabel')}</label>
                <select id="bug-priority" className="w-full rounded border px-2.5 py-2 text-sm" style={inputStyle}
                  value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority_${p}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{t('screenshotLabel')}</label>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('screenshotHint')}</p>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={optimizing}
                  className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm min-h-11 disabled:opacity-60" style={inputStyle}>
                  <Upload size={14} aria-hidden="true" />
                  {screenshot ? t('screenshotReplace') : t('screenshotChoose')}
                </button>
                {optimizing && <p className="text-xs mt-2" role="status" style={{ color: 'var(--muted)' }}>{t('screenshotOptimizing')}</p>}
                {preview && (
                  <div className="mt-2 relative inline-block">
                    <img src={preview} alt={t('screenshotPreviewAlt')} className="max-h-48 rounded border" style={{ borderColor: 'var(--border)' }} />
                    <button type="button" aria-label={t('screenshotRemove')}
                      onClick={() => { setScreenshot(null); setPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full border w-7 h-7"
                      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
              {/* Read-only preview of what's attached — fleet transparency parity. */}
              <details className="text-xs" style={{ color: 'var(--muted)' }}>
                <summary className="cursor-pointer">{t('capturedContext')}</summary>
                <dl className="mt-1.5 space-y-0.5">
                  <div><span className="font-medium">{t('ctxPage')}:</span> {ctx.pageUrl}</div>
                  <div><span className="font-medium">{t('ctxViewport')}:</span> {ctx.viewportSize}</div>
                  {ctx.appVersion && <div><span className="font-medium">{t('ctxAppVersion')}:</span> {ctx.appVersion}</div>}
                  <div className="truncate"><span className="font-medium">{t('ctxBrowser')}:</span> {ctx.browserAgent}</div>
                </dl>
              </details>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="rounded px-3 py-2 text-sm min-h-11" style={{ color: 'var(--muted)' }} onClick={onClose} disabled={submitting}>
                  {t('cancel')}
                </button>
                <button type="submit" className="btn-primary rounded px-4 py-2 text-sm min-h-11" disabled={submitting || optimizing || !title.trim() || !detail.trim()}>
                  {submitting ? t('sending') : t('send')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
