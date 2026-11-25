import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact, scanPii } from './content.ts'

// Made-up values only.
const V = 'abcd1234abcd1234'

test('prefixed key assignments are found and masked with their prefix', () => {
  for (const k of ['api_key', 'SHOP_API_KEY', 'MY_SHOP_API_KEY', '__api_key', 'DB_PASSWORD', 'shop_access_token', 'APP_SECRET']) for (const a of [`=${V}`, ` = "${V}"`, `: ${V}`])
    assert.equal(redact(`export ${k}${a}`).text.replace('"', ''), 'export [SECRET]', k + a)
})

test('quoted keys are found, and only the value is masked', () => {
  assert.equal(redact(`{"api_key": "${V}", "n": 1}`).text, '{"api_key": "[SECRET]", "n": 1}')
  assert.equal(redact(`{'SHOP_API_KEY':'${V}'}`).text, "{'SHOP_API_KEY':'[SECRET]'}")
  assert.equal(redact(`{\\"password\\": \\"${V}\\"}`).text, '{\\"password\\": \\"[SECRET]\\"}')
  assert.equal(redact(`os.environ["SHOP_API_KEY"] = "${V}"`).text, 'os.environ["SHOP_API_KEY"] = "[SECRET]"')
  assert.equal(scanPii(`{"api_key": "${V}", "secret": "${V}"}`).length, 2)
})

test('other words and short values are not secrets', () => {
  for (const t of [`monkey = ${V}`, `secretary: ${V}`, `"api_keys": ["${V}"]`, 'api_key: short', '"password": "", "note": "abcdefabcdef"', `nosecret=${V}`, `"key": "${V}"`]) assert.deepEqual(scanPii(t), [], t)
})

test('long runs are scanned in linear time', () => {
  const t = Date.now()
  for (const s of ['a_'.repeat(100_000), 'api_key" '.repeat(20_000), 'a'.repeat(200_000), '"'.repeat(100_000)]) scanPii(s)
  assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`)
})
