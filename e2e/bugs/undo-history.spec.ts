import { chat, importFile, jsonl, kpi, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

const DATA = jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello']), chat(['user', 'hello out there'], ['assistant', 'hello']))
test.fail('#10 undoing a fix-up keeps the fixed version in History', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', DATA)
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await page.locator('.toast').getByRole('button', { name: /undo/i }).click()
  await expect(page.locator('.proj-head')).toContainText('undo fixes')
  await tab(page, 'History')
  await expect(page.locator('.versions li b')).toHaveText(['v3 · undo fixes', 'v2 · fixed', 'v1 · import'])
})

test.fail('#10 undoing a restore puts the rows back on screen', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', DATA)
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await tab(page, 'History')
  await page.locator('.versions li').last().getByRole('button', { name: 'Restore' }).click()
  await page.locator('.toast', { hasText: 'Restored' }).getByRole('button', { name: /undo/i }).click()
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows').locator('b')).toHaveText('1')
})
