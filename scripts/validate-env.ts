#!/usr/bin/env tsx
/**
 * Environment variable validation script
 *
 * Run: pnpm validate:env
 *
 * Validates that all required environment variables are set
 * and configured correctly before build or deployment.
 *
 * This is particularly useful in CI/CD pipelines to catch
 * missing configuration early.
 */

import * as fs from 'fs'
import * as path from 'path'

const PROJECT_ROOT = path.resolve(process.cwd())
const ENV_FILE = path.join(PROJECT_ROOT, '.env')

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

interface ValidationResult {
  variable: string
  required: boolean
  found: boolean
  hasValue: boolean
  hasPlaceholder: boolean
  value?: string
}

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function loadEnvFile(): Map<string, string> {
  const envVars = new Map<string, string>()

  if (!fs.existsSync(ENV_FILE)) {
    return envVars
  }

  const content = fs.readFileSync(ENV_FILE, 'utf-8')
  const lines = content.split('\n')

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue
    }

    const match = line.match(/^([^=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].trim()
      envVars.set(key, value)
    }
  }

  return envVars
}

// Required environment variables
const REQUIRED_VARS = [
  {
    name: 'DATABASE_URL',
    description: 'MongoDB connection string',
    example: 'mongodb://127.0.0.1/a-guy-dev',
    placeholders: ['your-database-name'],
  },
  {
    name: 'PAYLOAD_SECRET',
    description: 'Secret used to encrypt JWT tokens',
    example: 'generated-32-character-secret',
    placeholders: ['YOUR_SECRET_HERE'],
  },
  {
    name: 'NEXT_PUBLIC_SERVER_URL',
    description: 'Public URL of the server (no trailing slash)',
    example: 'http://localhost:3000',
    placeholders: [],
  },
  {
    name: 'CRON_SECRET',
    description: 'Secret used to authenticate cron jobs',
    example: 'generated-32-character-secret',
    placeholders: ['YOUR_CRON_SECRET_HERE'],
  },
  {
    name: 'PREVIEW_SECRET',
    description: 'Secret used to validate preview requests',
    example: 'generated-16-character-secret',
    placeholders: ['YOUR_SECRET_HERE'],
  },
]

// Optional but recommended
const OPTIONAL_VARS = [
  {
    name: 'LOG_LEVEL',
    description: 'Logging level (trace, debug, info, warn, error, fatal)',
    example: 'info',
    placeholders: [],
  },
  {
    name: 'NEXT_PUBLIC_SENTRY_DSN',
    description: 'Sentry DSN for error tracking',
    example: 'https://...@sentry.io/...',
    placeholders: [],
  },
  {
    name: 'GEMINI_API_KEY',
    description: 'Google Gemini AI API Key',
    example: 'your-gemini-api-key-here',
    placeholders: ['your-gemini-api-key-here'],
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    description: 'Vercel Blob Storage token',
    example: 'vercel_blob_XXXX',
    placeholders: ['vercel_blob_XXXX'],
  },
]

function validateVariable(
  varName: string,
  description: string,
  placeholders: string[],
  envVars: Map<string, string>,
  processEnv: NodeJS.ProcessEnv,
  required: boolean,
): ValidationResult {
  // Check .env file
  const fileValue = envVars.get(varName)

  // Check process.env (takes precedence)
  const processValue = processEnv[varName]

  const value = processValue || fileValue
  const found = !!value
  const hasValue = found && value.length > 0

  // Check for placeholder values
  const hasPlaceholder = placeholders.some((placeholder) => value?.includes(placeholder))

  return {
    variable: varName,
    required,
    found,
    hasValue,
    hasPlaceholder,
    value: hasValue && !hasPlaceholder ? value : undefined,
  }
}

