/**
 * Delete a specific set of lessons in a chapter (by title) — including their
 * exercises + attached media — then re-import each from a matching .tex file
 * in the given folder. Publishes each on successful import.
 *
 * REQUIRES `pnpm dev` running (pipeline fetches media via /api/media/file/...).
 *
 * Usage:
 *   tsx scripts/delete-and-reimport-lessons.ts \
 *     --folder <path> --chapter <id> \
 *     --titles "title1|title2|..." \
 *     [--admin <email>]
 */
import 'dotenv/config'

import { readdirSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'

import type { PayloadRequest, User } from 'payload'
import { getPayload } from 'payload'
import config from '@payload-config'

import { importLatexLessonFromFile } from '@/server/services/latex-lesson-import/import-latex-lesson'
import { deriveLessonTitle } from '@/server/services/text-lesson-import/convert-text-exercise'

type Payload = Awaited<ReturnType<typeof getPayload>>

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

const FOLDER = argVal('--folder')
const CHAPTER_ID = argVal('--chapter')
const TITLES_RAW = argVal('--titles')
const ADMIN_EMAIL = argVal('--admin')

if (!FOLDER || !CHAPTER_ID || !TITLES_RAW) {
  console.error(
    'Usage: tsx scripts/delete-and-reimport-lessons.ts --folder <path> --chapter <id> --titles "t1|t2|..." [--admin <email>]',
  )
  process.exit(1)
}

const TARGET_TITLES = TITLES_RAW!
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) out.push(...walk(full))
    else if (entry.toLowerCase().endsWith('.tex')) out.push(full)
  }
  return out
}

async function findAdmin(payload: Payload, email?: string): Promise<User> {
  const where: Record<string, { equals: string }> = email
    ? { email: { equals: email } }
    : { role: { equals: 'admin' } }
  const found = await payload.find({
    collection: 'users',
    where,
    limit: 1,
    overrideAccess: true,
  })
  const user = found.docs[0] as unknown as User | undefined
  if (!user) throw new Error('No admin user found')
  return user
}

function attachCollection(user: User): User {
  return { ...(user as object), collection: 'users' } as unknown as User
}

async function cascadeDelete(payload: Payload, lessonId: string, title: string): Promise<void> {
  const lesson = await payload
    .findByID({ collection: 'lessons', id: lessonId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!lesson) return
  const contentFiles = ((lesson as { contentFiles?: (string | number)[] }).contentFiles ?? []).map(
    String,
  )
  const exercises = await payload.find({
    collection: 'exercises',
    where: { lesson: { equals: lessonId } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  for (const e of exercises.docs) {
    await payload.delete({ collection: 'exercises', id: e.id, overrideAccess: true })
  }
  await payload.delete({ collection: 'lessons', id: lessonId, overrideAccess: true })
  for (const mid of contentFiles) {
    try {
      await payload.delete({ collection: 'media', id: mid, overrideAccess: true })
    } catch {
      /* best-effort */
    }
  }
  console.log(
    `  ✓ deleted "${title}" — ${exercises.docs.length} exercises, ${contentFiles.length} media`,
  )
}

async function main(): Promise<void> {
  console.log(`--- Delete + reimport ---`)
  console.log(`chapter: ${CHAPTER_ID}`)
  console.log(`titles:  ${TARGET_TITLES.join(', ')}`)
  console.log()

  const payload = await getPayload({ config })
  const user = attachCollection(await findAdmin(payload, ADMIN_EMAIL))

  // Delete
  const existing = await payload.find({
    collection: 'lessons',
    where: { chapter: { equals: CHAPTER_ID! } },
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  console.log('Deleting matching lessons...')
  for (const title of TARGET_TITLES) {
    const match = existing.docs.find((d) => (d as { title?: string }).title === title)
    if (!match) {
      console.log(`  ✗ no lesson found with title "${title}"`)
      continue
    }
    await cascadeDelete(payload, String(match.id), title)
  }

  // Reimport
  const files = walk(FOLDER!)
  const filesByTitle = new Map<string, string>()
  for (const f of files) filesByTitle.set(deriveLessonTitle({ filename: basename(f) }), f)

  console.log(`\nReimporting...`)
  for (const [idx, title] of TARGET_TITLES.entries()) {
    const file = filesByTitle.get(title)
    if (!file) {
      console.log(
        `  [${idx + 1}/${TARGET_TITLES.length}] "${title}" — no matching .tex file, skipping`,
      )
      continue
    }
    const filename = basename(file)
    process.stdout.write(`  [${idx + 1}/${TARGET_TITLES.length}] ${filename} ... `)
    const content = readFileSync(file, 'utf8')

    const req = {
      payload,
      user,
      url: '',
      headers: new Headers(),
      routeParams: {},
      context: {},
    } as unknown as PayloadRequest

    try {
      const result = await importLatexLessonFromFile(req, user, {
        chapterId: CHAPTER_ID!,
        filename,
        content,
      })
      if ('kind' in result) {
        console.log(`FAIL (${result.kind})`)
        continue
      }

      let publishOk = false
      if (result.success) {
        try {
          await payload.update({
            collection: 'lessons',
            id: result.lessonId,
            data: { status: 'published' } as unknown as Record<string, unknown>,
            user,
            overrideAccess: false,
          })
          publishOk = true
        } catch (err) {
          console.log(`\n     publish failed: ${(err as Error).message}`)
        }
      }

      console.log(
        `${result.success ? 'OK' : 'PARTIAL'} — ${result.exercisesCreated} exercises${
          result.warnings.length ? `, ${result.warnings.length} warnings` : ''
        }${result.latexBlocksFailed ? `, ${result.latexBlocksFailed} blocks failed` : ''}${
          publishOk ? ' [published]' : ' [draft]'
        }`,
      )
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
