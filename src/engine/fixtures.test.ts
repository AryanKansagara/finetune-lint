// Records written to match the exact layout of public datasets and vendor docs (content is our own).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, DEFAULT_OPTIONS, FIREWORKS_TRAIN_PRICES } from './analyze.ts'
import { convert, parseText, splitTranscript, toJsonl } from './formats.ts'
import { rowTokens } from './tokens.ts'
import type { Row } from './types.ts'
import { validateRow } from './validate.ts'

const codes = (r: Row) => validateRow(r).map(i => i.code)
const one = (o: unknown) => { const p = parseText(JSON.stringify(o)); assert.equal(p.errors.length, 0, JSON.stringify(p.errors)); return p.rows[0] }

// hh-rlhf: chosen and rejected are full transcripts that share the history.
const HH = { chosen: '\n\nHuman: How do I keep basil alive indoors?\n\nAssistant: Give it a sunny window and water when the top inch is dry.\n\nHuman: How often is that?\n\nAssistant: Usually every three or four days.', rejected: '\n\nHuman: How do I keep basil alive indoors?\n\nAssistant: Give it a sunny window and water when the top inch is dry.\n\nHuman: How often is that?\n\nAssistant: Whenever.' }

test('HH-RLHF transcripts split into turns with the shared history as the prompt', () => {
  const r = one(HH)
  assert.equal(r.format, 'dpo')
  assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant', 'user'])
  assert.equal(r.messages[2].content, 'How often is that?')
  assert.deepEqual(r.chosen, [{ role: 'assistant', content: 'Usually every three or four days.' }])
  assert.deepEqual(r.rejected, [{ role: 'assistant', content: 'Whenever.' }])
  assert.deepEqual(codes(r), [])
})

test('transcript splitting leaves ordinary text alone and keeps colons inside turns', () => {
  assert.equal(splitTranscript('Human resources: please file the form.'), null)
  assert.deepEqual(splitTranscript('Human: Ratio is 3:1?\n\nAssistant: Yes: three to one.')?.map(m => m.content), ['Ratio is 3:1?', 'Yes: three to one.'])
})

test('UltraFeedback binarized: the prompt repeated inside chosen/rejected is dropped', () => {
  const u = { prompt: 'Name a prime above 10.', prompt_id: 'ab12', chosen: [{ content: 'Name a prime above 10.', role: 'user' }, { content: '11', role: 'assistant' }], rejected: [{ content: 'Name a prime above 10.', role: 'user' }, { content: '12', role: 'assistant' }], messages: [{ content: 'Name a prime above 10.', role: 'user' }, { content: '11', role: 'assistant' }], score_chosen: 9, score_rejected: 2 }
  const r = one(u)
  assert.deepEqual(r.messages.map(m => m.role), ['user'])
  assert.deepEqual(r.chosen!.map(m => m.content), ['11'])
  assert.deepEqual(r.rejected!.map(m => m.content), ['12'])
  assert.equal(r.extra?.score_chosen, 9)
  const trl = convert(r, 'trl-dpo') as Record<string, unknown[]>
  assert.equal(trl.prompt.length, 1)
  assert.equal(trl.chosen.length, 1)
})

test('orca DPO pairs: system plus question (Intel) or input (Argilla) become the prompt', () => {
  const intel = one({ system: 'You are a helpful assistant.', question: 'Add 2 and 3.', chosen: '5', rejected: '6' })
  assert.deepEqual(intel.messages.map(m => m.role), ['system', 'user'])
  assert.deepEqual(codes(intel), [])
  const argilla = one({ system: '', input: 'Add 2 and 3.', chosen: '5', rejected: '6', rating: [9, 3], status: 'tie' })
  assert.deepEqual(argilla.messages, [{ role: 'user', content: 'Add 2 and 3.' }])
  assert.deepEqual(argilla.extra, { rating: [9, 3], status: 'tie' })
})

test('OpenAI preference rows keep input.tools and parallel_tool_calls through a round trip', () => {
  const tools = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } }]
  const src = { input: { messages: [{ role: 'user', content: 'Weather in Oslo?' }], tools, parallel_tool_calls: true }, preferred_output: [{ role: 'assistant', content: 'Let me check.' }], non_preferred_output: [{ role: 'assistant', content: 'No idea.' }] }
  const r = one(src)
  const back = convert(r, 'openai') as Record<string, Record<string, unknown>>
  assert.deepEqual(back.input.tools, tools)
  assert.equal(back.input.parallel_tool_calls, true)
  assert.equal('tools' in back, false)
})

test('OpenAI per-turn weight is validated and kept on export', () => {
  const ok = one({ messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!', weight: 0 }, { role: 'user', content: 'Capital of France?' }, { role: 'assistant', content: 'Paris.', weight: 1 }] })
  assert.deepEqual(codes(ok), [])
  assert.match(toJsonl([ok], 'openai').text, /"weight":0/)
  const bad = one({ messages: [{ role: 'user', content: 'Hi', weight: 1 }, { role: 'assistant', content: 'Hello', weight: 0.5 }] })
  assert.deepEqual(codes(bad), ['bad_weight', 'bad_weight'])
  const silent = one({ messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello', weight: 0 }] })
  assert.deepEqual(codes(silent), ['nothing_to_learn'])
})

test('legacy function_call assistant turns are not reported as empty', () => {
  const r = one({ messages: [{ role: 'user', content: 'Weather in Oslo?' }, { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{"city":"Oslo"}' } }, { role: 'assistant', content: 'Checking now.' }] })
  assert.equal(codes(r).includes('empty_turn'), false)
  assert.match(toJsonl([r], 'openai').text, /"function_call":\{"name":"get_weather"/)
  const broken = one({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: '', function_call: { name: 'f', arguments: { city: 'Oslo' } } }] })
  assert.ok(codes(broken).includes('tool_schema'))
})

test('Alpaca records with the extra text field import cleanly and keep text as metadata', () => {
  const r = one({ instruction: 'Give two tips for sleep.', input: '', output: '1. Keep a schedule.\n2. Avoid screens late.', text: 'Below is an instruction...' })
  assert.equal(r.format, 'alpaca')
  assert.equal(r.messages[0].content, 'Give two tips for sleep.')
  assert.equal(r.extra?.text, 'Below is an instruction...')
})

test('cost estimate matches a hand calculation at a published Fireworks rate', () => {
  const price = FIREWORKS_TRAIN_PRICES.find(([m]) => m === 'Qwen 3.6 35B A3B')![1]
  const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ line: i + 1, format: 'openai', messages: [{ role: 'user', content: `question number ${i} about shipping times` }, { role: 'assistant', content: `answer ${i}: orders ship within two business days` }] }))
  const r = analyze(rows, { ...DEFAULT_OPTIONS, pricePerM: price, epochs: 2, nearThreshold: 0.99 })
  assert.equal(r.cost.billed, rows.reduce((s, x) => s + rowTokens(x).total, 0))
  assert.equal(r.cost.trainingTokens, r.cost.billed * 2)
  assert.ok(Math.abs(r.cost.usd - r.cost.trainingTokens / 1e6 * 2.14) < 1e-12)
})
