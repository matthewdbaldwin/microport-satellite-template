// __APP_NAME__ Help Library — content-model types. The definitions live in
// microport-ui's ./help/logic subpath (shared across satellites); this is a
// thin re-export shim so content/<slug>.ts modules import from './types'
// unchanged. The content layer is plain data — no React.
export type {
  UiLabel,
  HelpBlock,
  HelpArticleSection,
  HelpArticleContent,
} from '@matthewdbaldwin/microport-ui/help/logic';
