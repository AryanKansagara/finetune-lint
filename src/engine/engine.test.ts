import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, DEFAULT_OPTIONS, summarise } from './analyze.ts'
import { balance, boilerplate, detectLanguage, inferLabels, isRefusal, luhn, redact, scanPii } from './content.ts'
import { findDuplicates, groups, rowKey } from './dedupe.ts'
import { applyFixes, DEFAULT_FIXES, makeSplit, trimRow } from './fixes.ts'
import { convert, normalise, parseCsv, parseText, toJsonl } from './formats.ts'
import { sampleFiles, supportDpo, supportSft } from './sample.ts'
import { billedTokens, countTokens, rowTokens } from './tokens.ts'
import type { Row } from './types.ts'
import { validateRow } from './validate.ts'
import { diffVersions, type Version } from './versions.ts'

const chat = (u: string, a: string, extra: Partial<Row> = {}): Row => ({ line: 1, format: 'openai', messages: [{ role: 'user', content: u }, { role: 'assistant', content: a }], ...extra })
const codes = (r: Row) => validateRow(r).map(i => i.code)
const load = (files = supportSft()) => {
  const rows: Row[] = []
  const errs = []
  for (const f of files) { const p = parseText(f.text); rows.push(...p.rows.map(r => ({ ...r, split: f.split, file: f.name }))); errs.push(...p.errors.map(e => ({ ...e, file: f.name }))) }
  return { rows, errs }
}

// ---------- Formats ----------

test('detects all four shapes and normalises them to messages', () => {
  assert.equal(normalise({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }, 1)?.format, 'openai')
  const sg = normalise({ conversations: [{ from: 'human', value: 'hi' }, { from: 'gpt', value: 'yo' }] }, 2)!
  assert.equal(sg.format, 'sharegpt')
  assert.deepEqual(sg.messages.map(m => m.role), ['user', 'assistant'])
  const al = normalise({ instruction: 'Translate', input: 'hola', output: 'hello' }, 3)!
  assert.equal(al.format, 'alpaca')
  assert.equal(al.messages[0].content, 'Translate\n\nhola')
  const dpo = normalise({ prompt: 'Q?', chosen: 'good', rejected: 'bad' }, 4)!
  assert.equal(dpo.format, 'dpo')
  assert.equal(dpo.chosen![0].content, 'good')
  assert.equal(normalise({ foo: 1 }, 5), null)
})

test('JSONL parse reports bad lines with their line numbers and keeps the rest', () => {
  const text = '{"messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]}\n\n{"messages": [oops\n{"weird":true}\n'
  const p = parseText(text)
  assert.equal(p.rows.length, 1)
  assert.deepEqual(p.errors.map(e => [e.line, e.code]), [[3, 'invalid_json'], [4, 'unknown_shape']])
})

test('OpenAI content parts and preference format are read', () => {
  const r = normalise({ messages: [{ role: 'user', content: [{ type: 'text', text: 'he' }, { type: 'text', text: 'llo' }] }, { role: 'assistant', content: 'x' }] }, 1)!
  assert.equal(r.messages[0].content, 'hello')
  const p = normalise({ input: { messages: [{ role: 'user', content: 'q' }] }, preferred_output: [{ role: 'assistant', content: 'a' }], non_preferred_output: [{ role: 'assistant', content: 'b' }] }, 1)!
  assert.equal(p.format, 'dpo')
  assert.equal(p.rejected![0].content, 'b')
})

test('CSV with quoted newlines keeps record start lines and maps columns', () => {
  const csv = 'instruction,output,label\n"Say hi","Hi\nthere",greet\nAsk,Answer,other\n'
  const c = parseCsv(csv)
  assert.deepEqual(c.lines, [1, 2, 4])
  const p = parseText(csv)
  assert.equal(p.rows.length, 2)
  assert.equal(p.rows[0].messages[1].content, 'Hi\nthere')
  assert.equal(p.rows[0].label, 'greet')
  assert.equal(p.rows[1].line, 4)
})

test('conversion round-trips and refuses lossy targets', () => {
  const r = chat('Q', 'A', { label: 'x' })
  const sg = convert(r, 'sharegpt') as { conversations: { from: string }[] }
  assert.deepEqual(sg.conversations.map(c => c.from), ['human', 'gpt'])
  const back = normalise(sg, 1)!
  assert.equal(rowKey(back), rowKey(r))
  const multi: Row = { line: 1, format: 'openai', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }] }
  assert.ok('skip' in convert(multi, 'alpaca'))
  const out = toJsonl([r, multi], 'alpaca')
  assert.equal(out.written, 1)
  assert.equal(out.skipped.length, 1)
  assert.ok('skip' in convert(r, 'trl-dpo'))
})

