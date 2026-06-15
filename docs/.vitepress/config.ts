import { defineConfig } from 'vitepress'

/**
 * VitePress configuration for the LocalVision docs site.
 *
 * Local preview:  npm run docs:dev
 * Production build: npm run docs:build  →  docs/.vitepress/dist
 *
 * Deployed to GitHub Pages via .github/workflows/docs.yml on every push
 * to main. The `base` matches the repo name so asset URLs resolve under
 * https://mfaldet.github.io/localvision/.
 */
export default defineConfig({
  title: 'LocalVision',
  description:
    'Interactive community-data dashboards — Census boundaries with linked maps + charts.',
  base: '/localvision/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#3B82F6' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'LocalVision' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Interactive community-data dashboards built on US Census boundaries.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Python', link: '/python' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/mfaldet/localvision' },
          { text: 'Roadmap', link: 'https://github.com/mfaldet/localvision/blob/main/ROADMAP.md' },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Quick start', link: '/getting-started' },
          { text: 'Data binding', link: '/data-binding' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Boundaries', link: '/boundaries' },
          { text: 'Styling', link: '/styling' },
          { text: 'Templates', link: '/templates' },
        ],
      },
      {
        text: 'Integrations',
        items: [{ text: 'Python / Jupyter', link: '/python' }],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mfaldet/localvision' },
    ],

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Mac Faldet',
    },

    editLink: {
      pattern: 'https://github.com/mfaldet/localvision/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
