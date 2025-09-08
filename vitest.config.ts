import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		includeSource: ['src/**/*.ts'],
		exclude: ['node_modules', 'dist', 'related-repos'],
	},
	define: {
		'import.meta.vitest': 'undefined',
	},
})