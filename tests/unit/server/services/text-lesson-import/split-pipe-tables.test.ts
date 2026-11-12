import { describe, expect, it } from 'vitest'

import { convertTextExerciseV2ToSections } from '@/server/services/text-lesson-import/convert-text-exercise-v2'
import { parseTextLessonV2 } from '@/server/services/text-lesson-import/parse-text-v2'
import { convertPipeTablesToHtml } from '@/server/services/text-lesson-import/pipe-table-to-html'

const SEP = '='.repeat(41)

describe('convertPipeTablesToHtml', () => {
  it('rewrites a pipe table as a single line of table markup', () => {
    const source = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')

    expect(convertPipeTablesToHtml(source)).toBe(
      '<table dir="rtl"><thead><tr><th>a</th><th>b</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })

  it('leaves the text around the table on its own lines', () => {
    const source = ['before', '| a |', '|---|', '| 1 |', 'after'].join('\n')

    const lines = convertPipeTablesToHtml(source).split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('before')
    expect(lines[1]).toMatch(/^<table/)
    expect(lines[2]).toBe('after')
  })

  it('does not treat pipe-only lines without a delimiter row as a table', () => {
    const source = ['| a | b |', '| 1 | 2 |'].join('\n')

    expect(convertPipeTablesToHtml(source)).toBe(source)
  })

  it('accepts alignment colons in the delimiter row', () => {
    const source = ['| a | b |', '|:--|:-:|', '| 1 | 2 |'].join('\n')

    expect(convertPipeTablesToHtml(source)).toContain('<td>2</td>')
  })

  it('escapes markup in cells so a cell cannot inject tags', () => {
    const source = ['| a |', '|---|', '| <b>x</b> & y |'].join('\n')

    expect(convertPipeTablesToHtml(source)).toContain('<td>&lt;b&gt;x&lt;/b&gt; &amp; y</td>')
  })

  it('does not split a cell on pipes inside math or escaped pipes', () => {
    const source = ['| a | b |', '|---|---|', '| $$|x|$$ | c \\| d |'].join('\n')

    const html = convertPipeTablesToHtml(source)

    expect(html).toContain('<td>$$|x|$$</td>')
    expect(html).toContain('<td>c | d</td>')
  })

  it('pads short rows and trims long rows to the header width', () => {
    const source = ['| a | b |', '|---|---|', '| 1 |', '| 2 | 3 | 4 |'].join('\n')

    const html = convertPipeTablesToHtml(source)

    expect(html).toContain('<tr><td>1</td><td></td></tr>')
    expect(html).toContain('<tr><td>2</td><td>3</td></tr>')
  })

  it('returns text with no table unchanged', () => {
    expect(convertPipeTablesToHtml('just text\nwith | a pipe')).toBe('just text\nwith | a pipe')
  })
})

describe('v2 importer — pipe table in the opening data', () => {
  const source = [
    SEP,
    '[ תרגיל 9 - נתוני פתיחה ]',
    SEP,
    '* טקסט: בעיה מילולית',
    'מחיר ליטר דלק הוא $$6$$ ש״ח.',
    '* טבלה:',
    '| כביש | אורך הדרך |',
    '|---|---|',
    '| 1 | 30 ק״מ |',
    '| 2 | 40 ק״מ |',
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

  it('emits text, table, text as separate blocks in source order', () => {
    const { sharedBlocks } = convert()

    expect(sharedBlocks.map((b) => b.type)).toEqual(['rich_text', 'html', 'rich_text'])
  })

  it('puts every data row in the table and none of the following text', () => {
    const table = convert().sharedBlocks[1] as { html: string }

    expect(table.html.match(/<tr>/g)).toHaveLength(3)
    expect(table.html).toContain('<td>40 ק״מ</td>')
    expect(table.html).not.toContain('מביאים')
  })

  it('drops the `טבלה:` label and keeps the following sentence as text', () => {
    const [before, , after] = convert().sharedBlocks as Array<{ value: string }>

    expect(before.value).not.toContain('טבלה')
    expect(after.value).toBe('מביאים בחשבון רק דלק ואגרה.')
  })

  it('keeps the table in the exercise so sections are unaffected', () => {
    const { sections } = convert()

    expect(sections).toHaveLength(1)
    expect(sections[0].blocks.map((b) => b.type)).toEqual(['question_select'])
  })
})
