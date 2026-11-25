import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, DEFAULT_OPTIONS } from './analyze.ts'
import { applyFixes, DEFAULT_FIXES } from './fixes.ts'
import { normalise, toJsonl } from './formats.ts'
import { redactRow, rowPii } from './pii.ts'

const row = (o: object) => normalise(o, 1)!
const args = (a: unknown) => row({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: a } }] }] })
const argsOf = (r: ReturnType<typeof row>) => r.messages[1].tool_calls![0].function!.arguments

test('system prompts, arguments, labels and kept fields are scanned and stripped alike', () => {
  const r = row({
    label: 'owner a@example.com', text: 'again b@example.com', meta: { list: ['c@example.com'], n: 1 },
    messages: [{ role: 'system', content: 'd@example.com' }, { role: 'user', content: 'e@example.com' }, { role: 'assistant', content: null, function_call: { name: 'f', arguments: '{"to":"f@example.com"}' } }],
  })
  assert.equal(rowPii(r).length, 6)
  const rep = analyze([r])
  assert.equal(rep.pii.rows, 1)
  const { rows, log } = applyFixes([r], DEFAULT_FIXES, DEFAULT_OPTIONS)
  assert.equal(log.find(l => l.key === 'stripPii')!.count, 6)
  const text = toJsonl(rows, 'openai').text
  assert.ok(!text.includes('@example.com'))
  assert.equal(text.match(/\[EMAIL\]/g)!.length, 6)
  assert.equal(analyze(rows).pii.rows, 0)
})

test('masked arguments stay valid JSON and other numbers keep their digits', () => {
  const r = redactRow(args('{"id": 12345678901234567890, "card": 4111111111111111, "q": "say \\"a@example.com\\"", "e": "a\\u0040example.com"}')).row
  assert.equal(argsOf(r), '{"id": 12345678901234567890, "card": "[CARD]", "q": "say \\"[EMAIL]\\"", "e": "[EMAIL]"}')
  JSON.parse(argsOf(r) as string)
})

test('odd arguments do not throw and are still masked', () => {
  assert.equal(argsOf(redactRow(args('{"a": "x@example.com"')).row), '{"a": "[EMAIL]"')
  assert.deepEqual(argsOf(redactRow(args({ a: ['x@example.com', null, 3] })).row), { a: ['[EMAIL]', null, 3] })
  for (const a of ['', null, 5, undefined, '[]', 'null']) assert.equal(redactRow(args(a)).count, 0)
  assert.equal(redactRow(row({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', tool_calls: [null, {}, { function: {} }] }] })).count, 0)
})

test('ids keep their digits and call ids and names are never rewritten', () => {
  const r = row({ id: '4111111111111111', order_id: '1234-4123-8123', user_id: 'x@example.com', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', tool_calls: [{ id: 'a@example.com', type: 'function', function: { name: 'f', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'a@example.com', content: 'ok' }, { role: 'assistant', content: 'y' }] })
  const x = redactRow(r)
  assert.equal(x.count, 1)
  assert.deepEqual(x.row.extra, { id: '4111111111111111', order_id: '1234-4123-8123', user_id: '[EMAIL]' })
  assert.deepEqual(x.row.messages, r.messages)
})

test('a row without personal data is returned as it was', () => {
  const r = row({ prompt: 'a', chosen: 'b', rejected: 'c', tools: [{ type: 'function' }] })
  assert.equal(redactRow(r).row, r)
})
