/**
 * Subscriptions Collection
 *
 * Recurring-billing state for subscription-type Products. A subscription is
 * created by the Web checkout route when a user starts a PayPal Billing
 * subscription, and its lifecycle is driven by PayPal webhook events
 * (BILLING.SUBSCRIPTION.ACTIVATED, PAYMENT.SALE.COMPLETED for renewals,
 * CANCELLED/SUSPENDED/EXPIRED, PAYMENT.FAILED).
 *
 * Each renewal charge writes a new Transaction row linked to the parent
 * Subscription via `transactions.subscription`. The initial (activation)
 * transaction is also stored on the Subscription itself so we can revoke it
 * cleanly if the sub is later cancelled before any renewals fire.
 *
 * @fileType collection-config
 * @domain payments
 * @pattern recurring-billing, lifecycle-state
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { createdByField } from '../fields/createdBy'
import { tenantField } from '../fields/tenant'

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  access: {
    create: () => false, // Only created via checkout route with overrideAccess
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    description:
      'Subscriptions are created by the Web checkout route when a user starts a recurring purchase. Status is driven by PayPal webhook events — do not edit `status` or `currentPeriodEnd` by hand.',
    useAsTitle: 'paypalSubscriptionId',
    defaultColumns: ['createdAt', 'user', 'product', 'status', 'currentPeriodEnd', 'provider'],
    listSearchableFields: ['paypalSubscriptionId'],
    group: 'Payments',
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
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
      admin: {
        description: 'Subscription product being purchased',
      },
    },
    {
      name: 'provider',
      type: 'select',
      required: true,
      defaultValue: 'paypal',
      options: [{ label: 'PayPal', value: 'paypal' }],
      index: true,
      admin: {
        description: 'Payment provider (only PayPal is supported today)',
      },
    },
    {
      name: 'paypalSubscriptionId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'PayPal Billing subscription ID (I-...)',
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
        description: 'Current lifecycle state driven by PayPal webhooks',
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
      admin: {
        description:
          'End of the current billing period — access continues until this date even after cancellation',
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
        description: 'When cancellation was received from PayPal',
        readOnly: true,
      },
    },
    {
      name: 'initialTransaction',
      type: 'relationship',
      relationTo: 'transactions',
      admin: {
        description:
          'The pending Transaction created at checkout; flipped to succeeded on ACTIVATED',
      },
    },
    createdByField,
  ],
  timestamps: true,
}
