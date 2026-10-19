/**
 * Subscriptions Collection
 *
 * Recurring-billing state. Two provider paths coexist:
 *
 *   PayPal (legacy — kept for grandfathered subs): sub is created by the Web
 *   checkout route when a user starts a PayPal Billing subscription, and its
 *   lifecycle is driven by webhook events (BILLING.SUBSCRIPTION.ACTIVATED,
 *   PAYMENT.SALE.COMPLETED for renewals, CANCELLED/SUSPENDED/EXPIRED,
 *   PAYMENT.FAILED). Each renewal writes a new Transaction linked via
 *   `transactions.subscription`.
 *
 *   Tranzilla (primary — tier-only): sub is created by the admin bootstrap
 *   endpoint when Web redirects a buyer to the hosted iframe with a
 *   subscription offer. The first notify_url POST carries the reusable card
 *   token (TranzilaTK) and flips status pending→active via
 *   extendTierSubscription. Subsequent renewals are driven by
 *   /api/cron/tranzilla-renewals (merchant-initiated token charges), not
 *   webhooks — Tranzilla has no provider-side renewal event.
 *
 * One row represents either (product) — PayPal product-subscription — or
 * (tierSlug) — tier-subscription. Mutually exclusive; mirror of the pattern
 * already in Transactions.ts.
 *
 * @fileType collection-config
 * @domain payments
 * @pattern recurring-billing, lifecycle-state
 */

import type { CollectionConfig } from 'payload'

