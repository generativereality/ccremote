import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts', 'src/**/*.ts'],
		exclude: ['node_modules', 'dist', 'related-repos'],
	},
})