// ---------- Validation ----------

test('validation flags roles, empty turns, final turn and system placement', () => {
  assert.deepEqual(codes(chat('hi', 'hello')), [])
  assert.ok(codes({ ...chat('hi', 'x'), messages: [{ role: 'Human', content: 'hi' }, { role: 'assistant', content: 'x' }] }).includes('bad_role'))
  assert.ok(codes(chat('hi', '  ')).includes('empty_turn'))
  assert.ok(codes({ line: 1, format: 'openai', messages: [{ role: 'user', content: 'hi' }] }).includes('no_assistant_final'))
  assert.ok(codes({ line: 1, format: 'openai', messages: [{ role: 'user', content: 'hi' }, { role: 'system', content: 's' }, { role: 'assistant', content: 'x' }] }).includes('system_not_first'))
  assert.ok(codes({ line: 1, format: 'openai', messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'x' }] }).includes('consecutive_roles'))
})

test('tool calls need a name, JSON-string arguments, an id and a matching tool result', () => {
  const good: Row = { line: 1, format: 'openai', messages: [
    { role: 'user', content: 'status?' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{}' }, { role: 'assistant', content: 'shipped' }] }
  assert.deepEqual(codes(good), [])
  const bad: Row = { ...good, messages: [good.messages[0], { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: { id: 1 } } }] }, { role: 'tool', tool_call_id: 'c9', content: '{}' }, good.messages[3]] }
  const msgs = validateRow(bad).filter(i => i.code === 'tool_schema').map(i => i.message).join(' ')
  assert.match(msgs, /JSON-encoded string/)
  assert.match(msgs, /id is missing/)
  assert.match(msgs, /no earlier assistant turn made/)
})

test('preference pairs need both sides', () => {
  assert.ok(codes({ line: 1, format: 'dpo', messages: [{ role: 'user', content: 'q' }], chosen: [{ role: 'assistant', content: 'a' }], rejected: [{ role: 'assistant', content: '' }] }).includes('dpo_missing'))
})

// ---------- Tokens ----------

test('token estimate matches cl100k on reference strings', () => {
  // Reference counts from the cl100k_base tokenizer.
  assert.equal(countTokens('The quick brown fox jumps over the lazy dog.'), 10)
  assert.equal(countTokens('Hello world'), 2)
  const support = "I'm sorry to hear that! I've checked your account and I can see two charges of $29.99 on November 3rd. I've issued a refund for the duplicate charge; it should appear within 5-7 business days."
  assert.ok(Math.abs(countTokens(support) - 50) <= 4, `got ${countTokens(support)}`)
  assert.equal(countTokens(''), 0)
})

test('row tokens include chat-template overhead and truncate at the context for billing', () => {
  const r = chat('hello there', 'general kenobi')
  const t = rowTokens(r)
  assert.equal(t.total, 1 + 4 + countTokens('hello there') + 4 + countTokens('general kenobi'))
  assert.equal(t.completion, 4 + countTokens('general kenobi'))
  assert.equal(billedTokens(r, 5), 5)
  const pair: Row = { line: 1, format: 'dpo', messages: [{ role: 'user', content: 'hi' }], chosen: [{ role: 'assistant', content: 'a b c' }], rejected: [{ role: 'assistant', content: 'a' }] }
  assert.equal(billedTokens(pair, 9999), (1 + 5 + 7) + (1 + 5 + 5))
})

// ---------- Duplicates ----------

test('exact duplicates ignore case, punctuation and whitespace', () => {
  const d = findDuplicates(['Hello, World!', 'hello world', 'something else entirely'])
  assert.deepEqual(d.exact, [[0, 1]])
})

test('MinHash finds near duplicates and leaves different texts alone', () => {
  const base = 'my order arrived damaged and the box was crushed so i would like a replacement sent to my home address as soon as possible please'
  const d = findDuplicates([base, base.replace('as soon as possible', 'asap'), 'how do i reset my password because the email never arrives in my inbox at all even after waiting'], 0.6)
  assert.deepEqual(d.near, [[0, 1]])
  assert.equal(d.pairs.length, 1)
})

test('union-find groups transitive pairs', () => {
  assert.deepEqual(groups(5, [[0, 1], [1, 2], [3, 4]]), [[0, 1, 2], [3, 4]])
})

