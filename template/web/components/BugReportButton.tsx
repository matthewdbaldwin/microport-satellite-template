'use client';

// Floating "Report a bug" — every authed user can file; forwards to the
// SalesPort central queue via /api/bug-reports.
//
// Rendered via createPortal to document.body so it isn't clipped by any
// overflow/transform ancestor, and Firefox actually paints it. Positioned
// bottom-20 on mobile (clear of the BottomNav) → bottom-4 on desktop, z-40.
// bug-report-fanout, feedback_helpbutton_inline_zindex.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

export function BugReportButton() {
  const t = useTranslations('bug');
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [sent, setSent] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot createPortal mount guard
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  async function submit() {
    await api('/api/bug-reports', {
      method: 'POST',
      body: JSON.stringify({ title, detail, url: window.location.href }),
    }).catch(() => {});
    setSent(true);
    setTitle(''); setDetail('');
    setTimeout(() => { setSent(false); setOpen(false); }, 1500);
  }

  return createPortal(
    <div className="fixed right-4 bottom-20 md:bottom-4 z-40">
      {open && (
        <div className="mb-2 w-72 rounded-lg p-3 shadow-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {sent ? (
            <p className="text-sm" style={{ color: 'var(--fg)' }}>{t('thanks')}</p>
          ) : (
            <div className="space-y-2">
              <input
                className="w-full rounded border px-2 py-1.5 text-sm" placeholder={t('titlePlaceholder')}
                value={title} onChange={(e) => setTitle(e.target.value)}
                style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--fg)' }}
              />
              <textarea
                className="w-full rounded border px-2 py-1.5 text-sm" rows={3} placeholder={t('detailPlaceholder')}
                value={detail} onChange={(e) => setDetail(e.target.value)}
                style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--fg)' }}
              />
              <button type="button" className="btn-primary w-full justify-center py-1.5 min-h-11" disabled={!title} onClick={submit}>
                {t('send')}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label={t('label')}
        className="btn-primary rounded-full px-4 py-2 min-h-11 shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        {t('label')}
      </button>
    </div>,
    document.body,
  );
}
