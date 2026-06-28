/**
 * Features Seed
 *
 * Seeds the Features collection with the 12 keys that previously lived in the
 * closed FEATURE_KEYS const array. Idempotent: upserts by `key`, never
 * overwrites admin edits to label/description/etc.
 *
 * Runs on init (see payload.config.ts) so the catalog is populated for every
 * environment without a manual step.
 *
 * @fileType seed
 * @domain billing
 */

import type { Payload } from 'payload'

interface FeatureSeed {
  key: string
  label: string
  description: string
  type: 'numeric' | 'boolean'
  unit?: string
  defaultPeriod: 'day' | 'month' | 'lifetime'
  isSilent: boolean
  enforcement: 'enforced' | 'metadata'
}

const FEATURES: FeatureSeed[] = [
  {
    key: 'ai-questions',
    label: 'AI Questions',
    description: 'Visible per-day chat-message cap shown to the buyer.',
    type: 'numeric',
    unit: 'questions',
    defaultPeriod: 'day',
    isSilent: false,
    enforcement: 'enforced',
  },
  {
    key: 'chat-limit',
    label: 'Chat Cap (silent)',
    description:
      'Silent server-side ceiling on chat usage. Hits return a generic 429 without revealing the limit.',
    type: 'numeric',
    unit: 'messages',
    defaultPeriod: 'day',
    isSilent: true,
    enforcement: 'enforced',
  },
  {
    key: 'live-sessions',
    label: 'Live Sessions',
    description: 'Access to live sessions / webinars bundled with the product.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'download-resources',
    label: 'Download Resources',
    description: 'Permission to download bundled resource files.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'certificate',
    label: 'Completion Certificate',
    description: 'Issue a completion certificate when the user finishes the bundled course.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'priority-support',
    label: 'Priority Support',
    description: 'Bumps the user to a priority support queue.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description: 'Unlocks the analytics dashboard for the buyer.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'group-access',
    label: 'Group Access',
    description: 'Adds the buyer to a private group / community.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'exercise-generation',
    label: 'Generate New Exercises',
    description: 'Allow the buyer to generate fresh exercises from the AI.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'study-plan-generation',
    label: 'Generate Personal Study Plan',
    description: 'Allow the buyer to generate a personalized study plan.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'pdf-download',
    label: 'PDF Download',
    description: 'Permission to download course PDFs.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
  {
    key: 'pdf-print',
    label: 'PDF Print',
    description: 'Permission to print course PDFs.',
    type: 'boolean',
    defaultPeriod: 'lifetime',
    isSilent: false,
    enforcement: 'metadata',
  },
]

export async function seedFeatures(payload: Payload): Promise<void> {
  for (const feature of FEATURES) {
    const existing = await payload.find({
      collection: 'features',
      where: { key: { equals: feature.key } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      // Already exists — do not overwrite admin edits to label/description/etc.
      continue
    }

    await payload.create({
      collection: 'features',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seed shape is a strict subset; verbose generic typing not worth it
      data: { ...feature, isActive: true } as any,
      overrideAccess: true,
    })
    payload.logger.info({ key: feature.key }, '[FeaturesSeed] Created feature')
  }
}

/**
 * Awaitable wrapper for the on-init seed. Errors are logged AND rethrown so a
 * silent seed failure can't leave a new environment without the catalog
 * entries that grant-entitlements relies on. Callers in payload.config.ts's
 * onInit must `await` this — fire-and-forget here would let production boot
 * with a half-populated catalog and quietly under-grant new purchases.
 */
export async function runSeedFeaturesOnInit(payload: Payload): Promise<void> {
  try {
    await seedFeatures(payload)
  } catch (error) {
    payload.logger.error({ err: error }, '[FeaturesSeed] Failed to seed features')
    throw error
  }
}
