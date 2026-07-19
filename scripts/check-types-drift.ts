#!/usr/bin/env tsx
/**
 * Check that src/payload-types.ts is up to date with the current Payload
 * collection schema. Runs `payload generate:types`, compares the output to
 * the committed file, restores the committed file, and exits non-zero with
 * an actionable message if they differ.
 *
 * Safe to run anywhere (local, CI, kody verify) — does not mutate the
 * working tree on success or failure.
 */

import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'

for (const file of ['.env.test', '.env']) {
  if (existsSync(file)) {
    loadEnv({ path: file })
  }
}

const TARGET = 'src/payload-types.ts'
const BACKUP = join(tmpdir(), `payload-types.${process.pid}.bak`)

// `payload generate:types` loads payload.config.ts, which throws when
// PAYLOAD_SECRET is unset. The drift check only inspects the generated
// types file (no runtime call), so a dummy value is safe here — and needed
// because the secret check fires before PAYLOAD_GENERATE_TYPES bypasses it.
// CI exports a real secret from secrets.PAYLOAD_SECRET (see ci.yml).
if (!process.env.PAYLOAD_SECRET) {
  process.env.PAYLOAD_SECRET = 'kody-typecheck-dummy-secret-not-used-at-runtime'
}

function restore() {
  try {
    copyFileSync(BACKUP, TARGET)
  } catch {
    // backup may not exist if copy failed early — nothing to restore
  }
}

try {
  copyFileSync(TARGET, BACKUP)
} catch (err) {
  console.error(`❌ Could not snapshot ${TARGET}:`, err)
  process.exit(1)
}

try {
  execSync('pnpm generate:types', { stdio: 'inherit' })
} catch (err) {
  restore()
  console.error('❌ payload generate:types failed:', err)
  process.exit(1)
}

const before = readFileSync(BACKUP, 'utf8')
const after = readFileSync(TARGET, 'utf8')

if (before !== after) {
  restore()
  console.error(
    `\n❌ ${TARGET} is stale.\n` +
      `   Schema changes were committed without regenerating types.\n` +
      `   Fix: pnpm generate:types && git add ${TARGET}\n`,
  )
  process.exit(1)
}

console.log(`✅ ${TARGET} is up to date`)