// ---------- PII and content ----------

test('Luhn separates real card numbers from random digits', () => {
  assert.ok(luhn('4111111111111111'))
  assert.ok(!luhn('4111111111111112'))
})

test('PII scan finds emails, phones, cards, SSNs and keys without double counting', () => {
  const t = 'Mail ann.lee@example.com, call (415) 555-0137, card 4111 1111 1111 1111, ssn 219-09-9999, key sk-live-9fQ2mZxR7tWp4LkN8vB3cD6hJ1sA5eYu. Order 1234 5678 9012 3456 is not a card.'
  const types = scanPii(t).map(h => h.type)
  assert.deepEqual(types, ['email', 'phone', 'card', 'ssn', 'secret'])
  const r = redact(t)
  assert.match(r.text, /\[EMAIL\].*\[PHONE\].*\[CARD\].*\[SSN\].*\[SECRET\]/)
  assert.ok(!r.text.includes('4111'))
})

test('refusals and repeated openers are detected', () => {
  assert.ok(isRefusal('As an AI language model, I cannot do that.'))
  assert.ok(isRefusal("I'm sorry, but I can't help with that request."))
  assert.ok(!isRefusal('Sorry about the delay, your refund is on its way.'))
  const replies = [...Array(20).fill('Certainly! I would be happy to help with that.'), ...Array.from({ length: 80 }, (_, i) => `Answer number ${i} is different`)]
  assert.equal(boilerplate(replies)[0].opener, 'certainly i would be happy')
})

test('language detection by script and character trigrams', () => {
  assert.equal(detectLanguage('Where is my order? It has been a week and the tracking page has not changed at all.').lang, 'en')
  assert.equal(detectLanguage('Hola, ¿dónde está mi pedido? Lo compré hace una semana y todavía no llega a mi casa.').lang, 'es')
  assert.equal(detectLanguage('Bonjour, je voudrais retourner ma veste, elle est trop grande pour moi. Comment faire ?').lang, 'fr')
  assert.equal(detectLanguage('Hallo, ich wurde für meine Bestellung zweimal belastet. Können Sie das bitte prüfen?').lang, 'de')
  assert.equal(detectLanguage('ご注文の商品は明日発送されます。追跡番号はメールでお送りします。よろしくお願いします。').lang, 'ja')
  assert.equal(detectLanguage('ok thanks').lang, 'und')
})

test('classification-style labels are inferred and balance is measured', () => {
  const finals = [...Array(30).fill('positive'), ...Array(10).fill('negative.'), ...Array(5).fill('neutral')]
  const l = inferLabels(finals)!
  assert.equal(l[30], 'negative')
  const b = balance(l)
  assert.deepEqual(b.classes[0], ['positive', 30])
  assert.equal(b.ratio, 6)
  assert.equal(inferLabels(Array.from({ length: 30 }, (_, i) => `A long free-form answer number ${i} with many words in it`)), null)
})

// ---------- Fixes and split ----------

test('fixes normalise roles, strip PII, trim to context and dedupe', () => {
  const long = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
  const rows: Row[] = [
    { line: 1, format: 'sharegpt', messages: [{ role: 'Human', content: 'mail me at a@b.co' }, { role: 'bot', content: 'Sure.' }] },
    { line: 2, format: 'openai', messages: [{ role: 'user', content: long }, { role: 'assistant', content: 'one' }, { role: 'user', content: 'short question here' }, { role: 'assistant', content: 'short answer' }] },
    chat('dup', 'dup answer', { line: 3 }), chat('DUP!', 'dup answer.', { line: 4 }),
    chat('broken', '', { line: 5 }),
  ]
  const { rows: out, log } = applyFixes(rows, DEFAULT_FIXES, { ctx: 200, nearThreshold: 0.8 })
  assert.deepEqual(out.map(r => r.line), [1, 2, 3])
  assert.equal(out[0].messages[0].role, 'user')
  assert.equal(out[0].messages[0].content, 'mail me at [EMAIL]')
  assert.equal(out[1].messages.length, 2)
  assert.equal(log.find(l => l.key === 'dedupeExact')!.count, 1)
})

test('trimming keeps the system prompt and the final exchange', () => {
  const big = 'x '.repeat(3000)
  const r: Row = { line: 1, format: 'openai', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: big }, { role: 'assistant', content: big }, { role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }
  const t = trimRow(r, 100)!
  assert.deepEqual(t.messages.map(m => m.content), ['sys', 'q', 'a'])
  assert.equal(trimRow({ ...r, messages: [r.messages[0], r.messages[1], r.messages[2]] }, 100), null)
})

