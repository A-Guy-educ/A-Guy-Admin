#!/usr/bin/env tsx
/**
 * Probe: find the HMAC input layout Tranzila expects for the outgoing
 * iframe URL signature (Hand Shake).
 *
 * Why: PR #641 shipped a guessed layout (sum|currency|cred_type|tranmode).
 * Live test with Hand Shake toggled on at the terminal returned error
 * 275497 "Illegal Operation" — the guess was wrong. This script GETs the
 * iframe URL with a handful of plausible HMAC input layouts and reports
 * which (if any) stop triggering the error page.
 *
 * Prerequisites:
 *   - Hand Shake MUST be enabled on the terminal (fxpaguy) at Tranzila's
 *     dashboard — otherwise Tranzila ignores the hash and every variant
 *     reports "success" (meaningless).
 *   - TRANZILLA_PRIVATE_KEY in env.
 *
 * Each variant is just an HTTP GET. No STO created, no card charged.
 *
 * Interpretation:
 *   - Response contains "275497" or "Illegal Operation" → variant REJECTED.
 *   - Response contains card-form markers (ccno, expdate inputs) → variant
 *     ACCEPTED. The HMAC layout matches Tranzila's expected format.
 *   - Response is a redirect / neither of the above → inspect manually.
 *
 * Usage: pnpm tsx scripts/probe-tranzila-handshake.ts
 */

import { createHmac } from 'node:crypto'

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

const PRIVATE_KEY = process.env.TRANZILLA_PRIVATE_KEY
const TERMINAL = process.env.TRANZILLA_TERMINAL || 'fxpaguy'

if (!PRIVATE_KEY) {
  console.error('TRANZILLA_PRIVATE_KEY not set')
  process.exit(2)
}

// A representative set of URL params — the shape createTranzillaCheckout
// actually builds in production. Nothing dynamic that would change the
// hash between runs.
const BASE_PARAMS: Record<string, string> = {
  sum: '59.00',
  currency: '1', // 1=ILS
  cred_type: '1', // single payment
  tranmode: 'A', // A=Charge
  pdesc: 'AGuy basic - probe',
  success_url_address: 'https://admin.dev.aguy.co.il/success',
  fail_url_address: 'https://admin.dev.aguy.co.il/cancel',
  notify_url_address: 'https://admin.dev.aguy.co.il/api/webhooks/tranzilla',
  lang: 'il',
}

function hmac(input: string): string {
  return createHmac('sha256', PRIVATE_KEY!).update(input).digest('hex')
}

function sha1(input: string): string {
  // Some older Tranzila integrations use SHA1 — included as a fallback variant.
  return createHmac('sha1', PRIVATE_KEY!).update(input).digest('hex')
}

interface Variant {
  label: string
  hashParam: string
  input: string
  hash: string
}

