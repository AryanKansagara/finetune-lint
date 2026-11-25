import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, scanPii } from './content.ts'

test('a + and 10 to 15 digits is a phone number in any usual grouping', () => {
  for (const n of ['+14155550137', '+1 415 555 0137', '+1 (415) 555-0137', '+1.415.555.0137', '+33 6 12 34 56 78', '+33612345678', '+91 98765 43210', '+44 (0)20 7946 0958', '+44 7700 900123', '+43 664 123 45 67', '+49 1512 345 67 89', '+55 11 98765-4321', '+55 11 98765 4321', '+5511987654321', '+7 912 345-67-89', '+86 138 1234 5678', '+380 (67) 123 45 67', '+33 6 12 34 56 78'])
    assert.deepEqual(scanPii(`Ring ${n}, please`).map(h => [h.type, h.value]), [['phone', n]], n)
})

test('only the number is masked', () => {
  assert.equal(redact('+14155550138 12 times').text, '[PHONE] 12 times')
  assert.equal(redact('+1 415 555 0137 2 times').text, '[PHONE] 2 times')
  assert.equal(redact('+44 20 7946 0958 3 times').text, '[PHONE] 3 times')
  assert.equal(redact('+33 6 12 34 56 78, +33 6 12 34 56 79.').text, '[PHONE], [PHONE].')
})

test('dates, order numbers, sums and decimals are not phone numbers', () => {
  for (const t of ['2024-11-03 10:20:30', 'Order 1234567890', 'GMT +2 2024-11-03 12:30', 'at +2 03.11.2024 12:30', '+3.14159265358979', '+0.1234567890', '1+1234567890', '2 + 1234567890', '+123 456 789', '+1234567890123456', 'id #20241103123456'])
    assert.deepEqual(scanPii(t), [], t)
})

test('a card after a + stays fully masked', () => {
  for (const t of ['+4111111111111111', '+49 4111 1111 1111 1111', '+1 4111 1111 1111 1111']) assert.ok(!/\d{3}/.test(redact(t).text), redact(t).text)
})

test('long runs are scanned in linear time', () => {
  const t = Date.now()
  for (const s of ['+12 '.repeat(50_000), '+' + '1'.repeat(100_000)]) scanPii(s)
  assert.ok(Date.now() - t < 4000, `${Date.now() - t} ms`)
})
