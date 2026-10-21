/**
 * Tranzila Invoices API client — HMAC-SHA256-authenticated REST wrapper for
 * `billing5.tranzila.com/api/documents_db/*` endpoints.
 *
 * Lives in a separate file from `tranzila-v2-client.ts` because:
 *   - Different base host (billing5.tranzila.com vs api.tranzila.com)
 *   - Different concern (document issuance vs charge/sto flow)
 * Same auth headers (reuses `buildV2AuthHeaders`), same HMAC scheme.
 *
 * Primary use: our Tranzila webhook calls `createTranzilaInvoiceDocument`
 * after every approved charge (bootstrap + STO renewal) so the buyer gets
 * a formal tax invoice/receipt (IR = חשבונית מס/קבלה) emailed to them.
 *
 * Tranzila dashboard prerequisites (per 2026-10-21 support thread):
 *   1. "שליחת דואר אלקטרוני אוטומטי" toggle ON on the terminal (makes
 *      Tranzila send the PDF after we create the document via API).
 *   2. "שליחת עותק מסמך לסוחר" toggle ON (merchant audit copy).
 *   3. Sender email suffix configured to `@tranzila.com` so Gmail doesn't
 *      filter the delivery as spam.
 *
 * The "auto-email" naming is misleading — Tranzila does NOT auto-generate
 * invoices on charge. We must call this helper from our webhook. The
 * "auto" refers to the email send after the document is created via API.
 *
 * @fileType utility
 * @domain payments
 */

import { buildV2AuthHeaders } from './tranzila-v2-client'
import { getPaymentEnv } from './env'

const TRANZILA_INVOICES_BASE_URL = 'https://billing5.tranzila.com'

export interface CreateInvoiceDocumentArgs {
  /** Terminal that holds the invoicing config (usually the main fxpaguy terminal). */
  terminalName: string
  /**
   * Document type:
   *   - 'IR' — חשבונית מס/קבלה (tax invoice + receipt combo, standard for completed sales)
   *   - 'RE' — קבלה (receipt only)
   *   - 'IN' — חשבונית מס (tax invoice only)
   *   - 'DI' — חשבונית עסקה (deal invoice / pro forma)
   */
  documentType: 'IR' | 'RE' | 'IN' | 'DI'
  /** Buyer's email — Tranzila delivers the PDF here when auto-email is enabled. */
  clientEmail: string
  /** Buyer's name shown on the invoice. */
  clientName: string
  /**
   * Tranzila transaction `index` from the webhook body — correlates the
   * invoice to the underlying charge for reconciliation in Tranzila's
   * Reports API.
   */
  txnIndex: number
  /** Line items on the invoice. Each item has a name and unit price in ILS. */
  items: Array<{ name: string; unitPriceIls: number }>
  /** Payments backing the invoice. For credit-card charges, one entry with the paid amount. */
  payments: Array<{ amountIls: number }>
  /** ISO yyyy-mm-dd. Defaults to today in UTC when omitted. */
  documentDate?: string
}

export interface CreateInvoiceDocumentResponse {
  httpStatus: number
  /** 0 = success. Any other value is an error; see status_msg. */
  statusCode: number
  statusMsg: string | null
  /** Present on success. Document numbering is per-terminal. */
  document: {
    id: string
    number: string
    totalChargeAmount: number
    currency: string
    retrievalKey: string
    createdAt: string
  } | null
  rawText: string
}

/**
 * Create a formal invoice/receipt document on Tranzila. On success, Tranzila
 * emails the PDF to `clientEmail` (requires the terminal's auto-email toggle
 * to be ON — see file header).
 *
 * Never throws. Returns a structured response with `statusCode === 0` on
 * success. Callers should log + continue on any non-zero status so the
 * charge/promotion flow doesn't fail just because the invoice couldn't be
 * created.
 */
export async function createTranzilaInvoiceDocument(
  args: CreateInvoiceDocumentArgs,
): Promise<CreateInvoiceDocumentResponse> {
  const { tranzillaPublicKey, tranzillaPrivateKey } = getPaymentEnv()
  const headers = buildV2AuthHeaders({
    publicKey: tranzillaPublicKey,
    privateKey: tranzillaPrivateKey,
  })

  const documentDate = args.documentDate ?? new Date().toISOString().slice(0, 10)
  const body = {
    terminal_name: args.terminalName,
    document_date: documentDate,
    document_type: args.documentType,
    document_language: 'heb',
    document_currency_code: 'ILS',
    action: 1, // 1 = debit (regular charge), 3 = credit (refund)
    client_name: args.clientName,
    client_email: args.clientEmail,
    txnindex: args.txnIndex,
    items: args.items.map((i) => ({
      name: i.name,
      unit_price: i.unitPriceIls,
      units_number: 1,
    })),
    payments: args.payments.map((p) => ({
      payment_method: 1, // 1 = credit card
      amount: p.amountIls,
      payment_date: documentDate,
    })),
  }

  let response: Response
  try {
    response = await fetch(`${TRANZILA_INVOICES_BASE_URL}/api/documents_db/create_document`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      httpStatus: 0,
      statusCode: -1,
      statusMsg: `network: ${err instanceof Error ? err.message : String(err)}`,
      document: null,
      rawText: '',
    }
  }

  const rawText = await response.text()
  type ParsedResponse = {
    status_code?: number
    status_msg?: string
    document?: {
      id: string
      number: string
      total_charge_amount: number
      currency: string
      retrieval_key: string
      created_at: string
    }
  }
  let parsed: ParsedResponse | null = null
  try {
    parsed = JSON.parse(rawText) as ParsedResponse
  } catch {
    // Non-JSON response (HTML 404, etc.) — fall through with document=null.
  }

  const statusCode = parsed?.status_code ?? -1
  const document = parsed?.document
    ? {
        id: parsed.document.id,
        number: parsed.document.number,
        totalChargeAmount: parsed.document.total_charge_amount,
        currency: parsed.document.currency,
        retrievalKey: parsed.document.retrieval_key,
        createdAt: parsed.document.created_at,
      }
    : null

  return {
    httpStatus: response.status,
    statusCode,
    statusMsg: parsed?.status_msg ?? null,
    document,
    rawText,
  }
}
