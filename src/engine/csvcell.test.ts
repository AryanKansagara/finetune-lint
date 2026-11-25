import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, parseCsv } from './formats.ts'

test('a cell reads back as the text that was written', () => {
  for (const v of ['a.jsonl', '', 'a, final.jsonl', 'say "hi".jsonl', 'two\nlines', 'a\r\nb', 'a;b', "it's", 'x=1', '"']) assert.equal(parseCsv(`f,n\n${csvCell(v)},1\n`).rows[1][0], v)
})

test('a name that a spreadsheet would run as a formula is marked as text', () => {
  for (const v of ['=1+1', '+1', '-1', '@x', ' =1', '\t=1', '=HYPERLINK("x","y")']) assert.equal(parseCsv(`f,n\n${csvCell(v)},1\n`).rows[1][0], "'" + v)
})
