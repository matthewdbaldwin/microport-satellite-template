// web/lib/help/content/getting-started.fr.ts — traduction française de
// getting-started.ts. Article SCAFFOLD : même structure que l'anglais.
import type { HelpArticleContent } from './types';

const gettingStarted: HelpArticleContent = {
  slug: 'getting-started',
  title: 'Connexion et votre rôle',
  intro:
    'Vous vous connectez à __APP_NAME__ avec votre compte MicroPort — il n’existe pas de mot de passe __APP_NAME__ distinct. Ce que vous pouvez voir et faire dépend du rôle que votre administrateur vous a attribué.',
  lastUpdated: '2026-08-23',
  sections: [
    {
      id: 'signing-in',
      heading: 'Se connecter',
      blocks: [
        { kind: 'paragraph', text:
          '__APP_NAME__ utilise l’authentification unique. Ouvrez l’application : vous êtes redirigé vers la page de connexion de la plateforme ; en cas de succès, vous revenez ici avec une session, et votre profil __APP_NAME__ est créé automatiquement lors de votre première visite.' },
        { kind: 'paragraph', text:
          'Si vous revenez à l’écran de connexion avec un message, votre compte n’a peut-être pas encore de rôle __APP_NAME__ — demandez à votre administrateur de vous en attribuer un.' },
      ],
    },
    {
      id: 'your-role',
      heading: 'Ce que votre rôle contrôle',
      blocks: [
        { kind: 'list', items: [
          '__PRIMARY_ROLE__ — le rôle de travail quotidien de cette application.',
          'Admin — gère les données et les paramètres de l’application.',
          'Superuser — accès complet, y compris la récupération administrative.',
        ] },
        { kind: 'paragraph', text:
          'Les rôles sont attribués de manière centralisée par votre administrateur, pas dans __APP_NAME__ lui-même. S’il manque quelque chose que vous vous attendez à voir, vérifiez avec lui le rôle que vous détenez.' },
      ],
    },
  ],
  // No sibling articles yet — populate as the library grows (render-time gated).
  related: [],
};

export default gettingStarted;
