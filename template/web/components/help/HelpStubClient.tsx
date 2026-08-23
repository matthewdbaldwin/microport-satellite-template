'use client';

// web/components/help/HelpStubClient.tsx
// __APP_NAME__ adapter for the shared HelpStubPlaceholder (microport-ui
// ./help). Injects next/link + the product name so the server /help/[slug]
// page passes only serializable strings across the client boundary.
import Link from 'next/link';
import { HelpStubPlaceholder } from '@matthewdbaldwin/microport-ui/help';

export function HelpStubClient({ label, sectionTitle }: { label: string; sectionTitle: string }) {
  return <HelpStubPlaceholder label={label} sectionTitle={sectionTitle} appName="__APP_NAME__" linkComponent={Link} />;
}
