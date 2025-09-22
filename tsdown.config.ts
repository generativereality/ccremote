import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['src/index.ts', 'src/daemon.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	// Don't bundle Discord.js and related packages to avoid package.json resolution issues
	external: (id) => {
		return id === 'discord.js' || 
		       id.startsWith('@discordjs/') || 
		       id.startsWith('discord-api-types') ||
		       id.includes('node_modules/discord.js') ||
		       id.includes('@discordjs')
	}
})