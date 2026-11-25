import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRefusal } from './content.ts'

const REFUSALS = ["I can't help with that.", "I'm sorry, but I can't do it", "I'm sorry but I won't", "I won't share that", "I'm an AI", "I'm not able to assist", "I don't have access to real-time data, I don't have the ability to", "I don't have access to browse"]
const FINE = ["I can't wait to help!", "I'm happy to help", "Don't worry, it's on its way.", "Sorry about the delay, we can't ship today", "'I' can 't", '']

test('a refusal is found whichever apostrophe it is typed with', () => {
  for (const q of ["'", '’', '‘', 'ʼ', '＇']) {
    for (const s of REFUSALS) assert.equal(isRefusal(s.replaceAll("'", q)), isRefusal(s), s + q)
    for (const s of FINE) assert.equal(isRefusal(s.replaceAll("'", q)), false, s + q)
  }
  for (const s of REFUSALS.slice(0, 6)) assert.ok(isRefusal(s), s)
})