test('split is stratified, deterministic and keeps duplicate clusters together', () => {
  const rows: Row[] = []
  for (let i = 0; i < 200; i++) rows.push(chat(`question ${i} about topic ${i % 7} with some unique words ${i * 13}`, `answer ${i}`, { line: i + 1, label: i < 150 ? 'a' : 'b' }))
  for (let i = 0; i < 10; i++) rows.push({ ...rows[i], line: 300 + i })
  const s = makeSplit(rows, { evalFraction: 0.1, seed: 1, nearThreshold: 0.8, labels: rows.map(r => r.label ?? null) })
  const ev = s.filter(r => r.split === 'eval')
  assert.ok(ev.length >= 19 && ev.length <= 23, `eval size ${ev.length}`)
  const share = ev.filter(r => r.label === 'b').length / ev.length
  assert.ok(share > 0.18 && share < 0.32, `label b share ${share}`)
  for (let i = 0; i < 10; i++) assert.equal(s[i].split, s[200 + i].split)
  assert.deepEqual(makeSplit(rows, { evalFraction: 0.1, seed: 1, nearThreshold: 0.8 }).map(r => r.split), makeSplit(rows, { evalFraction: 0.1, seed: 1, nearThreshold: 0.8 }).map(r => r.split))
})

// ---------- Whole dataset ----------

test('the synthetic SFT sample surfaces every planted problem', () => {
  const files = supportSft()
  assert.equal(files[0].text.trim().split('\n').length, 1200)
  const { rows, errs } = load(files)
  const r = analyze(rows, DEFAULT_OPTIONS, errs)
  assert.equal(r.counts.invalid_json, 6)
  assert.ok((r.counts.exact_dup ?? 0) >= 32)
  assert.ok((r.counts.near_dup ?? 0) >= 20)
  assert.ok(r.leaks.length >= 12)
  assert.ok(r.pii.rows >= 25)
  assert.equal(r.refusals, 18)
  assert.equal(r.tokens.overCtx, 8)
  assert.equal(r.labels.source, 'field')
  assert.equal(r.labels.classes[0][0], 'billing')
  assert.ok(r.lang.counts.some(([l]) => l === 'es'))
  assert.ok(r.openers.length >= 1)
})

test('fix-ups clear the blocking problems in the sample', () => {
  const { rows } = load()
  const fixed = applyFixes(rows, DEFAULT_FIXES, { ctx: 4096, nearThreshold: 0.8 }).rows
  const r = analyze(fixed)
  const s = summarise(r)
  assert.equal(s.leaks, 0)
  assert.equal(s.exactDupes, 0)
  assert.equal(r.errorRows, 0)
  assert.equal(s.pii, 0)
  assert.equal(s.overCtx, 0)
  assert.ok(s.rows > 1150)
})

test('the DPO sample shows identical pairs, a missing side and length bias', () => {
  const { rows } = load(supportDpo())
  const r = analyze(rows)
  assert.equal(r.dpo!.pairs, 160)
  assert.equal(r.dpo!.identical, 5)
  assert.ok(r.dpo!.biased)
  assert.equal(r.counts.dpo_missing, 1)
  assert.equal(sampleFiles('support-dpo').length, 1)
})

test('cost scales with epochs and price and only counts train rows', () => {
  const rows = [chat('a b c', 'd e f', { split: 'train' }), chat('x', 'y', { split: 'eval' })]
  const one = analyze(rows, { ...DEFAULT_OPTIONS, epochs: 1, pricePerM: 1 })
  const three = analyze(rows, { ...DEFAULT_OPTIONS, epochs: 3, pricePerM: 2 })
  assert.equal(one.cost.billed, rowTokens(rows[0]).total)
  assert.equal(three.cost.usd, one.cost.usd * 6)
})

test('version diff counts added, removed and kept rows', () => {
  const sum = summarise(analyze([chat('a', 'b')]))
  const v = (keys: string[]): Version => ({ id: 'x', label: 'x', at: 0, note: '', summary: sum, keys })
  assert.deepEqual((({ added, removed, kept }) => ({ added, removed, kept }))(diffVersions(v(['a', 'b', 'b', 'c']), v(['b', 'c', 'd']))), { added: 1, removed: 2, kept: 2 })
})
