#!/usr/bin/env tsx
/**
 * Probe: look for a V1 Tranzila endpoint that reads/lists STOs.
 *
 * Why: V2 only has /v2/sto/create and /v2/sto/update. We need a way to
 * discover the item id(s) linked to a master so we can cancel them too.
 * Older-Claude's reading of Tranzila's docs says V1 "supports retrieve a
 * list of STOs" — not surfaced on the public endpoints page but strongly
 * implied. This script probes a handful of plausible paths.
 *
 * Reading: a 404 means the endpoint doesn't exist. A 400 (bad params)
 * means the endpoint exists but the body shape is wrong — then we iterate
 * on the body. An errorCode other than null in a JSON response ALSO means
 * the endpoint exists.
 *
 * Usage: pnpm tsx scripts/probe-tranzila-sto-v1-read.ts --sto 488336
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { postV2 } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { sto: number; terminal: string } {
  const argv = process.argv.slice(2)
  let sto = 0
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sto' && argv[i + 1]) {
      sto = Number(argv[i + 1])
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
    {
      path: '/v1/sto/get',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/get',
    },
    { path: '/v1/sto/list', body: { terminal_name: terminal }, label: 'POST /v1/sto/list (bare)' },
    {
      path: '/v1/sto/list',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/list by sto_id',
    },
    {
      path: '/v1/sto/query',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/query',
    },
    {
      path: '/v1/sto/info',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/info',
    },
    {
      path: '/v1/sto/read',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/read',
    },
    {
      path: '/v1/sto/details',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/details',
    },
    {
      path: '/v1/sto/items',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/items',
    },
    {
      path: '/v1/sto/search',
      body: { terminal_name: terminal, sto_id: sto },
      label: 'POST /v1/sto/search',
    },
    { path: '/v1/sto', body: { terminal_name: terminal, sto_id: sto }, label: 'POST /v1/sto bare' },
    {
      path: '/v1/standing_order/list',
      body: { terminal_name: terminal },
      label: 'POST /v1/standing_order/list',
    },
    {
      path: '/v1/standing_orders',
      body: { terminal_name: terminal },
      label: 'POST /v1/standing_orders',
    },
    // Variations on sto_id key — Tranzila uses sto_index, sto_number elsewhere
    {
      path: '/v1/sto/list',
      body: { terminal_name: terminal, sto_index: sto },
      label: 'POST /v1/sto/list with sto_index',
    },
  ]

  console.log(`\nProbing V1 STO read endpoints against sto=${sto} terminal=${terminal}\n`)

  for (const v of variants) {
    console.log('─'.repeat(72))
    console.log(`▶ ${v.label}`)
    console.log(`  POST ${v.path}  body: ${JSON.stringify(v.body)}`)
    try {
      const result = await postV2({ path: v.path, body: v.body })
      console.log(
        `  httpStatus: ${result.httpStatus}  errorCode: ${result.errorCode}  message: ${result.message}`,
      )
      // If JSON came back the endpoint exists — print it.
      if (result.contentType && result.contentType.includes('json')) {
        console.log(`  🟢 JSON response — endpoint exists`)
        console.log(`  rawText: ${result.rawText.slice(0, 1500)}`)
      } else if (result.httpStatus !== 404) {
        console.log(`  rawText: ${result.rawText.slice(0, 400)}`)
      }
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log('─'.repeat(72))
  console.log('\nDone. Any 🟢 JSON response = endpoint exists; use rawText to discover schema.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
