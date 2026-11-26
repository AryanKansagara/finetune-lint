import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, scanPii } from './content.ts'

const cards = (t: string) => scanPii(t).filter(h => h.type === 'card').map(h => h.value)

test('a card next to an expiry, CVV, quantity or order number is found and only it is masked', () => {
  const c = '4111 1111 1111 1111'
  for (const t of [`${c} 12/27`, `${c} 123`, `${c} 12 27`, `2 ${c}`, `12 ${c} 1227`, `1234 5678 90 ${c}`, `${c}-12`]) assert.deepEqual(cards(t), [c], t)
  assert.equal(redact('Charge 4111 1111 1111 1111 12/27 now').text, 'Charge [CARD] 12/27 now')
  assert.deepEqual(cards('Order 2 4111111111111111 again'), ['4111111111111111'])
  // Amex test number 378282246310005, written 4-6-5, with its 4-digit code.
  assert.deepEqual(cards('3782 822463 10005 1234'), ['3782 822463 10005'])
  // Two cards back to back can read as one; neither may leave digits behind.
  assert.ok(!/\d/.test(redact('5555-5555-5555-4444 4111-1111-1111-1111').text))
})

test('numbers that are not cards stay as they were', () => {
  for (const t of ['1234 5678 9012 3456', '4111 1111 1111 1112 12/27', '41111111111111111234', '10 20 30 40 50 60 70 80', '0000 1111']) assert.deepEqual(cards(t), [], t)
  assert.deepEqual(scanPii('Order 1234 5678 9012 3456 12/27').map(h => h.type), [])
})

test('long digit runs are scanned in linear time', () => {
  const t = Date.now()
  scanPii('1234 '.repeat(20_000))
  assert.ok(Date.now() - t < 2000)
})

test('an SSN in front of a card keeps its own mask, and overlapping readings cover the whole card', () => {
  assert.equal(redact('219-09-9999 4111 1111 1111 1111').text, '[SSN] [CARD]')
  // 9999 4111 1111 1111 also passes Luhn; masking only that would leave the last four digits of the card.
  assert.equal(redact('9999 4111 1111 1111 1111 12/27').text, '[CARD] 12/27')
})
