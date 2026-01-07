#!/usr/bin/env tsx
/**
 * Automated first-time development environment setup
 *
 * Run: pnpm setup
 *
 * This script automates the entire development setup process:
 * - Checks prerequisites (Node, pnpm, Docker)
 * - Creates and configures .env file
 * - Generates secure secrets
 * - Starts MongoDB via Docker
 * - Generates Payload types
 * - Runs quality checks
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'

const PROJECT_ROOT = path.resolve(process.cwd())
const ENV_FILE = path.join(PROJECT_ROOT, '.env')
const ENV_EXAMPLE = path.join(PROJECT_ROOT, '.env.example')

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

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function success(message: string) {
  log(`✅ ${message}`, colors.green)
}

function info(message: string) {
  log(`ℹ️  ${message}`, colors.blue)
}

function warning(message: string) {
  log(`⚠️  ${message}`, colors.yellow)
}

function error(message: string) {
  log(`❌ ${message}`, colors.red)
}

function section(title: string) {
  log(`\n${colors.bright}${colors.cyan}━━━ ${title} ━━━${colors.reset}\n`)
}

function generateSecret(length = 32): string {
  return randomBytes(length).toString('hex')
}

function execCommand(command: string, errorMessage?: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch (err) {
    if (errorMessage) {
      throw new Error(errorMessage)
    }
    throw err
  }
}

function checkPrerequisite(name: string, command: string, minVersion?: string): boolean {
  try {
    const version = execCommand(command)
    success(`${name}: ${version}`)
    return true
  } catch {
    error(`${name} is not installed or not in PATH`)
    return false
  }
}

function checkPrerequisites(): boolean {
  section('Checking Prerequisites')

  const checks = [
    checkPrerequisite('Node.js', 'node --version', '20.9.0'),
    checkPrerequisite('pnpm', 'pnpm --version', '9.0.0'),
    checkPrerequisite('Docker', 'docker --version'),
  ]

  if (!checks.every(Boolean)) {
    error('\nMissing prerequisites. Please install the required tools:')
    info('- Node.js: https://nodejs.org/ (v20.9.0 or later)')
    info('- pnpm: npm install -g pnpm')
    info('- Docker: https://docs.docker.com/get-docker/')
    return false
  }

  return true
}

function setupEnvironment(): void {
  section('Setting Up Environment')

  if (fs.existsSync(ENV_FILE)) {
    warning('.env file already exists. Skipping creation.')
    info('If you need to regenerate secrets, run: pnpm setup:secrets')
    return
  }

  // Copy .env.example to .env
  if (!fs.existsSync(ENV_EXAMPLE)) {
    error('.env.example not found')
    throw new Error('Missing .env.example file')
  }

  let envContent = fs.readFileSync(ENV_EXAMPLE, 'utf-8')

  // Generate and replace secrets
  const payloadSecret = generateSecret(32)
  const cronSecret = generateSecret(32)
  const previewSecret = generateSecret(16)

  envContent = envContent
    .replace('YOUR_SECRET_HERE', payloadSecret)
    .replace('YOUR_CRON_SECRET_HERE', cronSecret)
    .replace(/PREVIEW_SECRET=.*/g, `PREVIEW_SECRET=${previewSecret}`)

  // Set default database name
  envContent = envContent.replace(
    'mongodb://127.0.0.1/your-database-name',
    'mongodb://127.0.0.1/a-guy-dev',
  )

  fs.writeFileSync(ENV_FILE, envContent)
  success('Created .env file with secure secrets')
  info('PAYLOAD_SECRET: ••••••••••••••••••••••••••••••••')
  info('CRON_SECRET: ••••••••••••••••••••••••••••••••')
  info('PREVIEW_SECRET: ••••••••••••••••')
}