function makeVariants(): Variant[] {
  const sortedParamKeys = Object.keys(BASE_PARAMS).sort()
  const alphaJoined = sortedParamKeys.map((k) => BASE_PARAMS[k]!).join('|')
  const urlOrderJoined = Object.values(BASE_PARAMS).join('|')
  const allValuesConcat = Object.values(BASE_PARAMS).join('')
  const money = `${BASE_PARAMS.sum}|${BASE_PARAMS.currency}`
  const moneyMode = `${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}|${BASE_PARAMS.tranmode}`
  const moneyModeTerm = `${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}|${BASE_PARAMS.tranmode}|${TERMINAL}`
  const termMoney = `${TERMINAL}|${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}|${BASE_PARAMS.tranmode}`
  const moneyNoDelim = `${BASE_PARAMS.sum}${BASE_PARAMS.currency}${BASE_PARAMS.cred_type}${BASE_PARAMS.tranmode}`

  const variants: { label: string; input: string; hash: string; hashParam?: string }[] = [
    // Current implementation
    {
      label: 'current — sum|currency|cred_type|tranmode (HMAC-SHA256)',
      input: moneyMode,
      hash: hmac(moneyMode),
    },

    // Reorderings
    {
      label: 'tranmode|sum|currency|cred_type',
      input: `${BASE_PARAMS.tranmode}|${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}`,
      hash: hmac(
        `${BASE_PARAMS.tranmode}|${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}`,
      ),
    },
    {
      label: 'currency|sum|cred_type|tranmode',
      input: `${BASE_PARAMS.currency}|${BASE_PARAMS.sum}|${BASE_PARAMS.cred_type}|${BASE_PARAMS.tranmode}`,
      hash: hmac(
        `${BASE_PARAMS.currency}|${BASE_PARAMS.sum}|${BASE_PARAMS.cred_type}|${BASE_PARAMS.tranmode}`,
      ),
    },

    // Fewer fields
    { label: 'sum|currency (money only)', input: money, hash: hmac(money) },
    {
      label: 'sum|currency|cred_type (drop tranmode)',
      input: `${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}`,
      hash: hmac(`${BASE_PARAMS.sum}|${BASE_PARAMS.currency}|${BASE_PARAMS.cred_type}`),
    },
    { label: 'sum alone', input: BASE_PARAMS.sum!, hash: hmac(BASE_PARAMS.sum!) },

    // Including terminal
    {
      label: '<terminal>|sum|currency|cred_type|tranmode',
      input: termMoney,
      hash: hmac(termMoney),
    },
    {
      label: 'sum|currency|cred_type|tranmode|<terminal>',
      input: moneyModeTerm,
      hash: hmac(moneyModeTerm),
    },

    // All URL params
    {
      label: 'all URL params in URL order, joined with |',
      input: urlOrderJoined,
      hash: hmac(urlOrderJoined),
    },
    {
      label: 'all URL params alpha-sorted by key, joined with |',
      input: alphaJoined,
      hash: hmac(alphaJoined),
    },

    // Different delimiter / concatenation
    {
      label: 'sum+currency+cred_type+tranmode (no delimiter)',
      input: moneyNoDelim,
      hash: hmac(moneyNoDelim),
    },

    // Different hash function
    {
      label: 'HMAC-SHA1 over sum|currency|cred_type|tranmode',
      input: moneyMode,
      hash: sha1(moneyMode),
    },

    // Different param name for the hash
    {
      label: 'sum|currency|cred_type|tranmode, param name = sign (not response_hash)',
      input: moneyMode,
      hash: hmac(moneyMode),
      hashParam: 'sign',
    },
    {
      label: 'sum|currency|cred_type|tranmode, param name = hash',
      input: moneyMode,
      hash: hmac(moneyMode),
      hashParam: 'hash',
    },
    {
      label: 'sum|currency|cred_type|tranmode, param name = request_hash',
      input: moneyMode,
      hash: hmac(moneyMode),
      hashParam: 'request_hash',
    },
    {
      label: 'sum|currency|cred_type|tranmode, param name = hashcode',
      input: moneyMode,
      hash: hmac(moneyMode),
      hashParam: 'hashcode',
    },
    {
      label: 'sum|currency|cred_type|tranmode, param name = checksum',
      input: moneyMode,
      hash: hmac(moneyMode),
      hashParam: 'checksum',
    },
  ]

  return variants.map((v) => ({ ...v, hashParam: v.hashParam ?? 'response_hash' }))
}

async function hitTranzilaIframe(params: Record<string, string>): Promise<{
  status: number
  body: string
  hasIllegalOperation: boolean
  hasCardForm: boolean
  summary: string
}> {
  const query = new URLSearchParams(params).toString()
  const url = `https://direct.tranzila.com/${TERMINAL}/iframenew.php?${query}`
  const response = await fetch(url, { redirect: 'manual' })
  const body = await response.text()

  const hasIllegalOperation = /275497|Illegal Operation|עסקה נכשלה/.test(body)
  const hasCardForm = /ccno|expdate|cvv|credit_card_number|cardHolder|name="ccno"/i.test(body)

  let summary = ''
  if (hasIllegalOperation) summary = '❌ REJECTED (275497 Illegal Operation)'
  else if (hasCardForm) summary = '✅ ACCEPTED (payment form rendered)'
  else summary = `⚠️  UNKNOWN (status ${response.status}, body length ${body.length})`

  return { status: response.status, body, hasIllegalOperation, hasCardForm, summary }
}

