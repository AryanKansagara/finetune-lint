import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeSplit } from './fixes.ts'
import type { Row } from './types.ts'

const W = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango'.split(' ')
/** Rows with nothing in common, in classes of the given sizes. */
const classes = (sizes: number[]): Row[] => sizes.flatMap((n, c) => Array.from({ length: n }, (_, i) => c * 1000 + i).map((k): Row => ({ line: k, format: 'openai', label: `c${c}`, messages: [{ role: 'user', content: `${W[k % 20]} ${k} ${W[(k * 7) % 19]} number ${k * 31}` }, { role: 'assistant', content: `${k * 17} ${W[(k * 3) % 17]} reply ${k}` }] })))
const run = (rows: Row[], evalFraction: number, seed = 1) => makeSplit(rows, { evalFraction, seed, nearThreshold: 0.8, labels: rows.map(r => r.label ?? null) })
const evals = (rows: Row[]) => rows.filter(r => r.split === 'eval')

test('the eval total is the requested share however small the classes are', () => {
  for (const sizes of [Array(10).fill(4), Array(40).fill(1), Array(7).fill(3), [100, 4, 4, 4], [1, 2, 3, 4, 5, 6], Array(30).fill(2), [57, 13, 9, 1]])
    for (const f of [0.02, 0.07, 0.1, 0.15, 0.29, 0.3]) for (const seed of [1, 2, 3]) {
      const rows = classes(sizes), s = run(rows, f, seed)
      assert.equal(evals(s).length, Math.round(rows.length * f), `${sizes} ${f}`)
      assert.deepEqual(s, run(rows, f, seed))
    }
})

test('each class gets its share to within one row, and no class is emptied while another can give', () => {
  for (const f of [0.1, 0.2, 0.3]) {
    const sizes = [60, 30, 12, 9, 5, 3, 1], s = run(classes(sizes), f)
    sizes.forEach((n, c) => {
      const got = evals(s).filter(r => r.label === `c${c}`).length
      assert.ok(Math.abs(got - n * f) < 1, `class ${c}: ${got} of ${n}`)
      assert.ok(got < n)
    })
  }
})

test('clusters that do not fit a class quota are made up from other classes', () => {
  const one = classes(Array(10).fill(4))
  // Class 0 is one block of rows sharing a prompt; it can only move as a whole.
  const rows = one.map(r => r.label === 'c0' ? { ...r, messages: [{ role: 'user', content: 'the one shared prompt here' }, r.messages[1]] } : r)
  const s = run(rows, 0.2)
  assert.equal(evals(s).length, 8)
  assert.ok([0, 4].includes(evals(s).filter(r => r.label === 'c0').length))
})

test('data that cannot give the share exactly gives at most one row more', () => {
  const pairs = classes(Array(10).fill(2)).map((r, i) => ({ ...r, messages: [{ role: 'user', content: `shared prompt of pair number ${i >> 1}` }, r.messages[1]] }))
  assert.equal(evals(run(pairs, 0.15)).length, 4)
  assert.equal(evals(run(pairs, 0.1)).length, 2)
})
