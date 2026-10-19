/**
 * Cancel Tranzila STO on Admin-Driven Cancel Hook
 *
 * beforeChange hook on Subscriptions. Closes the gap PR #635 left open:
 * the user-facing `PATCH /api/subscriptions/[id]/cancel` endpoint calls
 * Tranzila's `cancelStandingOrder` before flipping local status, but an
 * admin editing a sub in the Payload admin UI (dropdown status → cancelled)
 * goes straight to Payload's collection update and skips that endpoint.
 * Without this hook, admin "cancel" leaves the Tranzila STO active and
 * the user is still billed on the next scheduled charge.
 *
 * Scope — fires only when ALL of:
 *   - operation === 'update'                       (never on create)
 *   - previousDoc.status in {active, past_due}     (meaningful transition only)
 *   - data.status === 'cancelled'                  (the cancel we care about)
 *   - previousDoc.provider === 'tranzilla'
 *   - previousDoc.stoId is a real id, not null, not the 'pending-handoff:*'
 *     webhook sentinel
 *   - req.context.skipStoCancel is NOT true        (user-cancel endpoint
 *     already called Tranzila before this update ran)
 *
 * Failure mode — if Tranzila refuses or the call throws, THIS HOOK THROWS,
 * which aborts the admin save. The admin sees the error in the panel and
 * knows the local status didn't change. This is strictly better than
 * silently updating locally while Tranzila keeps billing.
 *
 * Mid-handoff — a sub whose stoId is still `pending-handoff:<objectId>` is
 * in the webhook's STO-handoff critical section. We don't yet have a real
 * sto_id to cancel. Log + allow the local flip; ops can verify the STO's
 * state manually once the handoff resolves (either to a real id they can
 * cancel, or to null if createstov2 failed and the sub fell back to cron).
 *
 * @fileType hook
 * @domain payments
 * @pattern side-effect-before-write
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { getPaymentEnv } from '@/lib/payment/env'
import { cancelStandingOrder } from '@/lib/payment/tranzila-v2-client'

export const cancelTranzilaStoOnAdminCancel: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return data

  // The user-cancel endpoint sets skipStoCancel on the update's req.context
  // to prevent a double-cancel: it already called cancelStandingOrder (with
  // its own error handling + 502 contract) before issuing payload.update.
  const skip = (req.context as { skipStoCancel?: boolean } | undefined)?.skipStoCancel === true
  if (skip) return data

  const prevStatus = (originalDoc as { status?: string } | undefined)?.status
  const nextStatus = (data as { status?: string }).status
  const wasActiveish = prevStatus === 'active' || prevStatus === 'past_due'
  const isCancelling = nextStatus === 'cancelled'
  if (!wasActiveish || !isCancelling) return data

  const provider = (originalDoc as { provider?: string } | undefined)?.provider
  if (provider !== 'tranzilla') return data

  const stoId = (originalDoc as { stoId?: string | null } | undefined)?.stoId
  if (!stoId) return data // cron-driven sub; no STO on Tranzila's side to cancel
  if (stoId.startsWith('pending-handoff:')) {
    req.payload.logger.warn(
      { subscriptionId: originalDoc!.id, stoId },
      '[subs-hook/admin-cancel] sub is mid-handoff — allowing local flip without Tranzila cancel; verify STO state manually once handoff resolves',
    )
    return data
  }

  const { tranzillaTerminalToken, tranzillaTerminal } = getPaymentEnv()
  const terminal = tranzillaTerminalToken || tranzillaTerminal

  let result
  try {
    result = await cancelStandingOrder({ terminalName: terminal, stoId })
  } catch (err) {
    req.payload.logger.error(
      {
        subscriptionId: originalDoc!.id,
        stoId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[subs-hook/admin-cancel] Tranzila cancelStandingOrder threw — admin save aborted',
    )
    throw new Error(
      `Failed to reach Tranzila to cancel STO ${stoId}. Local status NOT updated. Retry when Tranzila is reachable, or cancel the STO manually on the Tranzila dashboard first.`,
    )
  }

  // Mirror the user-cancel endpoint's predicate: errorCode 0 or null (no
  // JSON parsed) → accepted. Non-zero → real failure.
  if (result.errorCode !== 0 && result.errorCode !== null) {
    req.payload.logger.error(
      {
        subscriptionId: originalDoc!.id,
        stoId,
        errorCode: result.errorCode,
        message: result.message,
      },
      '[subs-hook/admin-cancel] Tranzila cancelStandingOrder returned non-zero error_code — admin save aborted',
    )
    throw new Error(
      `Tranzila refused to cancel STO ${stoId}: error_code ${result.errorCode}${result.message ? ' — ' + result.message : ''}. Local status NOT updated.`,
    )
  }

  req.payload.logger.info(
    { subscriptionId: originalDoc!.id, stoId },
    '[subs-hook/admin-cancel] Tranzila STO inactivated before local cancel',
  )
  return data
}
