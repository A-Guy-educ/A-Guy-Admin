#!/usr/bin/env tsx
/**
 * Probe: Tranzila /v2/sto/update — find the right body shape to inactivate an STO.
 *
 * Why: cancelStandingOrder in tranzila-v2-client.ts was built from docs
 * ("sto_status: active|inactive") that turned out to not match reality.
 * First live attempt returned error_code 20004 "Json does not match
 * validation schema" (additionalProperties). This script posts a handful
 * of plausible body shapes against a known-live sto_id and prints the raw
 * response for each — the error_code 0 (or at least a different error
 * code that doesn't say "schema mismatch") tells us the right shape.
 *
 * Also tries a couple of alternative endpoint paths in case the right
 * cancel action is on /v2/sto/inactivate or /v2/sto/cancel rather than
 * the generic update endpoint.
 *
 * Usage (requires TRANZILLA_PUBLIC_KEY + TRANZILLA_PRIVATE_KEY in env):
 *   pnpm tsx scripts/probe-tranzila-sto-update.ts --sto 488324
 *
 * Interpretation:
 *   - error_code 0 → the body shape worked; cancel took effect. VERIFY on
 *     the Tranzila dashboard that the STO is actually inactive before
 *     celebrating (some endpoints 200 without doing anything).
 *   - error_code 20004 with mismatch_info naming a specific field → the
 *     body is still wrong, but the message tells you WHICH field. Edit
 *     the next variant and re-run.
 *   - 404 / HTML error → wrong endpoint path.
 *   - error about sto_id not found → body shape is OK, we just need a
 *     fresh live sto_id (the probe sto was already inactivated by an
 *     earlier successful variant, likely).
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { postV2 } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { sto: string; terminal: string } {
  const argv = process.argv.slice(2)
  let sto = ''
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sto' && argv[i + 1]) {
      sto = argv[i + 1]!
      i++
    } else if (argv[i] === '--terminal' && argv[i + 1]) {
      terminal = argv[i + 1]!
      i++
    }
  }
  if (!sto) {
    console.error('Missing --sto <sto_id>')
    process.exit(2)
  }
  return { sto, terminal }
}

interface Variant {
  path: string
  body: Record<string, unknown>
  label: string
}

async function main() {
  const { sto, terminal } = parseArgs()

  const variants: Variant[] = [
    // Current (known-broken) shape:
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), sto_status: 'inactive' },
      label: 'current — sto_status: inactive',
    },
    // Status variants on /v2/sto/update:
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), status: 'inactive' },
      label: 'update — status: inactive',
    },
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), is_active: false },
      label: 'update — is_active: false',
    },
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), active: false },
      label: 'update — active: false',
    },
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), sto_active: false },
      label: 'update — sto_active: false',
    },
    {
      path: '/v2/sto/update',
      body: { terminal_name: terminal, sto_id: Number(sto), cancel: true },
      label: 'update — cancel: true',
    },
    // Alternative endpoints — try the obvious verb-based routes:
    {
      path: '/v2/sto/cancel',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v2/sto/cancel (bare)',
    },
    {
      path: '/v2/sto/inactivate',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v2/sto/inactivate (bare)',
    },
    {
      path: '/v2/sto/delete',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v2/sto/delete (bare)',
    },
    {
      path: '/v2/sto/stop',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v2/sto/stop (bare)',
    },
  ]

  console.log(`\nProbing /v2/sto cancel shapes against sto_id=${sto} on terminal=${terminal}\n`)

  for (const v of variants) {
    console.log('─'.repeat(72))
    console.log(`▶ ${v.label}`)
    console.log(`  POST ${v.path}`)
    console.log(`  body: ${JSON.stringify(v.body)}`)
    try {
      const result = await postV2({ path: v.path, body: v.body })
      console.log(`  httpStatus: ${result.httpStatus}`)
      console.log(`  errorCode:  ${result.errorCode}`)
      console.log(`  message:    ${result.message}`)
      console.log(`  rawText:    ${result.rawText.slice(0, 800)}`)
      if (result.errorCode === 0) {
        console.log(`  ✅ error_code 0 — this shape was accepted. Verify on dashboard.`)
      }
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Small gap between calls so we don't trigger any Tranzila-side rate limit.
    await new Promise((r) => setTimeout(r, 500))
  }

  console.log('─'.repeat(72))
  console.log('\nDone. The variant that returned error_code 0 (if any) is the right shape.')
  console.log('If the first-successful variant actually inactivated the STO, every subsequent')
  console.log('variant will likely return "sto not found" or similar — that\'s expected.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