function validateEnvironment(): { passed: boolean; results: ValidationResult[] } {
  const envVars = loadEnvFile()
  const results: ValidationResult[] = []

  // Validate required variables
  for (const varConfig of REQUIRED_VARS) {
    const result = validateVariable(
      varConfig.name,
      varConfig.description,
      varConfig.placeholders,
      envVars,
      process.env,
      true,
    )
    results.push(result)
  }

  // Validate optional variables
  for (const varConfig of OPTIONAL_VARS) {
    const result = validateVariable(
      varConfig.name,
      varConfig.description,
      varConfig.placeholders,
      envVars,
      process.env,
      false,
    )
    results.push(result)
  }

  // Check if validation passed
  const failedRequired = results.filter((r) => r.required && (!r.hasValue || r.hasPlaceholder))

  return {
    passed: failedRequired.length === 0,
    results,
  }
}

function printResults(results: ValidationResult[]): void {
  log('\n━━━ Required Variables ━━━\n', colors.cyan + colors.bright)

  const requiredResults = results.filter((r) => r.required)
  for (const result of requiredResults) {
    if (result.hasValue && !result.hasPlaceholder) {
      log(`✅ ${result.variable}`, colors.green)
      if (result.value) {
        const displayValue =
          result.value.length > 40 ? result.value.substring(0, 40) + '...' : result.value
        log(`   ${displayValue}`, colors.reset)
      }
    } else if (!result.found || !result.hasValue) {
      log(`❌ ${result.variable}`, colors.red)
      log('   Missing or empty', colors.red)
    } else if (result.hasPlaceholder) {
      log(`⚠️  ${result.variable}`, colors.yellow)
      log('   Contains placeholder value', colors.yellow)
    }
  }

  log('\n━━━ Optional Variables ━━━\n', colors.cyan + colors.bright)

  const optionalResults = results.filter((r) => !r.required)
  for (const result of optionalResults) {
    if (result.hasValue && !result.hasPlaceholder) {
      log(`✅ ${result.variable}`, colors.green)
    } else if (result.hasPlaceholder) {
      log(`⚠️  ${result.variable}`, colors.yellow)
      log('   Contains placeholder value', colors.yellow)
    } else {
      log(`➖ ${result.variable}`, colors.reset)
      log('   Not set (optional)', colors.reset)
    }
  }
}

function printFixInstructions(results: ValidationResult[]): void {
  const issues = results.filter((r) => r.required && (!r.hasValue || r.hasPlaceholder))

  if (issues.length === 0) {
    return
  }

  log('\n━━━ Fix Instructions ━━━\n', colors.cyan + colors.bright)

  log('Run one of the following:\n', colors.yellow)
  log('1. Automated setup (recommended):', colors.bright)
  log('   pnpm setup\n', colors.green)
  log('2. Manual fix:', colors.bright)
  log('   - Copy .env.example to .env', colors.reset)
  log('   - Replace placeholder values with real values', colors.reset)
  log('   - Generate secrets: openssl rand -hex 32\n', colors.reset)

  log('Missing/Invalid variables:', colors.red)
  for (const issue of issues) {
    const varConfig = REQUIRED_VARS.find((v) => v.name === issue.variable)
    if (varConfig) {
      log(`\n${issue.variable}:`, colors.bright)
      log(`  Description: ${varConfig.description}`, colors.reset)
      log(`  Example: ${varConfig.example}`, colors.reset)
    }
  }
}

async function main(): Promise<void> {
  log(`\n${colors.bright}${colors.cyan}🔍 Environment Variable Validation${colors.reset}\n`)

  // Check if .env file exists
  if (!fs.existsSync(ENV_FILE)) {
    log('❌ .env file not found', colors.red)
    log('\nRun: pnpm setup', colors.yellow)
    process.exit(1)
  }

  // Validate environment
  const { passed, results } = validateEnvironment()

  // Print results
  printResults(results)

  // Print summary
  log('\n━━━ Summary ━━━\n', colors.cyan + colors.bright)

  if (passed) {
    log('✅ All required environment variables are configured correctly\n', colors.green)
    process.exit(0)
  } else {
    const failedCount = results.filter(
      (r) => r.required && (!r.hasValue || r.hasPlaceholder),
    ).length

    log(
      `❌ ${failedCount} required variable${failedCount > 1 ? 's' : ''} missing or invalid\n`,
      colors.red,
    )
    printFixInstructions(results)
    process.exit(1)
  }
}

main()