function startDatabase(): void {
  section('Starting MongoDB')

  // Check if docker-compose.yml exists
  const composeFile = path.join(PROJECT_ROOT, 'docker-compose.yml')
  if (!fs.existsSync(composeFile)) {
    warning('docker-compose.yml not found. Skipping database setup.')
    info('Make sure MongoDB is running manually or configure DATABASE_URL in .env')
    return
  }

  try {
    // Check if MongoDB is already running
    execCommand('docker ps --filter "name=mongo" --format "{{.Names}}"')
    info('MongoDB container already running')
  } catch {
    // Start MongoDB
    info('Starting MongoDB container...')
    execSync('docker-compose up -d', { stdio: 'inherit' })
    success('MongoDB started')

    // Wait for MongoDB to be ready
    info('Waiting for MongoDB to be ready...')
    let attempts = 0
    const maxAttempts = 30

    while (attempts < maxAttempts) {
      try {
        execCommand(
          'docker exec $(docker ps -q -f name=mongo) mongosh --eval "db.adminCommand({ping: 1})" --quiet',
        )
        success('MongoDB is ready')
        break
      } catch {
        attempts++
        if (attempts >= maxAttempts) {
          error('MongoDB failed to start after 30 seconds')
          throw new Error('MongoDB startup timeout')
        }
        process.stdout.write('.')
        execSync('sleep 1')
      }
    }
    console.log() // New line after dots
  }
}

function generateTypes(): void {
  section('Generating Payload Types')

  try {
    info('Generating TypeScript types from Payload config...')
    execSync('pnpm generate:types', { stdio: 'inherit' })
    success('Types generated successfully')
  } catch (err) {
    error('Failed to generate types')
    throw err
  }
}

function runQualityChecks(): void {
  section('Running Quality Checks')

  try {
    info('Running TypeScript type check...')
    execSync('pnpm typecheck', { stdio: 'inherit' })
    success('Type check passed')

    info('Running ESLint...')
    execSync('pnpm lint', { stdio: 'inherit' })
    success('Linting passed')
  } catch (err) {
    warning('Quality checks failed. You can fix these issues later.')
    info('Run: pnpm lint:fix')
  }
}

function printNextSteps(): void {
  section('Setup Complete!')

  console.log(`
${colors.green}${colors.bright}Your development environment is ready!${colors.reset}

${colors.cyan}Next steps:${colors.reset}

  1. Start the development server:
     ${colors.bright}pnpm dev${colors.reset}

  2. Access the application:
     • Frontend: ${colors.blue}http://localhost:3000${colors.reset}
     • Admin Panel: ${colors.blue}http://localhost:3000/admin${colors.reset}

  3. Create your first admin user through the admin panel

${colors.cyan}Useful commands:${colors.reset}

  • ${colors.bright}pnpm doctor${colors.reset}      - Check environment health
  • ${colors.bright}pnpm db:start${colors.reset}    - Start MongoDB
  • ${colors.bright}pnpm db:stop${colors.reset}     - Stop MongoDB
  • ${colors.bright}pnpm db:logs${colors.reset}     - View MongoDB logs
  • ${colors.bright}pnpm clean${colors.reset}       - Clean build cache

${colors.cyan}Documentation:${colors.reset}

  • Setup Guide: ${colors.blue}SETUP.md${colors.reset}
  • Agent Guide: ${colors.blue}AGENTS.md${colors.reset}
  • Design System: ${colors.blue}DESIGN_SYSTEM.md${colors.reset}

${colors.green}Happy coding! 🚀${colors.reset}
`)
}

async function main(): Promise<void> {
  try {
    log(`\n${colors.bright}${colors.cyan}🚀 A-Guy Development Environment Setup${colors.reset}\n`)

    // Step 1: Check prerequisites
    if (!checkPrerequisites()) {
      process.exit(1)
    }

    // Step 2: Setup environment
    setupEnvironment()

    // Step 3: Start database
    startDatabase()

    // Step 4: Generate types
    generateTypes()

    // Step 5: Run quality checks
    runQualityChecks()

    // Step 6: Print next steps
    printNextSteps()
  } catch (err) {
    error('\nSetup failed!')
    if (err instanceof Error) {
      error(err.message)
    }
    process.exit(1)
  }
}

main()
