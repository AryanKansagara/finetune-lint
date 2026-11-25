import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estJaccard, findDuplicates, groups, minhash, shingles } from './dedupe.ts'

const base = 'please update my shipping address on the order I placed last week because I moved to a new flat and the old one is wrong thanks a lot for your quick help with this matter today'
const many = (n: number, text = base) => Array.from({ length: n }, (_, i) => `${text} ref${i}`)

test('one large family of similar rows is one group', () => {
  for (const n of [401, 500, 5000]) {
    const t = Date.now()
    assert.deepEqual(findDuplicates(many(n)).near.map(g => g.length), [n])
    assert.ok(Date.now() - t < 20_000)
  }
})

test('large families stay apart and unrelated rows stay out', () => {
  const other = 'the blue tent we bought in spring has a torn pole sleeve after one night outside and I would like to know whether the warranty covers a repair or a full replacement'
  const texts = [...many(450), ...many(450, other), 'nothing like the rest of them at all']
  assert.deepEqual(findDuplicates(texts).near.map(g => g.length), [450, 450])
})

test('every pair reported is at or above the threshold', () => {
  const texts = many(600, 'a short base text of nine words for this')
  const sigs = texts.map(t => minhash(shingles(t)))
  for (const p of findDuplicates(texts, 0.6).pairs) { assert.ok(p.a < p.b); assert.equal(p.sim, estJaccard(sigs[p.a], sigs[p.b])); assert.ok(p.sim >= 0.6) }
})

test('pairs planted in a large templated bucket are found', () => {
  // 600 rows share half their words (below the threshold); 30 of them have a close copy.
  const w = (i: number, k: number) => `w${(i * 31 + k * 17) % 9973}x${i}`
  const row = (i: number, tail = 'end') => `${base} ${Array.from({ length: 22 }, (_, k) => w(i, k)).join(' ')} ${tail}`
  const texts = [...Array.from({ length: 600 }, (_, i) => row(i)), ...Array.from({ length: 30 }, (_, i) => row(i, 'finish'))]
  const d = findDuplicates(texts)
  const found = Array.from({ length: 30 }, (_, i) => i).filter(i => d.near.some(g => g.includes(i) && g.includes(600 + i)))
  assert.ok(found.length >= 29, `${found.length} of 30`)
  assert.equal(groups(texts.length, d.pairs.map(p => [p.a, p.b])).filter(g => g.length > 2).length, 0)
})
