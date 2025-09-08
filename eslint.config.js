import { ryoppippi } from '@ryoppippi/eslint-config'

export default ryoppippi({
	type: 'lib',
	svelte: false,
	typescript: {
		tsconfigPath: './tsconfig.json',
	},
	ignores: [
		'dist/**',
		'related-repos/**',
		'.ccremote*/**',
	],
})