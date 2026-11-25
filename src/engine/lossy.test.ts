import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalise, toJsonl, type Target } from './formats.ts'

const u = { role: 'user', content: 'Find it' }
const write = (last: object, target: Target) => toJsonl([normalise({ messages: [u, { role: 'assistant', content: 'No.', ...last }] }, 7)!], target)

test('rows ShareGPT and Alpaca cannot hold are skipped with a reason', () => {
  for (const [target, name] of [['sharegpt', 'ShareGPT'], ['alpaca', 'Alpaca']] as const) for (const [last, why] of [
    [{ tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find', arguments: '{}' } }] }, `tool calls have no standard ${name} form`],
    [{ function_call: { name: 'find', arguments: '{}' } }, `function calls have no standard ${name} form`],
    [{ weight: 0 }, `turn weights other than 1 have no ${name} form`],
    [{ weight: 0.5 }, `turn weights other than 1 have no ${name} form`],
  ] as const) assert.deepEqual(write(last, target), { text: '', written: 0, skipped: [{ line: 7, reason: why }] })
})

test('a weight of 1, null or an empty call list loses nothing', () => {
  for (const last of [{}, { weight: 1 }, { weight: null }, { tool_calls: [] }, { function_call: null }]) {
    assert.equal(write(last, 'alpaca').text, '{"instruction":"Find it","input":"","output":"No."}\n')
    assert.equal(write(last, 'sharegpt').text, '{"conversations":[{"from":"human","value":"Find it"},{"from":"gpt","value":"No."}]}\n')
  }
})

test('OpenAI export still writes all of them', () => {
  for (const last of [{ weight: 0 }, { function_call: { name: 'find', arguments: '{}' } }]) assert.equal(write(last, 'openai').written, 1)
})
