#!/usr/bin/env tsx
/**
 * Smoke test: Tranzila V2 HMAC auth against the live transactions-query API.
 *
 * Purpose: validate that our HMAC computation matches what Tranzila's TRAPI
 * expects. The transactions-query endpoint is read-only and free, so hitting
 * it with a non-existent transaction_index is a safe way to prove the auth
 * path works independently of any STO/charge integration.
 *
 * Interpretation of results:
 *   - HTTP 200 + error_code 0  → auth OK and the transaction exists (unlikely for a random index)
 *   - HTTP 200 + error_code ~20112 "transaction not found" → auth OK, index just doesn't exist. SUCCESS.
 *   - HTTP 200 + error_code "unauthorized"-shape → auth FAILED. Our HMAC input layout is wrong.
 *   - HTTP 401/403 → auth FAILED at HTTP layer.
 *   - HTTP 5xx → Tranzila-side problem, not our auth.
 *
 * Usage (requires TRANZILLA_PUBLIC_KEY + TRANZILLA_PRIVATE_KEY in env):
 *   pnpm tsx scripts/smoke-tranzila-v2-auth.ts
 *   pnpm tsx scripts/smoke-tranzila-v2-auth.ts --terminal fxpaguytok --index 999999
 */

import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'

import { queryTransactionByIndex } from '@/lib/payment/tranzila-v2-client'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnv({ path: file })
}

function parseArgs(): { terminal: string; index: number } {
  const args = process.argv.slice(2)
  let terminal = process.env.TRANZILLA_TERMINAL_TOKEN || 'fxpaguytok'
  let index = 999_999_999 // deliberately unlikely to exist
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--terminal') terminal = args[++i] ?? terminal
    else if (args[i] === '--index') index = Number(args[++i] ?? index)
  }
  return { terminal, index }
}

async function main() {
  if (!process.env.TRANZILLA_PUBLIC_KEY || !process.env.TRANZILLA_PRIVATE_KEY) {
    console.error('Missing TRANZILLA_PUBLIC_KEY / TRANZILLA_PRIVATE_KEY in env — load from .env')
    process.exit(2)
  }

  const { terminal, index } = parseArgs()
  console.log(`[smoke-tranzila-v2-auth] terminal=${terminal} transaction_index=${index}`)

  const result = await queryTransactionByIndex({
    terminalName: terminal,
    transactionIndex: index,
  })

  console.log(`  httpStatus:   ${result.httpStatus}`)
  console.log(`  contentType:  ${result.contentType}`)
  console.log(`  errorCode:    ${result.errorCode}`)
  console.log(`  message:      ${result.message}`)
  console.log(`  rawText head: ${result.rawText.slice(0, 400)}`)
  if (result.rawText.length > 400) {
    console.log(`                [... ${result.rawText.length - 400} more chars ...]`)
  }

  // Classify the outcome.
  if (result.httpStatus === 401 || result.httpStatus === 403) {
    console.error('\n❌ AUTH FAILED at HTTP layer — HMAC input layout is wrong.')
    process.exit(1)
  }

  const msgLower = (result.message ?? '').toLowerCase()
  const rawLower = result.rawText.toLowerCase()
  const bothText = `${msgLower} ${rawLower}`
  const looksLikeAuthFailure =
    bothText.includes('unauthoriz') ||
    bothText.includes('invalid signature') ||
    bothText.includes('invalid token') ||
    bothText.includes('authentic') ||
    bothText.includes('access denied') ||
    bothText.includes('invalid hmac')

  if (looksLikeAuthFailure) {
    console.error('\n❌ AUTH FAILED — Tranzila rejected the signature.')
    console.error('    HMAC input layout likely needs to flip (see tranzila-v2-client.ts).')
    process.exit(1)
  }

  // Classify by content: Tranzila's transactions-query endpoint returns a
  // bespoke shape ({transactions: [...], user_defined: [...]}) instead of
  // the generic {error_code, message} envelope. Treat any valid JSON that
  // isn't an auth error as success.
  const isJsonContentType = (result.contentType ?? '').toLowerCase().includes('application/json')
  if (result.errorCode === 0) {
    console.log('\n✅ AUTH OK — Tranzila accepted the request and returned the transaction.')
  } else if (result.errorCode !== null) {
    console.log(
      `\n✅ AUTH OK — business error (expected): error_code=${result.errorCode}, "${result.message}"`,
    )
  } else if (
    isJsonContentType &&
    result.httpStatus === 200 &&
    (result.rawText.includes('"transactions"') || result.rawText.includes('"user_defined"'))
  ) {
    console.log('\n✅ AUTH OK — endpoint returned its bespoke shape (transactions-query payload).')
    console.log(
      '   The query returned no results, which is the expected outcome for a smoke index.',
    )
  } else if (result.httpStatus === 200 && result.rawText.length === 0) {
    console.log('\n⚠️  Empty 200 response — ambiguous. Could be auth OK but endpoint path wrong.')
  } else {
    console.log(
      '\n⚠️  Unexpected response shape — inspect rawText head above before trusting the integration.',
    )
  }
}

main().catch((err) => {
  console.error('[smoke-tranzila-v2-auth] unexpected error:', err)
  process.exit(1)
})
