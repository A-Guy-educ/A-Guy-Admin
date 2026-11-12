import { describe, expect, it } from 'vitest'

import type { QuestionTableBlock } from '@/server/payload/collections/Exercises/types'
import { ContentSchema } from '@/server/payload/collections/Exercises/schemas'
import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'
import { splitPipeTables } from '@/server/services/text-lesson-import/split-pipe-tables'

const SEP = '='.repeat(41)

describe('splitPipeTables', () => {
  it('splits text, table, text in source order', () => {
    const source = ['before', '| a | b |', '|---|---|', '| 1 | 2 |', 'after'].join('\n')

    expect(splitPipeTables(source)).toEqual([
      { kind: 'text', value: 'before' },
      { kind: 'table', headers: ['a', 'b'], rowsData: [['1', '2']] },
      { kind: 'text', value: 'after' },
    ])
  })

  it('does not treat pipe-only lines without a delimiter row as a table', () => {
    const source = ['| a | b |', '| 1 | 2 |'].join('\n')

    expect(splitPipeTables(source)).toEqual([{ kind: 'text', value: source }])
  })

  it('keeps a header with no data rows as text', () => {
    const source = ['| a | b |', '|---|---|'].join('\n')

    expect(splitPipeTables(source)).toEqual([{ kind: 'text', value: source }])
  })

  it('accepts alignment colons in the delimiter row', () => {
    const source = ['| a | b |', '|:--|:-:|', '| 1 | 2 |'].join('\n')

    expect(splitPipeTables(source)[0]).toMatchObject({ kind: 'table', rowsData: [['1', '2']] })
  })

  it('does not split a cell on pipes inside math or escaped pipes', () => {
    const source = ['| a | b |', '|---|---|', '| $$|x|$$ | c \\| d |'].join('\n')

    expect(splitPipeTables(source)[0]).toMatchObject({ rowsData: [['$$|x|$$', 'c | d']] })
  })

  it('pads short rows and trims long rows to the header width', () => {
    const source = ['| a | b |', '|---|---|', '| 1 |', '| 2 | 3 | 4 |'].join('\n')

    expect(splitPipeTables(source)[0]).toMatchObject({
      rowsData: [
        ['1', ''],
        ['2', '3'],
      ],
    })
  })

  it('returns text with no table as one text segment', () => {
    expect(splitPipeTables('just text\nwith | a pipe')).toEqual([
      { kind: 'text', value: 'just text\nwith | a pipe' },
    ])
  })
})

describe('v2 importer — `* טבלה:` in the opening data', () => {
  const source = [
    SEP,
    '[ תרגיל 9 - נתוני פתיחה ]',
    SEP,
    '* טקסט: בעיה מילולית: מחיר נסיעה',
    'מחיר ליטר דלק בתרגיל הוא $$6$$ ש״ח.',
    '* טבלה:',
    '| כביש | אורך הדרך | אגרה לכל ק״מ |',
    '|---|---|---|',
    '| 1 | 30 ק״מ | 0.7 ש״ח |',
    '| 2 | 40 ק״מ | ללא תשלום |',
    'מביאים בחשבון רק דלק ואגרה.',
    '',
    SEP,
    '[ תרגיל 9 - סעיף א - Single Choice ]',
    SEP,
    '* סוג השאלה: Single Choice',
    '* הנחיה: שאלה',
    '* אפשרות 1: כן [תשובה נכונה]',
    '* אפשרות 2: לא',
  ].join('\n')

  const convert = () => convertTextExerciseV2ToSections(parseTextLessonV2(source).exercises[0])

  it('emits text, table block, text in source order', () => {
    const { sharedBlocks } = convert()

    expect(sharedBlocks.map((b) => b.type)).toEqual(['rich_text', 'question_table', 'rich_text'])
  })

  it('fills the table block from the pipe rows', () => {
    const table = convert().sharedBlocks[1] as QuestionTableBlock

    expect(table.table).toEqual({
      solutionFill: false,
      headers: ['כביש', 'אורך הדרך', 'אגרה לכל ק״מ'],
      rowsData: [
        ['1', '30 ק״מ', '0.7 ש״ח'],
        ['2', '40 ק״מ', 'ללא תשלום'],
      ],
      answers: {},
      showBorders: true,
      showHeader: true,
    })
  })

  it('drops the `טבלה:` label and keeps the following sentence as text', () => {
    const [before, , after] = convert().sharedBlocks as Array<{ value: string }>

    expect(before.value).not.toContain('טבלה')
    expect(after.value).toBe('מביאים בחשבון רק דלק ואגרה.')
  })

  it('produces blocks that pass the content schema', () => {
    expect(ContentSchema.safeParse({ blocks: convert().sharedBlocks }).success).toBe(true)
  })

  it('leaves the sections unaffected', () => {
    const { sections } = convert()

    expect(sections[0].blocks.map((b) => b.type)).toEqual(['question_select'])
  })
})
