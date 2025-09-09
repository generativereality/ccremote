import { defineConfig } from 'vitepress';
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons';
import llmstxt from 'vitepress-plugin-llms';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(defineConfig({
	title: 'ccremote',
	description: 'Remote Claude Code control with auto-continuation and Discord notifications',
	base: '/',
	cleanUrls: true,
	ignoreDeadLinks: true,

	head: [
		['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
		['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
		['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' }],
		['link', { rel: 'shortcut icon', href: '/favicon.png' }],
		['meta', { name: 'theme-color', content: '#5865f2' }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:locale', content: 'en' }],
		['meta', { property: 'og:title', content: 'ccremote | Remote Claude Code Control' }],
		['meta', { property: 'og:site_name', content: 'ccremote' }],
		['meta', { property: 'og:description', content: 'Remote Claude Code control with auto-continuation and Discord notifications' }],
		['meta', { property: 'og:image', content: 'https://ccremote.dev/og-image.png' }],
		['meta', { property: 'og:url', content: 'https://ccremote.dev' }],
		['meta', { name: 'twitter:card', content: 'summary_large_image' }],
		['meta', { name: 'twitter:image', content: 'https://ccremote.dev/og-image.png' }],
	],

	themeConfig: {
		logo: '/logo.svg',

		nav: [
			{ text: 'Guide', link: '/guide/' },
			{
				text: 'Links',
				items: [
					{ text: 'GitHub', link: 'https://github.com/generativereality/ccremote' },
					{ text: 'npm', link: 'https://www.npmjs.com/package/ccremote' },
					{ text: 'Changelog', link: 'https://github.com/generativereality/ccremote/releases' },
				],
			},
		],

		sidebar: {
			'/guide/': [
				{
					text: 'Introduction',
					items: [
						{ text: 'What is ccremote?', link: '/guide/' },
						{ text: 'Installation', link: '/guide/installation' },
						{ text: 'Quick Start', link: '/guide/quick-start' },
					],
				},
				{
					text: 'Setup',
					items: [
						{ text: 'Configuration', link: '/guide/configuration' },
						{ text: 'Discord Setup', link: '/guide/discord-setup' },
					],
				},
				{
					text: 'Usage',
					items: [
						{ text: 'Session Monitoring', link: '/guide/monitoring' },
						{ text: 'Commands Reference', link: '/guide/commands' },
						{ text: 'Troubleshooting', link: '/guide/troubleshooting' },
					],
				},
			],
		},

		socialLinks: [
			{ icon: 'github', link: 'https://github.com/generativereality/ccremote' },
			{ icon: 'npm', link: 'https://www.npmjs.com/package/ccremote' },
		],

		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2025 ccremote contributors',
		},

		search: {
			provider: 'local',
		},

		editLink: {
			pattern: 'https://github.com/generativereality/ccremote/edit/main/docs/:path',
			text: 'Edit this page on GitHub',
		},

		lastUpdated: {
			text: 'Updated at',
			formatOptions: {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
				timeZone: 'UTC',
			},
		},
	},

	vite: {
		plugins: [
			groupIconVitePlugin(),
			...llmstxt(),
		],
	},

	markdown: {
		config(md) {
			md.use(groupIconMdPlugin);
		},
	},
	mermaid: {
		// Optional mermaid configuration
	},
}));