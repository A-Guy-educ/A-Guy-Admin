#!/usr/bin/env tsx
/**
 * Probe: find a Tranzila /v2 endpoint that exposes an STO's items (child ids).
 *
 * Why: createstov2 returns the master sto_id, but the item id — which is
 * what actually controls billing — is NOT in the response and not stored
 * anywhere on our side. Cancelling the master doesn't stop the item from
 * billing. We need either (a) the item id in the create response, (b) a
 * way to query items by master id, or (c) a way to list all STOs for a
 * customer/card.
 *
 * This probe fires a handful of plausible endpoint paths against the live
 * API with master sto_id 488336 (and its item 488335) and dumps raw bodies.
 * The one that returns an "items" array OR links master → item is the one
 * we build on.
 *
 * Usage: pnpm tsx scripts/probe-tranzila-sto-get.ts --master 488336 --item 488335
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { postV2 } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { master: number; item: number; terminal: string } {
  const argv = process.argv.slice(2)
  let master = 0
  let item = 0
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--master' && argv[i + 1]) {
      master = Number(argv[i + 1])
      i++
    } else if (argv[i] === '--item' && argv[i + 1]) {
      item = Number(argv[i + 1])
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
  return { master, item, terminal }
}

interface Variant {
  path: string
  body: Record<string, unknown>
  label: string
}

async function main() {
  const { master, item, terminal } = parseArgs()

  const variants: Variant[] = [
    {
      path: '/v2/sto/get',
      body: { terminal_name: terminal, sto_id: master },
      label: 'GET master via /v2/sto/get',
    },
    {
      path: '/v2/sto/get',
      body: { terminal_name: terminal, sto_id: item },
      label: 'GET item via /v2/sto/get',
    },
    {
      path: '/v2/sto',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto bare',
    },
    {
      path: '/v2/sto/read',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/read',
    },
    {
      path: '/v2/sto/details',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/details',
    },
    {
      path: '/v2/sto/items',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/items',
    },
    {
      path: '/v2/sto/children',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/children',
    },
    { path: '/v2/sto/list', body: { terminal_name: terminal }, label: 'POST /v2/sto/list (bare)' },
    {
      path: '/v2/sto/list',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/list by sto_id',
    },
    {
      path: '/v2/sto/search',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/search',
    },
    {
      path: '/v2/sto/query',
      body: { terminal_name: terminal, sto_id: master },
      label: 'POST /v2/sto/query',
    },
  ]

  console.log(
    `\nProbing /v2/sto read shapes against master=${master} item=${item} terminal=${terminal}\n`,
  )

  for (const v of variants) {
    console.log('─'.repeat(72))
    console.log(`▶ ${v.label}`)
    console.log(`  POST ${v.path}  body: ${JSON.stringify(v.body)}`)
    try {
      const result = await postV2({ path: v.path, body: v.body })
      console.log(
        `  httpStatus: ${result.httpStatus}  errorCode: ${result.errorCode}  message: ${result.message}`,
      )
      // Only show rawText if it's not an HTML 404 page.
      if (result.contentType && result.contentType.includes('json')) {
        console.log(`  rawText: ${result.rawText.slice(0, 1200)}`)
      } else if (result.httpStatus !== 404) {
        console.log(`  rawText: ${result.rawText.slice(0, 400)}`)
      }
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log('─'.repeat(72))
  console.log(
    '\nDone. Any variant with errorCode=0 and a body naming the item id (488335) is the answer.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
