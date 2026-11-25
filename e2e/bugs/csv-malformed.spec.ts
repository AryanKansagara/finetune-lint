import { choose, newDataset } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#7 a CSV quote that never closes is reported', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'a.csv', 'instruction,output\nFirst,One\n"Second,Two\nThird,Three\n')
  await expect(p.locator('.error-row')).toContainText('line 3')
  await expect(p.locator('.error-row')).toContainText(/quote/i)
})

test('#7 a CSV record with more fields than the header is reported, not cut', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'a.csv', 'instruction,output\nFirst,One\nSay hi,Hello, and welcome\n')
  await expect(p).toContainText('1 rows read · 1 lines unreadable')
  await expect(p.locator('.error-row')).toContainText('line 3')
})
