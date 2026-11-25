import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.ts'
import { convert, normalise, parseText } from './formats.ts'
import { redactRow, rowPii } from './pii.ts'
import type { Row } from './types.ts'

const FIELDS: [object, string | undefined][] = [[{ label: true }, undefined], [{ label: 1 }, '1'], [{ label: 0 }, '0'], [{ label: null }, undefined], [{ label: '' }, ''], [{ label: ['a'] }, undefined], [{ intent: 'x' }, 'x'], [{ class: 'a', label: 'b' }, 'b'], [{ label: true, category: 'q' }, 'q'], [{}, undefined]]
const SHAPES: [string, object, 'openai' | 'sharegpt' | 'alpaca' | 'trl-dpo', string[]][] = [
  ['openai', { messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }, 'openai', ['messages']],
  ['sharegpt', { conversations: [{ from: 'human', value: 'q' }, { from: 'gpt', value: 'a' }] }, 'sharegpt', ['conversations']],
  ['alpaca', { instruction: 'q', input: '', output: 'a' }, 'alpaca', ['instruction', 'input', 'output']],
  ['dpo', { prompt: 'q', chosen: 'a', rejected: 'b' }, 'trl-dpo', ['prompt', 'chosen', 'rejected']],
  ['preference', { input: { messages: [{ role: 'user', content: 'q' }] }, preferred_output: [{ role: 'assistant', content: 'a' }], non_preferred_output: [{ role: 'assistant', content: 'b' }] }, 'openai', ['input', 'preferred_output', 'non_preferred_output']],
]

test('label fields keep their name and type in every shape, and the class is the same text as before', () => {
  for (const [name, shape, target, own] of SHAPES) for (const [fields, label] of FIELDS) {
    const r = normalise({ ...shape, ...fields }, 1)!
    assert.equal(r.label, label, name)
    const out = convert(r, target) as Record<string, unknown>
    assert.deepEqual(Object.fromEntries(Object.entries(out).filter(([k]) => !own.includes(k))), fields, `${name} ${JSON.stringify(fields)}`)
  }
})

test('rows stored with the label only as text still export it', () => {
  const old: Row = { line: 1, format: 'alpaca', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }], label: 'x', extra: { id: 5 } }
  assert.deepEqual(convert(old, 'alpaca'), { id: 5, label: 'x', instruction: 'q', input: '', output: 'a' })
})

test('a label with personal data is counted once and masked in both places', () => {
  const r = normalise({ prompt: 'q', completion: 'a', intent: 'mail a@example.com' }, 1)!
  assert.equal(rowPii(r).length, 1)
  const x = redactRow(r)
  assert.equal(x.count, 1)
  assert.equal(x.row.label, 'mail [EMAIL]')
  assert.deepEqual(x.row.extra, { intent: 'mail [EMAIL]' })
})

test('a label inside the input of a preference row does not become the label of the row', () => {
  const r = normalise({ label: 'p', input: { messages: [{ role: 'user', content: 'q' }], label: 'inner' }, preferred_output: [], non_preferred_output: [] }, 1)!
  assert.equal(r.label, 'p')
  assert.deepEqual(r.extra, { label: 'p' })
})

test('class balance and CSV labels work as before', () => {
  const rows = Array.from({ length: 6 }, (_, i) => normalise({ prompt: `q${i}`, completion: 'a', category: i < 4 ? 'x' : 'y' }, i)!)
  assert.deepEqual(analyze(rows).labels.classes, [['x', 4], ['y', 2]])
  const c = parseText('instruction,output,intent\nAsk,Answer,greet\n').rows[0]
  assert.deepEqual([c.label, c.extra], ['greet', { label: 'greet' }])
})
