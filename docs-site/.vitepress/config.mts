import { defineConfig } from 'vitepress';

const repo = 'https://github.com/scrollDynasty/multi-agent-browser-mcp';

export default defineConfig({
  lang: 'en-US',
  title: 'BrowserMesh',
  description: 'Isolated multi-session browser runtime for MCP clients.',
  base: '/multi-agent-browser-mcp/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#5b5bd6' }],
    ['meta', { property: 'og:title', content: 'BrowserMesh documentation' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Isolated multi-session browser runtime for MCP clients.',
      },
    ],
  ],
  themeConfig: {
    siteTitle: 'BrowserMesh',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Concepts', link: '/concepts/sessions' },
      { text: 'Tools', link: '/tools/overview' },
      { text: 'Reference', link: '/reference/configuration' },
      { text: 'v0.1.4', link: `${repo}/releases` },
    ],
    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Why BrowserMesh', link: '/guide/why-browsermesh' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Install', link: '/guide/installation' },
            { text: 'Configure an MCP client', link: '/guide/mcp-clients' },
          ],
        },
        {
          text: 'Core concepts',
          items: [
            { text: 'Sessions and pages', link: '/concepts/sessions' },
            { text: 'Isolation and addressing', link: '/concepts/isolation' },
            { text: 'Concurrency and lifecycle', link: '/concepts/concurrency' },
            { text: 'Persistence', link: '/concepts/persistence' },
          ],
        },
        {
          text: 'MCP tools',
          items: [
            { text: 'Overview', link: '/tools/overview' },
            { text: 'Sessions and pages', link: '/tools/sessions-pages' },
            { text: 'Navigation and inspection', link: '/tools/navigation-inspection' },
            { text: 'Interaction and waits', link: '/tools/interaction' },
            { text: 'Observability and state', link: '/tools/observability-state' },
            { text: 'Complete tool index', link: '/reference/tools' },
          ],
        },
        {
          text: 'Examples',
          items: [
            { text: 'Basic browsing', link: '/examples/basic-browsing' },
            { text: 'Multi-session workflow', link: '/examples/multi-session' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Configuration', link: '/reference/configuration' },
            { text: 'CLI', link: '/reference/cli' },
            { text: 'Locators and targets', link: '/reference/locators' },
            { text: 'Errors', link: '/reference/errors' },
            { text: 'Returned data', link: '/reference/results' },
          ],
        },
        {
          text: 'Architecture & operations',
          items: [
            { text: 'Architecture', link: '/architecture/overview' },
            { text: 'Security and privacy', link: '/operations/security' },
            { text: 'Troubleshooting', link: '/operations/troubleshooting' },
          ],
        },
        {
          text: 'Development',
          items: [
            { text: 'Development setup', link: '/development/setup' },
            { text: 'Testing', link: '/development/testing' },
            { text: 'Contributing', link: '/development/contributing' },
            { text: 'Releasing', link: '/development/releasing' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'FAQ', link: '/project/faq' },
            { text: 'Changelog', link: '/project/changelog' },
            { text: 'License', link: '/project/license' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/master/docs-site/:path`, text: 'Edit this page on GitHub' },
    socialLinks: [{ icon: 'github', link: repo }],
    footer: {
      message: 'Released under the Apache License 2.0.',
      copyright: 'Copyright BrowserMesh contributors',
    },
  },
});
