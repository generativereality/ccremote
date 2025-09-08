#!/usr/bin/env node

export interface CLIOption {
  type: 'string' | 'boolean' | 'number'
  description?: string
  default?: any
  required?: boolean
}

export interface CLICommand {
  description: string
  options?: Record<string, CLIOption>
  handler: (options: Record<string, any>) => Promise<void> | void
}

export interface CLIConfig {
  name: string
  version: string
  commands: Record<string, () => Promise<{ default: CLICommand }>>
}

export function createCLI(config: CLIConfig) {
  return {
    async run() {
      const args = process.argv.slice(2)
      const commandName = args[0]
      
      if (!commandName || commandName === 'help' || commandName === '--help') {
        showHelp(config)
        return
      }
      
      if (commandName === '--version') {
        console.log(config.version)
        return
      }
      
      const commandImporter = config.commands[commandName]
      if (!commandImporter) {
        console.error(`Unknown command: ${commandName}`)
        console.error(`Run '${config.name} help' for available commands`)
        process.exit(1)
      }
      
      try {
        const commandModule = await commandImporter()
        const command = commandModule.default
        
        // Parse options
        const options = parseOptions(args.slice(1), command.options || {})
        
        // Validate required options
        for (const [key, option] of Object.entries(command.options || {})) {
          if (option.required && options[key] === undefined) {
            console.error(`Missing required option: --${key}`)
            process.exit(1)
          }
        }
        
        await command.handler(options)
      } catch (error) {
        console.error('Command failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
    }
  }
}

function parseOptions(args: string[], optionDefs: Record<string, CLIOption>): Record<string, any> {
  const options: Record<string, any> = {}
  
  // Set defaults
  for (const [key, def] of Object.entries(optionDefs)) {
    if (def.default !== undefined) {
      options[key] = def.default
    }
  }
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const optionDef = optionDefs[key]
      
      if (!optionDef) {
        console.error(`Unknown option: ${arg}`)
        process.exit(1)
      }
      
      if (optionDef.type === 'boolean') {
        options[key] = true
      } else {
        const value = args[i + 1]
        if (!value || value.startsWith('--')) {
          console.error(`Option ${arg} requires a value`)
          process.exit(1)
        }
        
        options[key] = optionDef.type === 'number' ? parseInt(value, 10) : value
        i++ // Skip next arg since we consumed it
      }
    }
  }
  
  return options
}

function showHelp(config: CLIConfig) {
  console.log(`${config.name} v${config.version}`)
  console.log('')
  console.log('Commands:')
  
  for (const commandName of Object.keys(config.commands)) {
    console.log(`  ${commandName}`)
  }
  
  console.log('')
  console.log(`Run '${config.name} <command> --help' for command-specific help`)
}