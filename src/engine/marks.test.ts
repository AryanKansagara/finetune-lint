import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicates, normText } from './dedupe.ts'

const same = (a: string, b: string) => findDuplicates([a, b]).exact.length === 1

test('words that differ in a vowel sign or tone mark are different texts', () => {
  for (const [a, b] of [['दिन', 'दीन'], ['कल', 'काल'], ['ใกล้', 'ใกล'], ['ที่', 'ที'], ['பல', 'பால்'], ['কাল', 'কুল'], ['كَتَبَ', 'كُتِبَ']]) assert.ok(!same(`user: ${a}`, `user: ${b}`), `${a} ${b}`)
})

test('marks stay with their letter', () => {
  assert.equal(normText('ठीक है!'), 'ठीक है')
  assert.equal(normText('कितना?'), 'कितना')
  assert.ok(same('ठीक है।', 'ठीक  है'))
})

test('Latin text, emoji and stray marks give the same key as before', () => {
  for (const [s, want] of [['Café!', 'café'], ['Café', 'café'], ['x̂y', 'x y'], ['İstanbul', 'i stanbul'], ['I ❤️ it', 'i it'], ['1️⃣ first', '1 first'], ['ok️', 'ok'], ['́ a', 'a'], ['naïve, co-op', 'naïve co op'], ['祝️', '祝']]) assert.equal(normText(s), want)
})

test('long texts are normalised in linear time', () => {
  const t = Date.now()
  for (const s of ['कि'.repeat(100_000), 'a' + '̂'.repeat(100_000), 'क' + 'ि'.repeat(30_000)]) normText(s)
  assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`)
})
