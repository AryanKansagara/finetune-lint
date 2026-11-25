import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OPTIONS } from './analyze.ts'
import { applyFixes, DEFAULT_FIXES } from './fixes.ts'
import { normalise, toJsonl, type Target } from './formats.ts'
import { validateRow } from './validate.ts'

const TEXT = { type: 'text', text: 'What is this?' }, URL_ = { url: 'https://example.com/x.png' }
const a = { role: 'assistant', content: 'A cat.' }
const row = (content: unknown) => normalise({ messages: [{ role: 'user', content }, a] }, 3)!

test('a part that is not text is an error that names its type, and the row is not exported', () => {
  for (const [part, type] of [[{ type: 'image_url', image_url: URL_ }, 'image_url'], [{ type: 'input_audio', input_audio: {} }, 'input_audio'], [{ type: 'file', file: {} }, 'file'], [{ type: 'image', source: {} }, 'image'], [{ type: 'Image', text: 'caption' }, 'Image'], [{ type: 'refusal', refusal: 'No.' }, 'refusal'], [{ type: 'tool_use', name: 'f' }, 'tool_use'], [{ image_url: URL_ }, 'image_url'], [{ text: 'see', image_url: URL_ }, 'image_url'], [{}, 'empty']] as [object, string][]) {
    for (const c of [[part], [TEXT, part]]) {
      const r = row(c), is = validateRow(r)
      assert.deepEqual(is.map(i => i.code), ['content_part'], type)
      assert.ok(is[0].message.includes(`type ${type}.`), is[0].message)
      for (const t of ['openai', 'sharegpt', 'alpaca', 'trl-dpo'] as Target[]) assert.equal(toJsonl([r], t).written, 0)
      assert.match(toJsonl([r], 'openai').skipped[0].reason, /not kept/)
      assert.equal(applyFixes([r], DEFAULT_FIXES, DEFAULT_OPTIONS).rows.length, 0)
    }
  }
  assert.equal(validateRow(row({ type: 'image_url', image_url: URL_ }))[0].code, 'content_part')
})

test('text parts are still joined, also when padded with nulls', () => {
  for (const c of [[TEXT], [{ ...TEXT, image_url: null, file: null }], [{ type: 'input_text', text: 'What is this?' }], [{ text: 'What is this?' }], ['What is ', 'this?'], [{ type: 'paragraph', text: 'What is this?' }], [{ type: 'text', text: 'What is this?' }, { type: 'text' }]]) {
    const r = row(c)
    assert.deepEqual(validateRow(r), [])
    assert.equal(r.messages[0].content, 'What is this?')
    assert.equal(toJsonl([r], 'openai').written, 1)
  }
})

test('system turns, ShareGPT values and preference answers are covered', () => {
  const part = { type: 'image_url', image_url: URL_ }
  for (const o of [
    { messages: [{ role: 'system', content: [part] }, { role: 'user', content: 'q' }, a] },
    { conversations: [{ from: 'human', value: [TEXT, part] }, { from: 'gpt', value: 'a' }] },
    { prompt: 'q', chosen: [{ role: 'assistant', content: [part] }], rejected: 'b' },
    { prompt: [{ role: 'user', content: [TEXT, part] }], chosen: 'a', rejected: 'b' },
    { prompt: 'q', chosen: 'a', rejected: part },
  ]) {
    const r = normalise(o, 1)!
    assert.deepEqual(validateRow(r).map(i => i.code), ['content_part'], JSON.stringify(o))
    const fixed = applyFixes([r], { ...DEFAULT_FIXES, dropInvalid: false }, DEFAULT_OPTIONS).rows
    for (const x of [r, ...fixed]) for (const t of ['openai', 'trl-dpo'] as Target[]) assert.equal(toJsonl([x], t).written, 0)
  }
})

test('instruction rows with a media part are reported, JSON answers are not', () => {
  assert.deepEqual(validateRow(normalise({ prompt: [TEXT, { type: 'image_url', image_url: URL_ }], completion: 'a' }, 1)!).map(i => i.code), ['content_part'])
  for (const out of [{ a: 1 }, [{ a: 1 }, { type: 'person', name: 'x' }], { file: 'a.txt' }, 'text']) assert.deepEqual(validateRow(normalise({ instruction: 'q', output: out }, 1)!), [])
})

test('merging turns does not hide a part', () => {
  const r = normalise({ messages: [{ role: 'user', content: 'x' }, { role: 'user', content: [TEXT, { type: 'image_url', image_url: URL_ }] }, a] }, 1)!
  assert.equal(applyFixes([r], DEFAULT_FIXES, DEFAULT_OPTIONS).rows.length, 0)
})
