import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OPTIONS } from './analyze.ts'
import { applyFixes, DEFAULT_FIXES } from './fixes.ts'
import { normalise } from './formats.ts'
import type { Msg } from './types.ts'

const fix = (messages: object[]): Msg[] => applyFixes([normalise({ messages }, 1)!], { ...DEFAULT_FIXES, dropInvalid: false }, DEFAULT_OPTIONS).rows[0].messages
const u = { role: 'user', content: 'Where is it?' }
const a = (content: string, extra: object = {}) => ({ role: 'assistant', content, ...extra })
const call = { function_call: { name: 'find', arguments: '{}' } }

test('turns with different weights, names or calls stay apart', () => {
  for (const pair of [[a('x', { weight: 0 }), a('y', { weight: 1 })], [a('x', { weight: 0 }), a('y')], [a('x'), a('y', { weight: 0 })], [a('x'), a('', call)], [a('', call), a('x')], [a('x', { name: 'ann' }), a('y')], [{ ...u, name: 'ann' }, { ...u, name: 'bob' }]])
    assert.deepEqual(fix([u, a('-'), u, a('-'), ...(pair[0].role === 'user' ? [] : [u]), ...pair]).slice(-2), pair)
})

test('turns that lose nothing are still merged', () => {
  const m = (...t: object[]) => fix([u, ...t]).slice(1)
  assert.deepEqual(m(a('x'), a('y')), [a('x\n\ny')])
  assert.deepEqual(m(a('x', { weight: 0 }), a('y', { weight: 0 })), [a('x\n\ny', { weight: 0 })])
  assert.deepEqual(m(a('x'), a('y', { weight: 1 })), [a('x\n\ny', { weight: 1 })])
  assert.deepEqual(m(a('x', { name: 'ann' }), a('y', { name: 'ann' })), [a('x\n\ny', { name: 'ann' })])
  assert.deepEqual(fix([u, u, a('x')])[0].content, 'Where is it?\n\nWhere is it?')
  // A weight is not valid on a user turn, so it does not keep two of them apart.
  assert.deepEqual(fix([u, { ...u, weight: 1 }, a('x')]).length, 2)
})

test('an empty turn is dropped without taking its neighbour along', () => {
  const m = (...t: object[]) => fix([u, ...t]).slice(1)
  assert.deepEqual(m(a('', { weight: 0 }), a('x', { weight: 1 })), [a('x', { weight: 1 })])
  assert.deepEqual(m(a('x', { weight: 1 }), a(' ', { weight: 0 })), [a('x', { weight: 1 })])
  assert.deepEqual(m(a('', { name: 'ann' }), a('', call)), [a('', call)])
})

test('system prompts merge, and a name on one is kept', () => {
  const s = (content: string, extra: object = {}) => ({ role: 'system', content, ...extra })
  assert.deepEqual(fix([s('one'), u, s('two'), a('x')]), [s('one\n\ntwo'), u, a('x')])
  assert.deepEqual(fix([s('one', { name: 'policy' }), u, a('x')]), [s('one', { name: 'policy' }), u, a('x')])
  assert.deepEqual(fix([s('one', { weight: 1 }), u, a('x')])[0], s('one'))
})

test('preference answers keep their fields too', () => {
  const r = normalise({ input: { messages: [u] }, preferred_output: [a('x'), a('', call)], non_preferred_output: [a('n')] }, 1)!
  assert.deepEqual(applyFixes([r], { ...DEFAULT_FIXES, dropInvalid: false }, DEFAULT_OPTIONS).rows[0].chosen, [a('x'), a('', call)])
})
