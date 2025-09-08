#!/usr/bin/env node

import { createCLI } from './lib/cli-framework.js'

const cli = createCLI({
  name: 'ccremote',
  version: '0.1.0',
  commands: {
    start: () => import('./commands/start.js'),
    list: () => import('./commands/list.js'), 
    stop: () => import('./commands/stop.js'),
    status: () => import('./commands/status.js')
  }
})

cli.run().catch(error => {
  console.error('CLI Error:', error)
  process.exit(1)
})