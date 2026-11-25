import { beforeAfter, chat, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#22 prefixed and quoted key assignments count as secrets', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(
    chat(['user', 'export SHOP_API_KEY=abcd1234abcd1234'], ['assistant', 'Noted then']),
    chat(['user', 'config {"api_key": "abcd1234abcd1234"}'], ['assistant', 'Got this one']),
  ))
  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows with PII')).toEqual(['2', '0'])
})