async function main() {
  console.log(`\nProbing Hand Shake HMAC layouts against terminal=${TERMINAL}`)
  console.log(
    `Private key: ${PRIVATE_KEY!.slice(0, 4)}...${PRIVATE_KEY!.slice(-4)} (length ${PRIVATE_KEY!.length})`,
  )
  console.log(
    `Hand Shake must be ON at Tranzila's terminal dashboard for this probe to be meaningful.\n`,
  )

  // Baseline — send a KNOWN-WRONG hash. Tranzila's Hand Shake behaviour
  // appears to be "if response_hash is present, verify; if absent, allow
  // through unsigned." So testing with no hash tells us nothing. A wrong
  // hash should trigger 275497 if Hand Shake is actually on.
  console.log('─'.repeat(72))
  console.log('▶ BASELINE 1 — no response_hash at all (should be accepted in lenient mode)')
  const noHash = await hitTranzilaIframe(BASE_PARAMS)
  console.log(`  ${noHash.summary}  (http ${noHash.status})`)
  await new Promise((r) => setTimeout(r, 400))

  console.log('─'.repeat(72))
  console.log(
    '▶ BASELINE 2 — response_hash set to a known-bogus value (should be rejected if Hand Shake is on)',
  )
  const bogusHash = await hitTranzilaIframe({
    ...BASE_PARAMS,
    response_hash: 'bogus0000000000000000000000000000000000000000000000000000000000',
  })
  console.log(`  ${bogusHash.summary}  (http ${bogusHash.status})`)
  if (bogusHash.hasCardForm) {
    console.log(`  ⚠️  Bogus hash was accepted — Hand Shake isn't validating response_hash.`)
    console.log(`     Maybe the param name isn't 'response_hash'. The variant loop below`)
    console.log(`     tries other names (sign/hash/hashcode/request_hash).\n`)
  } else if (bogusHash.hasIllegalOperation) {
    console.log(`  ✅ Confirmed: Hand Shake is active and rejecting bad hashes.`)
    console.log(`     Any variant below that gets ACCEPTED is the right layout.\n`)
  }
  await new Promise((r) => setTimeout(r, 400))

  const variants = makeVariants()
  const accepted: typeof variants = []
  for (const v of variants) {
    console.log('─'.repeat(72))
    console.log(`▶ ${v.label}`)
    console.log(`  input: ${v.input.slice(0, 120)}${v.input.length > 120 ? '…' : ''}`)
    console.log(`  hashParam=${v.hashParam}  hash=${v.hash.slice(0, 16)}…`)
    try {
      const result = await hitTranzilaIframe({ ...BASE_PARAMS, [v.hashParam]: v.hash })
      console.log(`  ${result.summary}  (http ${result.status})`)
      if (result.hasCardForm) accepted.push(v)
    } catch (err) {
      console.log(`  threw: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  console.log('─'.repeat(72))
  if (accepted.length > 0) {
    console.log(`\n✅ ${accepted.length} variant(s) ACCEPTED:`)
    for (const v of accepted) console.log(`   • ${v.label}`)
  } else {
    console.log(`\n❌ No variant was accepted. Options:`)
    console.log(`   - More field combinations needed`)
    console.log(`   - Hash input might be the full URL (minus hash itself)`)
    console.log(`   - Hash algorithm might be different (MD5?)`)
    console.log(`   - Fields need URL-encoding before signing`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