import { TIER_LABEL_HE } from '@/lib/tiers/constants'
import { PAID_TIER_SLUGS, TRANZILLA_OFFER_SLUGS } from '@/lib/payment/tier-tranzilla-pricing'
import { adminOnly } from '../access/adminOnly'
import { createdByField } from '../fields/createdBy'
import { tenantField } from '../fields/tenant'
// Tier recompute is disabled while `user.currentTier` is a hardcoded enum
// managed manually by admins (see ../TIERS.md). The hook file is kept on
// disk for a future revival of automatic promotion.
// import { recomputeTierOnStatusChange } from './Subscriptions/hooks/recomputeTierOnStatusChange-hook'
import { cancelTranzilaStoOnAdminCancel } from './Subscriptions/hooks/cancelTranzilaStoOnAdminCancel-hook'

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  access: {
    create: () => false, // Only created via checkout/bootstrap routes with overrideAccess
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    description:
      'Subscriptions are created by the Web checkout (PayPal) or admin bootstrap (Tranzilla) routes. Status is driven by provider webhooks or the Tranzilla renewal cron — do not edit `status`, `currentPeriodEnd`, or token/intro fields by hand.',
    useAsTitle: 'id',
    defaultColumns: [
      'createdAt',
      'user',
      'tierSlug',
      'product',
      'provider',
      'status',
      'currentPeriodEnd',
    ],
    // tranzillaCardToken is explicitly excluded — it's a reusable payment
    // credential and must stay out of admin list views and search queries.
    // tierSlug + offerSlug give admins a way to find Tranzilla subs by tier
    // (which has no human-identifiable ID field like paypalSubscriptionId).
    listSearchableFields: ['paypalSubscriptionId', 'tierSlug', 'offerSlug'],
    group: 'Payments',
  },
  hooks: {
    beforeChange: [cancelTranzilaStoOnAdminCancel],
    afterChange: [],
  },
  fields: [
    tenantField,
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: {
        description: 'User who owns the subscription',
      },
    },
    // Product OR tierSlug — mirror of Transactions.ts:76-105. One-time
    // product subs (PayPal) set `product`; tier subs leave product null and
    // set `tierSlug`. Exactly one is expected to be set at the write site;
    // enforcement is at the bootstrap/checkout layer, not here.
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      index: true,
      admin: {
        description: 'Subscription product (null for tier-subscription rows — see tierSlug)',
      },
    },
    {
      name: 'tierSlug',
      type: 'select',
      options: PAID_TIER_SLUGS.map((slug) => ({
        label: TIER_LABEL_HE[slug],
        value: slug,
      })),
      index: true,
      admin: {
        description:
          'Tier purchased (set for tier-subscription rows where product is null). See ../TIERS.md.',
      },
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      defaultValue: 'tranzilla',
      options: [
        { label: 'PayPal', value: 'paypal' },
        { label: 'Tranzilla', value: 'tranzilla' },
      ],
      index: true,
      admin: {
        description:
          'Payment provider. Tranzilla is the primary path for new subscriptions; PayPal is kept for grandfathered subs.',
      },
    },
    // Pricing snapshot — captured at bootstrap from
    // src/lib/payment/tier-tranzilla-pricing.ts and treated as immutable
    // afterward. Later catalog edits do not retroactively affect existing
    // subscribers; new subs pick up the new price on bootstrap.
    {
      name: 'offerSlug',
      type: 'select',
      options: TRANZILLA_OFFER_SLUGS.map((slug) => ({ label: slug, value: slug })),
      admin: {
        description:
          'Pricing offer selected at checkout ("default" / "intro3mo"). Null for PayPal rows.',
      },
    },
    {
      name: 'introPriceIls',
      type: 'number',
      admin: {
        description:
          'Intro-period price in ILS (null = no intro). Snapshot from the pricing catalog at bootstrap; immutable.',
      },
    },
    {
      name: 'introChargesTotal',
      type: 'number',
      admin: {
        description:
          'Total number of intro-priced charges (null = no intro). Snapshot at bootstrap; immutable.',
      },
    },
    {
      name: 'introChargesUsed',
      type: 'number',
      defaultValue: 0,
      admin: {
        description:
          'Successful intro-priced charges applied so far. Incremented only on success; failed retries do not advance.',
      },
    },
    {
      name: 'regularPriceIls',
      type: 'number',
      admin: {
        description:
          'Steady-state monthly price in ILS. Used after introChargesUsed reaches introChargesTotal.',
      },
    },
    // Tranzilla-specific: reusable card token (TranzilaTK) captured by the
    // first notify_url POST. The renewal cron charges this token monthly
    // using the TranzilaPG REST API (merchant-initiated, no buyer prompt).
    //
    // Field-level access.read: () => false means the token is NEVER returned
    // on standard REST/GraphQL reads (not even to admin users with full
    // collection access). Server code reads via overrideAccess: true
    // (cron + webhook paths) or directly via raw MongoDB — both bypass
    // access control intentionally. This cuts the blast radius of a
    // compromised admin session: a session with full `subscriptions`
    // access cannot enumerate stored payment tokens.
    {
      name: 'tranzillaCardToken',
      type: 'text',
      access: {
        read: () => false,
        create: () => true,
        update: () => true,
      },
      admin: {
        hidden: true,
        readOnly: true,
        description:
          'TranzilaTK reusable card token for merchant-initiated renewal charges. Nulled after a successful createstov2 handoff — once Tranzila stores the token with the STO, we have no reason to keep our copy. Server-only read; never surfaces in admin UI or REST.',
      },
    },
    // Tranzila My-Billing standing order id. Populated after a successful
    // createstov2 call on the bootstrap webhook; from that point on,
    // Tranzila owns the recurring charge cadence and we only use this id
    // to cancel/update the STO. Nullable: a legacy cron-driven sub, or a
    // bootstrap where createstov2 failed and we fell back to the cron
    // path, has stoId=null + tranzillaCardToken set.
    {
      name: 'stoId',
      type: 'text',
      index: true,
      admin: {
        description:
          'Tranzila My-Billing standing-order id. Set after bootstrap handoff; null means the sub is still cron-driven (fallback path).',
      },
    },
    {
      name: 'tranzillaRetryCount',
      type: 'number',
      defaultValue: 0,
      admin: {
        description:
          'Consecutive failed renewal attempts on the Tranzilla path. Reset to 0 on success; sub transitions to expired after a threshold (see cron handler).',
      },
    },
    // Set by the renewal cron just before it calls the Tranzilla direct-
    // charge API; serves as a per-sub CAS lock. A second overlapping
    // sweeper reading the same row will fail the CAS predicate
    // (lastRenewalAttemptAt > now - staleThreshold) and skip the charge
    // entirely. Stale value is auto-released after staleThreshold so a
    // crashed sweeper never permanently locks the sub.
    {
      name: 'lastRenewalAttemptAt',
      type: 'date',
      admin: {
        description:
          'Timestamp of the most recent renewal-charge attempt. Doubles as the cron CAS lock; stale values are released after ~30 minutes.',
        readOnly: true,
      },
    },
    // PayPal path — made optional + non-unique at the DB layer. Non-unique
    // because tier subs don't carry one (null would collide with other
    // nulls under a standard unique index), and the migration
    // dropPaypalSubscriptionIdStaleIndex drops the legacy non-sparse unique
    // index at boot. PayPal uniqueness is enforced at the webhook handler
    // via lookup-then-insert; collisions are vanishingly unlikely because
    // PayPal issues one sub id per subscription.
    {
      name: 'paypalSubscriptionId',
      type: 'text',
      index: true,
      admin: {
        description: 'PayPal Billing subscription ID (I-...). Null for Tranzilla subs.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Active', value: 'active' },
        { label: 'Past Due', value: 'past_due' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Suspended', value: 'suspended' },
        { label: 'Expired', value: 'expired' },
      ],
      index: true,
      admin: {
        description:
          'Current lifecycle state. PayPal: driven by webhooks. Tranzilla: driven by bootstrap + renewal cron + cancel endpoint.',
      },
    },
    {
      name: 'currentPeriodStart',
      type: 'date',
      admin: {
        description: 'Start of the current billing period',
        readOnly: true,
      },
    },
    {
      name: 'currentPeriodEnd',
      type: 'date',
      index: true,
      admin: {
        description:
          'End of the current billing period — access continues until this date even after cancellation. The Tranzilla cron selects on this field.',
        readOnly: true,
      },
    },
    {
      name: 'cancelAtPeriodEnd',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'User has cancelled but retains access until currentPeriodEnd',
      },
    },
    {
      name: 'cancelledAt',
      type: 'date',
      admin: {
        description: 'When cancellation was received (PayPal webhook or admin cancel endpoint)',
        readOnly: true,
      },
    },
    {
      name: 'initialTransaction',
      type: 'relationship',
      relationTo: 'transactions',
      admin: {
        description:
          'The pending Transaction created at checkout/bootstrap; flipped to succeeded on first successful charge.',
      },
    },
    createdByField,
  ],
  timestamps: true,
}
