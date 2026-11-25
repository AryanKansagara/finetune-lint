import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseText } from './formats.ts'

const read = (t: string) => { const p = parseText(t); return { out: p.rows.map(r => r.messages.map(m => m.content)), err: p.errors.map(e => [e.line, e.code]) } }

test('a quote that never closes is reported on its line and the rows before it are kept', () => {
  assert.deepEqual(read('instruction,output\nA,B\n"C,D\nE,F\n'), { out: [['A', 'B']], err: [[3, 'bad_csv']] })
  assert.deepEqual(read('instruction,output\r\nA,"B\r\n'), { out: [], err: [[2, 'bad_csv']] })
  assert.deepEqual(read('instruction,output\nA,"B ""quoted""'), { out: [], err: [[2, 'bad_csv']] })
  assert.deepEqual(read('"instruction,output\nA,B\n'), { out: [], err: [[1, 'bad_csv']] })
  assert.deepEqual(read('instruction,output\nA,"'), { out: [], err: [[2, 'bad_csv']] })
})

test('a record with more fields than the header is reported', () => {
  assert.deepEqual(read('instruction,output\nSay hi,Hello, there\nA,B\n'), { out: [['A', 'B']], err: [[2, 'bad_csv']] })
  assert.deepEqual(read('instruction\toutput\nA\tB\tC\n'), { out: [], err: [[2, 'bad_csv']] })
})

test('valid CSV is read as before', () => {
  for (const t of ['instruction,output\nA,B\n', 'instruction,output\nA,B,,\n', 'instruction,output\nA,B, \n', 'instruction,output\n"A","B"', 'instruction,output\n\n"A","B"\n\n']) assert.deepEqual(read(t), { out: [['A', 'B']], err: [] }, t)
  assert.deepEqual(read('instruction,output\n"A, ""b""\nc",5" screen\n').out, [['A, "b"\nc', '5" screen']])
  assert.deepEqual(read('instruction,output\nA\n').out, [['A', '']])
})

test('a stray quote that swallows the next record up to another quote is reported', () => {
  assert.deepEqual(read('instruction,output\nA,B\n"C,D\n"E",F\nG,H\n'), { out: [['A', 'B'], ['G', 'H']], err: [[3, 'bad_csv']] })
  assert.deepEqual(read('instruction,output\n"Hello" he said,B\n').err, [[2, 'bad_csv']])
  assert.deepEqual(read('instruction,output\n"A" ,"" \n').err, [])
})
