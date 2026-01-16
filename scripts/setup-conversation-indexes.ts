/**
 * Setup Conversation Indexes
 *
 * Creates unique partial indexes for active conversations to enforce
 * one active conversation per (user, exercise) or (user, lesson).
 *
 * INVARIANT: Active = archivedAt field is MISSING. Archived = archivedAt field EXISTS.
 *
 * Indexes:
 * 1. unique_active_user_exercise - Only applies to exercise-based conversations
 * 2. unique_active_user_lesson - Only applies to lesson-based conversations
 *
 * These indexes are mutually exclusive (exercise XOR lesson).
 *
 * Run: pnpm tsx scripts/setup-conversation-indexes.ts
 */

import { config } from 'dotenv'
import { MongoClient } from 'mongodb'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })
config({ path: resolve(process.cwd(), '.env') })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required')
  process.exit(1)
}

async function setupIndexes() {
  const client = new MongoClient(DATABASE_URL)

  try {
    await client.connect()
    console.log('✅ Connected to MongoDB\n')

    const db = client.db()
    const collection = db.collection('conversations')

    // Check existing indexes
    const existingIndexes = await collection.indexes()
    console.log('📋 Existing indexes:')
    existingIndexes.forEach((idx) => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`)
    })
    console.log()

    // Index 1: unique_active_user_exercise
    // Only applies to exercise-based conversations (lesson must NOT exist)
    const index1Name = 'unique_active_user_exercise'
    const index1Exists = existingIndexes.some((idx) => idx.name === index1Name)

    if (index1Exists) {
      console.log(`⏭️  Index ${index1Name} already exists, skipping`)
    } else {
      console.log(`🔨 Creating index: ${index1Name}`)
      await collection.createIndex(
        { user: 1, exercise: 1 },
        {
          unique: true,
          partialFilterExpression: {
            archivedAt: { $exists: false },
            exercise: { $exists: true },
            lesson: { $exists: false }, // MUTUALLY EXCLUSIVE
          },
          name: index1Name,
        },
      )
      console.log(`✅ Created index: ${index1Name}`)
    }

    // Index 2: unique_active_user_lesson
    // Only applies to lesson-based conversations (exercise must NOT exist)
    const index2Name = 'unique_active_user_lesson'
    const index2Exists = existingIndexes.some((idx) => idx.name === index2Name)

    if (index2Exists) {
      console.log(`⏭️  Index ${index2Name} already exists, skipping`)
    } else {
      console.log(`🔨 Creating index: ${index2Name}`)
      await collection.createIndex(
        { user: 1, lesson: 1 },
        {
          unique: true,
          partialFilterExpression: {
            archivedAt: { $exists: false },
            lesson: { $exists: true },
            exercise: { $exists: false }, // MUTUALLY EXCLUSIVE
          },
          name: index2Name,
        },
      )
      console.log(`✅ Created index: ${index2Name}`)
    }

    console.log()
    console.log('✅ Index setup complete!')
    console.log()
    console.log('📊 Verification:')
    const finalIndexes = await collection.indexes()
    const index1 = finalIndexes.find((idx) => idx.name === index1Name)
    const index2 = finalIndexes.find((idx) => idx.name === index2Name)

    if (index1) {
      console.log(`   ✓ ${index1Name}: ${JSON.stringify(index1.partialFilterExpression)}`)
    }
    if (index2) {
      console.log(`   ✓ ${index2Name}: ${JSON.stringify(index2.partialFilterExpression)}`)
    }

    // Verify indexes are mutually exclusive
    if (index1 && index2) {
      const index1Filter = index1.partialFilterExpression as any
      const index2Filter = index2.partialFilterExpression as any

      const mutuallyExclusive =
        index1Filter.exercise?.$exists === true &&
        index1Filter.lesson?.$exists === false &&
        index2Filter.lesson?.$exists === true &&
        index2Filter.exercise?.$exists === false

      if (mutuallyExclusive) {
        console.log('   ✓ Indexes are mutually exclusive (exercise XOR lesson)')
      } else {
        console.log('   ⚠️  Warning: Indexes may not be mutually exclusive')
      }
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await client.close()
    console.log()
    console.log('👋 Disconnected from MongoDB')
  }
}

setupIndexes()
