import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, DEFAULT_OPTIONS } from './analyze.ts'
import { makeSplit, rng } from './fixes.ts'
import type { Row } from './types.ts'

const WORDS = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo'.split(' ')
const chat = (u: string, a: string): Row => ({ line: 1, format: 'openai', messages: [{ role: 'user', content: u }, { role: 'assistant', content: a }] })
const words = (r: () => number, n: number) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ')
const split = (rows: Row[], seed = 1, nearThreshold = 0.8) => makeSplit(rows, { evalFraction: 0.2, seed, nearThreshold })
const leaks = (rows: Row[], nearThreshold = 0.8) => analyze(rows, { ...DEFAULT_OPTIONS, nearThreshold }).leaks.length

test('two answers to one prompt stay on one side', () => {
  const r = rng(5)
  const rows = Array.from({ length: 60 }, (_, i) => chat(`How do I reset question number ${Math.floor(i / 2)}?`, words(r, 12)))
  for (let seed = 1; seed <= 10; seed++) {
    const s = split(rows, seed)
    for (let i = 0; i < 60; i += 2) assert.equal(s[i].split, s[i + 1].split)
    assert.equal(leaks(s), 0)
    assert.equal(s.filter(x => x.split === 'eval').length > 6, true)
    assert.deepEqual(s, split(rows, seed))
  }
})

test('a fresh split has no leak at any threshold, for chat rows and preference pairs', () => {
  const r = rng(9)
  const pairs = Array.from({ length: 80 }, (_, i): Row => ({ line: i, format: 'dpo', messages: [{ role: 'user', content: `Pick for case ${i % 30} now` }], chosen: [{ role: 'assistant', content: words(r, 6) }], rejected: [{ role: 'assistant', content: words(r, 6) }] }))
  const noisy = Array.from({ length: 200 }, (_, i) => chat(words(rng(i % 25), 14) + ' ' + words(r, 2), words(rng(i % 25 + 99), 10)))
  for (const rows of [pairs, noisy]) for (const th of [0.5, 0.7, 0.9]) for (let seed = 1; seed <= 4; seed++) assert.equal(leaks(split(rows, seed, th), th), 0)
})

test('empty, single and all-identical data do not fail', () => {
  assert.deepEqual(split([]), [])
  assert.equal(split([chat('a', 'b')]).length, 1)
  assert.equal(leaks(split(Array.from({ length: 30 }, () => chat('the same long question here', 'same')))), 0)
})
