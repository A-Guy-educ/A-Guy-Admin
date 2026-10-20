#!/usr/bin/env tsx
/**
 * Probe: can /v2/sto/update swap an existing STO's items (price change)?
 *
 * Why: tier upgrade/downgrade need to change the recurring price of an
 * existing STO. Per the no-stored-tokens policy we never retain the
 * TranzilaTK after handoff, so a cancel + recreate flow has no token to
 * pass to createstov2. The clean
 * alternative — mentioned in Tranzila's update docs ("items are deleted
 * and replaced") — is to update the existing STO's items array in place,
 * keeping the same sto_id and card.
 *
 * Prerequisites: a live active STO master id + its item sto_id.
 *
 * Usage: pnpm tsx scripts/probe-tranzila-sto-items-swap.ts --master 488344 --new-price 119
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { postV2 } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { master: number; newPrice: number; terminal: string } {
  const argv = process.argv.slice(2)
  let master = 0
  let newPrice = 0
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--master' && argv[i + 1]) {
      master = Number(argv[i + 1])
      i++
    } else if (argv[i] === '--new-price' && argv[i + 1]) {
      newPrice = Number(argv[i + 1])
      i++
    } else if (argv[i] === '--terminal' && argv[i + 1]) {
      terminal = argv[i + 1]!
      i++
    }
  }
  if (!master || !newPrice) {
    console.error('Missing --master <sto_id> or --new-price <ILS>')
    process.exit(2)
  }
  return { master, newPrice, terminal }
}

async function main() {
  const { master, newPrice, terminal } = parseArgs()

  const base = { terminal_name: terminal, sto_id: master }
  const name = `Tier swap probe — ₪${newPrice}`

  const variants = [
    {
      body: {
        ...base,
        items: [{ name, unit_price: newPrice, quantity: 1, currency_code: 'ILS', vat_percent: 0 }],
      },
      label: 'create-shape items (known-rejected baseline)',
    },
    {
      body: { ...base, items: [{ name, unit_price: newPrice, quantity: 1 }] },
      label: 'drop currency_code + vat_percent',
    },
    { body: { ...base, items: [{ name, unit_price: newPrice }] }, label: 'just name + unit_price' },
    { body: { ...base, items: [{ unit_price: newPrice }] }, label: 'just unit_price' },
    {
      body: { ...base, items: [{ name, unit_price: newPrice, quantity: 1, type: 'I' }] },
      label: 'add type: I',
    },
    {
      body: {
        ...base,
        items: [
          { name, unit_price: newPrice, quantity: 1, type: 'I', unit_type: 1, index_link: 'N' },
        ],
      },
      label: 'full Tranzila defaults inline',
    },
    {
      body: {
        ...base,
        items: [
          {
            name,
            unit_price: newPrice,
            quantity: 1,
            type: 'I',
            unit_type: 1,
            index_link: 'N',
            internal_id: null,
            code: null,
          },
        ],
      },
      label: 'defaults + null internal_id/code',
    },
  ]

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
        console.log(`  ✅ ACCEPTED — verify on dashboard that the item line now shows ₪${newPrice}`)
      }
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log('─'.repeat(72))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
