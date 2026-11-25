import { beforeAfter, chat, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#3 a card number followed by an expiry date or preceded by a digit is found', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(
    chat(['user', 'Charge 4111 1111 1111 1111 12/27 now'], ['assistant', 'Okay then']),
    chat(['user', 'Order 2 4111111111111111 again'], ['assistant', 'Sure thing']),
  ))
  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows with PII')).toEqual(['2', '0'])
})
