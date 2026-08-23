// web/lib/help/content/getting-started.zh.ts — getting-started.ts 的中文翻译。
// SCAFFOLD 文章：与英文版结构一致，仅翻译正文。
import type { HelpArticleContent } from './types';

const gettingStarted: HelpArticleContent = {
  slug: 'getting-started',
  title: '登录与您的角色',
  intro:
    '您使用 MicroPort 账号登录 __APP_NAME__ —— 没有单独的 __APP_NAME__ 密码。您能看到和执行的内容由管理员授予您的角色决定。',
  lastUpdated: '2026-08-23',
  sections: [
    {
      id: 'signing-in',
      heading: '登录',
      blocks: [
        { kind: 'paragraph', text:
          '__APP_NAME__ 使用单点登录。打开应用后会跳转到平台登录页进行身份验证；成功后返回本应用并建立会话，首次访问时会自动创建您的 __APP_NAME__ 个人资料。' },
        { kind: 'paragraph', text:
          '如果您被带回登录页并看到提示信息，可能是您的账号尚未被授予 __APP_NAME__ 角色 —— 请联系管理员授予。' },
      ],
    },
    {
      id: 'your-role',
      heading: '角色的作用',
      blocks: [
        { kind: 'list', items: [
          '__PRIMARY_ROLE__ —— 本应用的日常工作角色。',
          '管理员（Admin）—— 管理应用的数据与设置。',
          '超级用户（Superuser）—— 拥有全部权限，包括管理性恢复操作。',
        ] },
        { kind: 'paragraph', text:
          '角色由管理员集中授予，而不是在 __APP_NAME__ 内部设置。如果您预期能看到的内容没有出现，请与管理员确认您持有的角色。' },
      ],
    },
  ],
};

export default gettingStarted;
