/**
 * Seed the four subscription tiers: Free, Basic, Pro, Elite.
 *
 * Idempotent — safe to re-run. Upserts by `slug`. Existing tiers keep any
 * admin-edited fields (name, description, color); only missing tiers are
 * created. This lets ops rename/relabel tiers after seeding without having
 * the seed script clobber their edits.
 *
 * Usage: npx tsx scripts/seed-tiers.ts
 */
import { getPayload } from 'payload'
import config from '@payload-config'

interface TierSeed {
  slug: string
  rank: number
  name: string
  description: string
  isDefault: boolean
  color: string
  sortOrder: number
}

const SEED_TIERS: TierSeed[] = [
  {
    slug: 'free',
    rank: 0,
    name: 'Free',
    description: 'Explore a taste of the platform at no cost.',
    isDefault: true,
    color: '#94A3B8',
    sortOrder: 0,
  },
  {
    slug: 'basic',
    rank: 1,
    name: 'Basic',
    description: 'Entry-level access to the course catalogue.',
    isDefault: false,
    color: '#4F46E5',
    sortOrder: 1,
  },
  {
    slug: 'pro',
    rank: 2,
    name: 'Pro',
    description: 'Full course access with expanded features.',
    isDefault: false,
    color: '#7C3AED',
    sortOrder: 2,
  },
  {
    slug: 'elite',
    rank: 3,
    name: 'Elite',
    description: 'Everything unlocked, including chat and premium tools.',
    isDefault: false,
    color: '#F59E0B',
    sortOrder: 3,
  },
]

async function main() {
  const payload = await getPayload({ config })

  for (const seed of SEED_TIERS) {
    const existing = await payload.find({
      collection: 'tiers',
      where: { slug: { equals: seed.slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })

    if (existing.docs.length > 0) {
      payload.logger.info(
        { slug: seed.slug, id: existing.docs[0].id },
        'seed-tiers: tier already exists — leaving admin edits intact',
      )
      continue
    }

    const created = await payload.create({
      collection: 'tiers',
      data: seed,
      overrideAccess: true,
    })
    payload.logger.info({ slug: seed.slug, id: created.id }, 'seed-tiers: created tier')
  }

  payload.logger.info('seed-tiers: done')
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to seed tiers:', err)
  process.exit(1)
})
