import { ryoppippi } from '@ryoppippi/eslint-config';

export default ryoppippi({
	type: 'lib',
	svelte: false,
	typescript: {
		tsconfigPath: './tsconfig.json',
	},
	ignores: [
		'dist/**',
		'.ccremote*/**',
		'docs/**',
		'*.config.*',
		'**/*.md',
		'**/*.json',
	],
}, {
	rules: {
		'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
		'node/prefer-global/process': 'off',
		'ts/no-unsafe-call': 'off',
		'ts/no-unsafe-member-access': 'off',
		'ts/restrict-template-expressions': 'off',
		'ts/strict-boolean-expressions': 'off',
		'antfu/no-top-level-await': 'off',
	},
});
