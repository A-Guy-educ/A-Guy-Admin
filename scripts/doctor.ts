#!/usr/bin/env tsx
/**
 * Development environment health check
 *
 * Run: pnpm doctor
 *
 * Diagnoses common development environment issues:
 * - Node.js version compatibility
 * - Package manager (pnpm) version
 * - Docker availability and status
 * - MongoDB connection
 * - Required environment variables
 * - Port availability
 * - Disk space
 * - Git hooks installation
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'

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
  gray: '\x1b[90m',
}

interface CheckResult {
  name: string
  passed: boolean
  message: string
  fix?: string
}

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function section(title: string) {
  log(`\n${colors.bright}${colors.cyan}━━━ ${title} ━━━${colors.reset}\n`)
}

function execCommand(command: string): string {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch {
    return ''
  }
}

function checkResult(result: CheckResult): void {
  const icon = result.passed ? '✅' : '❌'
  const color = result.passed ? colors.green : colors.red
  log(`${icon} ${result.name}`, color)
  log(`   ${result.message}`, colors.gray)
  if (!result.passed && result.fix) {
    log(`   Fix: ${result.fix}`, colors.yellow)
  }
}

function checkNodeVersion(): CheckResult {
  const version = execCommand('node --version')
  if (!version) {
    return {
      name: 'Node.js',
      passed: false,
      message: 'Node.js is not installed',
      fix: 'Install Node.js from https://nodejs.org/ (v20.9.0 or later)',
    }
  }

  const major = parseInt(version.slice(1).split('.')[0])
  const minor = parseInt(version.slice(1).split('.')[1])

  // Check: ^18.20.2 || >=20.9.0
  const isValid = (major === 18 && minor >= 20) || (major === 20 && minor >= 9) || major > 20

  return {
    name: 'Node.js Version',
    passed: isValid,
    message: isValid ? `${version} (compatible)` : `${version} (requires ^18.20.2 || >=20.9.0)`,
    fix: isValid ? undefined : 'Upgrade Node.js to v20.9.0 or later',
  }
}

function checkPnpmVersion(): CheckResult {
  const version = execCommand('pnpm --version')
  if (!version) {
    return {
      name: 'pnpm',
      passed: false,
      message: 'pnpm is not installed',
      fix: 'Install pnpm: npm install -g pnpm',
    }
  }

  const major = parseInt(version.split('.')[0])
  const isValid = major >= 9

  return {
    name: 'pnpm Version',
    passed: isValid,
    message: isValid ? `${version} (compatible)` : `${version} (requires ^9 || ^10)`,
    fix: isValid ? undefined : 'Upgrade pnpm: npm install -g pnpm@latest',
  }
}

function checkDocker(): CheckResult {
  const version = execCommand('docker --version')
  if (!version) {
    return {
      name: 'Docker',
      passed: false,
      message: 'Docker is not installed',
      fix: 'Install Docker from https://docs.docker.com/get-docker/',
    }
  }

  // Check if Docker daemon is running
  const ps = execCommand('docker ps 2>&1')
  const isRunning = !ps.includes('Cannot connect') && !ps.includes('Is the docker daemon running')

  return {
    name: 'Docker',
    passed: isRunning,
    message: isRunning ? `${version} (running)` : `${version} (daemon not running)`,
    fix: isRunning ? undefined : 'Start Docker Desktop or docker daemon',
  }
}

function checkMongoContainer(): CheckResult {
  const containers = execCommand('docker ps --filter "name=mongo" --format "{{.Names}}"')
  const isRunning = containers.includes('mongo')

  return {
    name: 'MongoDB Container',
    passed: isRunning,
    message: isRunning ? 'Running' : 'Not running',
    fix: isRunning ? undefined : 'Start MongoDB: pnpm db:start or docker-compose up -d',
  }
}

function checkMongoConnection(): CheckResult {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      name: 'MongoDB Connection',
      passed: false,
      message: 'Cannot test (no .env file)',
      fix: 'Run: pnpm setup',
    }
  }

  // Try to ping MongoDB
  const pingResult = execCommand(
    'docker exec $(docker ps -q -f name=mongo) mongosh --eval "db.adminCommand({ping: 1})" --quiet 2>&1',
  )

  const isConnected = pingResult.includes('"ok": 1') || pingResult.includes('"ok":1')

  return {
    name: 'MongoDB Connection',
    passed: isConnected,
    message: isConnected ? 'Connected' : 'Cannot connect to MongoDB',
    fix: isConnected ? undefined : 'Check MongoDB container is running: docker ps',
  }
}

function checkEnvFile(): CheckResult {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      name: 'Environment File',
      passed: false,
      message: '.env file not found',
      fix: 'Run: pnpm setup',
    }
  }

  const envContent = fs.readFileSync(ENV_FILE, 'utf-8')

  // Check for required variables
  const requiredVars = [
    'DATABASE_URL',
    'PAYLOAD_SECRET',
    'NEXT_PUBLIC_SERVER_URL',
    'CRON_SECRET',
    'PREVIEW_SECRET',
  ]

  const missing = requiredVars.filter((varName) => {
    const regex = new RegExp(`^${varName}=.+$`, 'm')
    return !regex.test(envContent)
  })

  // Check for placeholder values
  const hasPlaceholders =
    envContent.includes('YOUR_SECRET_HERE') ||
    envContent.includes('your-database-name') ||
    envContent.includes('YOUR_CRON_SECRET_HERE')

  if (missing.length > 0) {
    return {
      name: 'Environment Variables',
      passed: false,
      message: `Missing: ${missing.join(', ')}`,
      fix: 'Add missing variables to .env or run: pnpm setup',
    }
  }

  if (hasPlaceholders) {
    return {
      name: 'Environment Variables',
      passed: false,
      message: 'Contains placeholder values',
      fix: 'Run: pnpm setup to generate secure secrets',
    }
  }

  return {
    name: 'Environment Variables',
    passed: true,
    message: `All ${requiredVars.length} required variables configured`,
  }
}

function checkPortAvailability(port: number): CheckResult {
  return new Promise<CheckResult>((resolve) => {
    const server = net.createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          name: `Port ${port}`,
          passed: false,
          message: `Port ${port} is already in use`,
          fix: `Stop the process using port ${port} or use a different port`,
        })
      } else {
        resolve({
          name: `Port ${port}`,
          passed: false,
          message: `Cannot check port: ${err.message}`,
        })
      }
    })

    server.once('listening', () => {
      server.close()
      resolve({
        name: `Port ${port}`,
        passed: true,
        message: 'Available',
      })
    })

    server.listen(port)
  }) as unknown as CheckResult
}

function checkDiskSpace(): CheckResult {
  const df = execCommand('df -h . | tail -1')
  if (!df) {
    return {
      name: 'Disk Space',
      passed: true,
      message: 'Cannot check (not available on this platform)',
    }
  }

  // Parse df output: Filesystem Size Used Avail Capacity Mounted
  const parts = df.split(/\s+/)
  const availableStr = parts[3] // e.g., "120Gi"
  const capacityStr = parts[4] // e.g., "45%"

  const capacityPercent = parseInt(capacityStr)
  const hasSpace = capacityPercent < 90

  return {
    name: 'Disk Space',
    passed: hasSpace,
    message: hasSpace
      ? `${availableStr} available (${capacityStr} used)`
      : `Low disk space: ${availableStr} available (${capacityStr} used)`,
    fix: hasSpace ? undefined : 'Free up disk space',
  }
}

function checkGitHooks(): CheckResult {
  const huskyDir = path.join(PROJECT_ROOT, '.husky')
  const huskyExists = fs.existsSync(huskyDir)

  if (!huskyExists) {
    return {
      name: 'Git Hooks',
      passed: false,
      message: '.husky directory not found',
      fix: 'Run: pnpm install (will trigger prepare script)',
    }
  }

  // Check if pre-commit hook exists
  const preCommitHook = path.join(huskyDir, 'pre-commit')
  const preCommitExists = fs.existsSync(preCommitHook)

  return {
    name: 'Git Hooks',
    passed: preCommitExists,
    message: preCommitExists ? 'Installed' : 'Not properly installed',
    fix: preCommitExists ? undefined : 'Run: pnpm install',
  }
}

function checkNodeModules(): CheckResult {
  const nodeModulesDir = path.join(PROJECT_ROOT, 'node_modules')
  const nodeModulesExists = fs.existsSync(nodeModulesDir)

  if (!nodeModulesExists) {
    return {
      name: 'Node Modules',
      passed: false,
      message: 'Dependencies not installed',
      fix: 'Run: pnpm install',
    }
  }

  // Check if package-lock or other lock files exist (should only have pnpm-lock.yaml)
  const packageLock = fs.existsSync(path.join(PROJECT_ROOT, 'package-lock.json'))
  const yarnLock = fs.existsSync(path.join(PROJECT_ROOT, 'yarn.lock'))

  if (packageLock || yarnLock) {
    return {
      name: 'Node Modules',
      passed: false,
      message: 'Wrong package manager detected',
      fix: 'Remove package-lock.json/yarn.lock and run: pnpm install',
    }
  }

  return {
    name: 'Node Modules',
    passed: true,
    message: 'Installed correctly with pnpm',
  }
}

function checkTypescriptConfig(): CheckResult {
  const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) {
    return {
      name: 'TypeScript Config',
      passed: false,
      message: 'tsconfig.json not found',
      fix: 'Restore tsconfig.json from repository',
    }
  }

  return {
    name: 'TypeScript Config',
    passed: true,
    message: 'Found',
  }
}

async function main(): Promise<void> {
  log(`\n${colors.bright}${colors.cyan}🏥 A-Guy Environment Health Check${colors.reset}\n`)

  const results: CheckResult[] = []

  // System checks
  section('System Requirements')
  results.push(checkNodeVersion())
  results.push(checkPnpmVersion())
  results.push(checkDocker())
  results.forEach(checkResult)

  // Database checks
  section('Database')
  results.push(checkMongoContainer())
  results.push(checkMongoConnection())
  results.slice(-2).forEach(checkResult)

  // Environment checks
  section('Environment')
  results.push(checkEnvFile())
  results.slice(-1).forEach(checkResult)

  // Port checks
  section('Ports')
  const portCheck = await new Promise<CheckResult>((resolve) => {
    const server = net.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve({
        name: 'Port 3000',
        passed: err.code !== 'EADDRINUSE',
        message: err.code === 'EADDRINUSE' ? 'Port 3000 is in use' : 'Available',
        fix: err.code === 'EADDRINUSE' ? 'Stop the process using port 3000' : undefined,
      })
    })
    server.once('listening', () => {
      server.close()
      resolve({
        name: 'Port 3000',
        passed: true,
        message: 'Available',
      })
    })
    server.listen(3000)
  })
  results.push(portCheck)
  checkResult(portCheck)

  // Project checks
  section('Project Setup')
  results.push(checkNodeModules())
  results.push(checkTypescriptConfig())
  results.push(checkGitHooks())
  results.push(checkDiskSpace())
  results.slice(-4).forEach(checkResult)

  // Summary
  section('Summary')

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length

  if (failed === 0) {
    log(
      `\n${colors.green}${colors.bright}✅ All checks passed! (${passed}/${total})${colors.reset}`,
      colors.green,
    )
    log(
      `\n${colors.cyan}Your development environment is healthy. You're ready to code! 🚀${colors.reset}\n`,
    )
    process.exit(0)
  } else {
    log(
      `\n${colors.yellow}${colors.bright}⚠️  ${failed} issue${failed > 1 ? 's' : ''} found (${passed}/${total} checks passed)${colors.reset}`,
    )
    log(
      `\n${colors.cyan}Fix the issues above to ensure a smooth development experience.${colors.reset}\n`,
    )

    // Show quick fixes
    const fixableIssues = results.filter((r) => !r.passed && r.fix)
    if (fixableIssues.length > 0) {
      log(`${colors.bright}Quick fixes:${colors.reset}`, colors.cyan)
      fixableIssues.forEach((issue, index) => {
        log(`  ${index + 1}. ${issue.name}: ${issue.fix}`, colors.yellow)
      })
      console.log()
    }

    process.exit(1)
  }
}

main()
