#!/usr/bin/env tsx
/**
 * Smoke test: Tranzila /v2/sto/create — iterate on the payload shape locally.
 *
 * Why this exists: the PR → merge → redeploy → charge-my-card → read-logs
 * cycle takes ~15 minutes per round AND racks up orphan STOs on Tranzila
 * whenever their validator partially-accepts our payload. This script posts
 * the exact same payload `handoffToStandingOrder` would build in production,
 * directly against Tranzila's live API, from a laptop with no deploy.
 *
 * Key insight: Tranzila validates the JSON schema BEFORE validating the
 * token. A dummy token works for payload iteration — we keep seeing schema
 * errors until the body is correct, then we see a token-validity error
 * which proves the schema is accepted. At that point, the next real-card
 * smoke should succeed.
 *
 * Usage (requires TRANZILLA_PUBLIC_KEY + TRANZILLA_PRIVATE_KEY in env):
 *   pnpm tsx scripts/smoke-tranzila-create-sto.ts
 *   pnpm tsx scripts/smoke-tranzila-create-sto.ts --token REAL-TK-FROM-DASHBOARD
 *   pnpm tsx scripts/smoke-tranzila-create-sto.ts --price 59 --tier basic
 *
 * Interpretation of results:
 *   - error_code 0 + sto_id present → payload is correct AND token was valid
 *     → STO created on Tranzila; cancel it manually before next iteration
 *     to avoid orphan buildup.
 *   - error_code 20004 → schema validation failed; mismatch_info tells you
 *     the field. Fix in createStandingOrder (src/lib/payment/tranzila-v2-client.ts)
 *     AND here, re-run.
 *   - error_code mentioning "token" / "card" / etc. → schema OK, token
 *     invalid. The payload is good. Push the fix to the real code path and
 *     redeploy for a card smoke.
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { createStandingOrder, formatTranzilaDate } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

interface Args {
  terminal: string
  token: string
  price: number
  tier: string
  email: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const result: Args = {
    terminal: process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok',
    token: 'TEST-TK-' + Math.random().toString(36).slice(2, 10),
    price: 1,
    tier: 'basic',
    email: 'kotz96@gmail.com',
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const val = argv[i + 1]
    if (!val) continue
    if (flag === '--terminal') {
      result.terminal = val
      i++
    } else if (flag === '--token') {
      result.token = val
      i++
    } else if (flag === '--price') {
      result.price = Number(val)
      i++
    } else if (flag === '--tier') {
      result.tier = val
      i++
    } else if (flag === '--email') {
      result.email = val
      i++
    }
  }
  return result
}

async function main() {
  if (!process.env.TRANZILLA_PUBLIC_KEY || !process.env.TRANZILLA_PRIVATE_KEY) {
    console.error('Missing TRANZILLA_PUBLIC_KEY / TRANZILLA_PRIVATE_KEY — load from .env.local')
    process.exit(2)
  }

  const args = parseArgs()
  const nowPlus1Mo = new Date()
  nowPlus1Mo.setUTCMonth(nowPlus1Mo.getUTCMonth() + 1)

  console.log(`[smoke-tranzila-create-sto]`)
  console.log(`  terminal:         ${args.terminal}`)
  console.log(`  token:            ${args.token}`)
  console.log(`  price:            ${args.price} ILS`)
  console.log(`  tier:             ${args.tier}`)
  console.log(`  email:            ${args.email}`)
  console.log(`  first_charge_date:${formatTranzilaDate(nowPlus1Mo)}`)
  console.log()

  const result = await createStandingOrder({
    terminalName: args.terminal,
    cardToken: args.token,
    cardExpireMonth: 12,
    cardExpireYear: 2030,
    stoPaymentsNumber: 119,
    chargeFrequency: 'monthly',
    firstChargeDate: formatTranzilaDate(nowPlus1Mo),
    chargeDayOfMonth: nowPlus1Mo.getUTCDate(),
    client: { name: 'Smoke Test', email: args.email },
    items: [{ itemName: `AGuy Subscription — ${args.tier}`, unitPriceIls: args.price }],
  })

  console.log(`  httpStatus:   ${result.raw.httpStatus}`)
  console.log(`  errorCode:    ${result.errorCode}`)
  console.log(`  message:      ${result.message}`)
  console.log(`  stoId:        ${result.stoId}`)
  console.log(`  rawText head: ${result.raw.rawText.slice(0, 600)}`)
  if (result.raw.rawText.length > 600) {
    console.log(`                [... ${result.raw.rawText.length - 600} more chars ...]`)
  }

  if (result.stoId) {
    console.log('\n✅ STO CREATED — payload is correct AND token was valid.')
    console.log(`   Cancel sto_id=${result.stoId} in Tranzila dashboard to avoid orphan buildup.`)
    return
  }

  if (result.errorCode === 20004) {
    console.log('\n⚠️  SCHEMA REJECTED (error 20004) — read mismatch_info above, fix the payload.')
    return
  }

  const msgLower = (result.message ?? '').toLowerCase()
  if (
    msgLower.includes('token') ||
    msgLower.includes('card') ||
    msgLower.includes('invalid') ||
    result.errorCode === 20010 ||
    result.errorCode === 20111
  ) {
    console.log('\n✅ SCHEMA ACCEPTED — token/card validation failed as expected with dummy.')
    console.log('   The payload shape is good. Push the fix + redeploy for a real-card smoke.')
    return
  }

  console.log('\n⚠️  Unexpected response — inspect rawText above before trusting the result.')
}

main().catch((err) => {
  console.error('[smoke-tranzila-create-sto] unexpected error:', err)
  process.exit(1)
})
