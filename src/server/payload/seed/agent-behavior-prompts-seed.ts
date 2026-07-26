/**
 * Agent Behavior Prompts Seed
 *
 * The `agent-behavior-prompts` collection existed in code but was never
 * registered in payload.config, so `resolveAgentBehaviorPrompt` always fell
 * through to its hardcoded failsafe. Registering the collection alone would
 * leave it empty — and an empty collection still resolves to the failsafe, so
 * the admin panel would look live while changing nothing.
 *
 * This seeds one published, default profile per content locale using the
 * failsafe text verbatim. Runtime behaviour is therefore identical to before,
 * but the prompt is now editable in the admin without a deploy.
 *
 * Idempotent: upserts by (slug, locale) and never overwrites admin edits.
 *
 * @fileType seed
 * @domain ai
 */

import type { Payload } from 'payload'

import { CONTENT_LOCALES } from '@/server/payload/fields/contentLocale'
import {
  DEFAULT_AGENT_BEHAVIOR_PROFILE_SLUG,
  FAILSAFE_AGENT_BEHAVIOR_PROMPT,
} from '@/server/services/agent-behavior-prompt-resolver'

export async function seedAgentBehaviorPrompts(payload: Payload): Promise<void> {
  // `tenantField` is required on this collection. onInit creates the default
  // tenant before seeds run, so this should always resolve.
  const tenantSlug = process.env.DEFAULT_TENANT_SLUG || 'default'
  const tenants = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: tenantSlug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (tenants.docs.length === 0) {
    payload.logger.warn(
      { tenantSlug },
      '[AgentBehaviorPromptsSeed] Default tenant not found — skipping seed. ' +
        'The resolver falls back to its built-in failsafe, so behaviour is unchanged.',
    )
    return
  }

  const tenantId = tenants.docs[0].id as string

  for (const locale of CONTENT_LOCALES) {
    const existing = await payload.find({
      collection: 'agent-behavior-prompts',
      where: {
        and: [
          { slug: { equals: DEFAULT_AGENT_BEHAVIOR_PROFILE_SLUG } },
          { locale: { equals: locale } },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) continue

    await payload.create({
      collection: 'agent-behavior-prompts',
      data: {
        slug: DEFAULT_AGENT_BEHAVIOR_PROFILE_SLUG,
        title: 'Supportive Guide',
        description:
          'Patient, encouraging assistant that celebrates progress and suggests what to learn next.',
        // Verbatim failsafe text — seeding a different prompt here would be a
        // silent behaviour change on the deploy that registers the collection.
        template: FAILSAFE_AGENT_BEHAVIOR_PROMPT,
        isDefault: true,
        isEnabled: true,
        locale,
        tenant: tenantId,
        status: 'published',
        priority: 0,
      },
      overrideAccess: true,
    })

    payload.logger.info(
      { slug: DEFAULT_AGENT_BEHAVIOR_PROFILE_SLUG, locale },
      '[AgentBehaviorPromptsSeed] Created default profile',
    )
  }
}

/**
 * Awaitable wrapper for the on-init seed.
 *
 * Errors are logged but NOT rethrown: unlike the features catalog, a missing
 * profile degrades gracefully — `resolveAgentBehaviorPrompt` falls back to the
 * same failsafe text this seed would have written. Failing boot over it would
 * trade a no-op for an outage.
 */
export async function runSeedAgentBehaviorPromptsOnInit(payload: Payload): Promise<void> {
  try {
    await seedAgentBehaviorPrompts(payload)
  } catch (error) {
    payload.logger.error(
      { err: error },
      '[AgentBehaviorPromptsSeed] Failed to seed default agent behavior prompt',
    )
  }
}
