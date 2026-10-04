/**
 * Retro-emit .boss.txt for lessons that already have .txt + skeleton but
 * missed the boss-format hook (pipeline.ts didn't emit at the time).
 *
 * Env: NAMES=comma,separated | LESSONS_DIR (defaults to generated-lessons/algebra)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { emitBossFormat } from './boss-format/emit.js'

const DEFAULT_NAMES = [
  'משוואות-ממעלה-ראשונה',
  'משוואות-ממעלה-ראשונה-עם-מכנה',
  'יחס-מבוא',
  'יחס',
  'פרופורציה',
  'אי-שוויון-ממעלה-ראשונה',
  'מערכת-משוואות-הצבה',
  'מערכת-משוואות-מקדמים-זהים',
  'מערכת-משוואות-השוואת-מקדמים',
  'בעיות-מילוליות-כלליות',
  'בעיות-מילוליות-העברה',
  'בעיות-מילוליות-קנייה-ומכירה',
]

const NAMES = process.env.NAMES ? process.env.NAMES.split(',').map((s) => s.trim()) : DEFAULT_NAMES
const LESSONS_DIR =
  process.env.LESSONS_DIR ??
  resolve(process.cwd(), 'lessoncreation', 'mvp', 'generated-lessons', 'algebra')
const SKELETONS_DIR = resolve(
  process.cwd(),
  'lessoncreation',
  'mvp',
  'generated-skeletons',
)

let ok = 0
let fail = 0
for (const name of NAMES) {
  const txtPath = resolve(LESSONS_DIR, `${name}.txt`)
  const skPath = resolve(SKELETONS_DIR, `${name}.json`)
  try {
    if (!existsSync(txtPath)) throw new Error(`.txt not found: ${txtPath}`)
    if (!existsSync(skPath)) throw new Error(`.skeleton not found: ${skPath}`)
    const txt = readFileSync(txtPath, 'utf8')
    const sk = JSON.parse(readFileSync(skPath, 'utf8'))
    const boss = emitBossFormat(txt, sk)
    writeFileSync(resolve(LESSONS_DIR, `${name}.boss.txt`), boss, 'utf8')
    console.log(`✓ ${name} (${boss.length} chars)`)
    ok++
  } catch (err) {
    console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`)
    fail++
  }
}

console.log('')
console.log(`Done — ${ok}/${NAMES.length} emitted, ${fail} failed`)
