import { chat, importFile, jsonl, kpi, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#5 500 near copies of one row are found', async ({ page }) => {
  // Each row is the same 33-word request with a different last word: 2 x 1 differing shingle in about 34.
  const ask = 'please update my shipping address on the order I placed last week because I moved to a new flat and the old one is wrong thanks a lot for your quick help'
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(...Array.from({ length: 500 }, (_, i) => chat(['user', `${ask} today`], ['assistant', `Done and saved under reference ${i}`]))))
  await tab(page, 'Duplicates & leaks')
  await expect(kpi(page, 'Near duplicates').locator('b')).toHaveText('499')
})
