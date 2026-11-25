import { chat, importFile, jsonl, kpi, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#13 words that differ only in Hindi vowel signs are not exact copies', async ({ page }) => {
  // दिन "day" and दीन "poor".
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(chat(['user', 'दिन'], ['assistant', 'ठीक है']), chat(['user', 'दीन'], ['assistant', 'ठीक है'])))
  await tab(page, 'Duplicates & leaks')
  await expect(kpi(page, 'Exact copies').locator('b')).toHaveText('0')
})
