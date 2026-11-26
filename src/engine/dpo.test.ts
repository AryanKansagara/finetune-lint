import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalise, parseText } from './formats.ts'

const read = (o: object) => { const r = normalise({ chosen: 'y', rejected: 'n', ...o }, 1)!; return { prompt: r.messages.map(m => m.content), extra: r.extra } }

// Layout: LLaMA-Factory data/README.md, "Alpaca Format > Preference Dataset" (instruction required, input optional).
test('Alpaca preference rows join instruction and input like SFT rows do', () => {
  assert.deepEqual(read({ instruction: 'Summarise.', input: 'Long text' }), { prompt: ['Summarise.\n\nLong text'], extra: undefined })
  for (const input of ['', '  ']) assert.deepEqual(read({ instruction: 'Summarise.', input }), { prompt: ['Summarise.'], extra: undefined })
  assert.deepEqual(read({ system: 'S', prompt: 'P', input: 'I' }).prompt, ['S', 'P\n\nI'])
  assert.deepEqual(read({ instruction: '', input: 'I' }).prompt, ['I'])
  assert.deepEqual(parseText('prompt,input,chosen,rejected\nP,I,y,n\n').rows[0].messages, [{ role: 'user', content: 'P\n\nI' }])
})

test('rows with one prompt field, a repeated input or a formatted prompt read as before', () => {
  assert.deepEqual(read({ input: 'I' }).prompt, ['I'])
  assert.deepEqual(read({ instruction: 'same', input: 'same' }).prompt, ['same'])
  assert.deepEqual(read({ prompt: '### Instruction:\nDo\n### Input:\nX', input: 'X' }).prompt, ['### Instruction:\nDo\n### Input:\nX'])
  // Two candidate tasks: the prompt field wins and the rest is kept as metadata.
  assert.deepEqual(read({ prompt: 'full', instruction: 'Do', input: 'X' }), { prompt: ['full'], extra: { instruction: 'Do', input: 'X' } })
  assert.deepEqual(read({ prompt: [{ role: 'user', content: 'P' }], input: 'X' }), { prompt: ['P'], extra: { input: 'X' } })
  assert.deepEqual(read({ prompt: '\n\nHuman: a\n\nAssistant: b\n\nHuman: c', input: 'X' }), { prompt: ['a', 'b', 'c'], extra: { input: 'X' } })
  assert.deepEqual(read({ instruction: 'Do', input: { a: 1 } }), { prompt: ['Do'], extra: { input: { a: 1 } } })
})
