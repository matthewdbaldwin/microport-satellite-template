// web/lib/help/content/getting-started.ts — __APP_NAME__ Help Library.
// SCAFFOLD article: grounded in the template's auth flow (SSO only, no local
// password; roles granted from the hub's People & Access). Rewrite the role
// list when the app's real Role enum grows past the scaffold's three.
import type { HelpArticleContent } from './types';

const gettingStarted: HelpArticleContent = {
  slug: 'getting-started',
  title: 'Signing in & your role',
  intro:
    'You sign in to __APP_NAME__ with your MicroPort account — there is no separate __APP_NAME__ password. What you can see and do is decided by the role your administrator granted you.',
  lastUpdated: '2026-08-23',
  sections: [
    {
      id: 'signing-in',
      heading: 'Signing in',
      blocks: [
        { kind: 'paragraph', text:
          '__APP_NAME__ uses single sign-on. Open the app and you are sent to the platform sign-in to authenticate; on success you are returned here with a session, and your __APP_NAME__ profile is created automatically the first time you arrive.' },
        { kind: 'paragraph', text:
          'If you land back on the sign-in screen with a message, your account may not yet be granted a __APP_NAME__ role — ask your administrator to grant one.',
          labels: ['Sign in'] },
      ],
    },
    {
      id: 'your-role',
      heading: 'What your role controls',
      blocks: [
        { kind: 'list', items: [
          '__PRIMARY_ROLE__ — the everyday working role for this app.',
          'Admin — manages the app’s data and settings.',
          'Superuser — full access, including administrative recovery.',
        ] },
        { kind: 'paragraph', text:
          'Roles are granted centrally by your administrator, not inside __APP_NAME__ itself. If something you expect to see is missing, check with them which role you hold.' },
      ],
    },
  ],
};

export default gettingStarted;
