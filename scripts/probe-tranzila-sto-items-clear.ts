#!/usr/bin/env tsx
/**
 * Probe: can /v2/sto/update with items: [] wipe an STO's items in one call?
 *
 * Why: createstov2 creates a master + N item records with consecutive ids.
 * API returns master id only. Cancelling the master leaves items billing.
 * Tranzila's update docs say "When you send items in an update request,
 * all existing items are deleted and replaced." If true, sending items: []
 * clears the item side of the pair in one call, no need to find item ids.
 *
 * Tries three shapes:
 *   1. items: [] alone (no status change)
 *   2. items: [] + sto_status: 'inactive'
 *   3. items: [] + sto_status: 'active'
 *
 * Usage: pnpm tsx scripts/probe-tranzila-sto-items-clear.ts --master 488336
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { postV2 } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { master: number; terminal: string } {
  const argv = process.argv.slice(2)
  let master = 0
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--master' && argv[i + 1]) {
      master = Number(argv[i + 1])
      i++
    } else if (argv[i] === '--terminal' && argv[i + 1]) {
      terminal = argv[i + 1]!
      i++
    }
  }
  if (!master) {
    console.error('Missing --master <sto_id>')
    process.exit(2)
  }
  return { master, terminal }
}

async function main() {
  const { master, terminal } = parseArgs()

  const variants = [
    {
      body: { terminal_name: terminal, sto_id: master, items: [] },
      label: 'items: [] (no status)',
    },
    {
      body: { terminal_name: terminal, sto_id: master, items: [], sto_status: 'inactive' },
      label: 'items: [] + sto_status: inactive',
    },
    {
      body: { terminal_name: terminal, sto_id: master, items: [], sto_status: 'active' },
      label: 'items: [] + sto_status: active',
    },
  ]

  console.log(`\nProbing /v2/sto/update items:[] against master=${master} terminal=${terminal}\n`)

  for (const v of variants) {
    console.log('─'.repeat(72))
    console.log(`▶ ${v.label}`)
    console.log(`  body: ${JSON.stringify(v.body)}`)
    try {
      const result = await postV2({ path: '/v2/sto/update', body: v.body })
      console.log(
        `  httpStatus: ${result.httpStatus}  errorCode: ${result.errorCode}  message: ${result.message}`,
      )
      console.log(`  rawText: ${result.rawText.slice(0, 1500)}`)
      if (result.errorCode === 0) {
        console.log(`  ✅ accepted — verify on dashboard whether the item disappeared`)
      }
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log('─'.repeat(72))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
