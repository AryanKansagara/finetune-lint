import type { Page } from '@playwright/test'
import { chat, choose, jsonl, kpi, newDataset, panel, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#11 importing the first of two dropped files keeps the second one waiting', async ({ page }) => {
  await newDataset(page)
  await choose(page, 'a-train.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
  await choose(page, 'a-eval.jsonl', jsonl(chat(['user', 'Other words here'], ['assistant', 'Bye'])))
  await panel(page, 'a-train.jsonl').getByRole('button', { name: 'Import and lint' }).click()
  await expect(page.getByText('Imported 1 rows')).toBeVisible()
  await expect(panel(page, 'a-eval.jsonl').getByRole('button', { name: 'Add to dataset' })).toBeVisible()
})

const two = async (page: Page) => {
  await choose(page, 'a-train.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
  await choose(page, 'a-eval.jsonl', jsonl(chat(['user', 'Other words here'], ['assistant', 'Bye'])))
}

test('#11 the waiting file can be added afterwards, also from the overview address', async ({ page }) => {
  await newDataset(page)
  await tab(page, 'Overview')
  await two(page)
  await panel(page, 'a-train.jsonl').getByRole('button', { name: 'Import and lint' }).click()
  await panel(page, 'a-eval.jsonl').getByRole('button', { name: 'Add to dataset' }).click()
  await expect(panel(page, 'a-eval.jsonl')).toHaveCount(0)
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows')).toContainText('1 train · 1 eval')
})

test('#11 two quick clicks import both files', async ({ page }) => {
  await newDataset(page)
  await two(page)
  await page.evaluate(() => { for (const b of document.querySelectorAll<HTMLButtonElement>('button')) if (b.textContent === 'Import and lint') b.click() })
  await expect(kpi(page, 'Rows')).toContainText('1 train · 1 eval')
  await expect(page.locator('.proj-head')).toContainText('a-train.jsonl, a-eval.jsonl')
  await tab(page, 'History')
  await expect(page.locator('.versions li b')).toHaveText(['v2 · import', 'v1 · import'])
})

test('#11 importing into a sample takes the waiting file along to the new dataset', async ({ page }) => {
  await page.goto('/app?sample=support-dpo')
  await expect(page.locator('.kpis')).toBeVisible()
  await tab(page, 'Import & settings')
  await two(page)
  await panel(page, 'a-train.jsonl').getByRole('button', { name: 'Add to dataset' }).click()
  await expect(panel(page, 'a-train.jsonl')).toHaveCount(0)
  await panel(page, 'a-eval.jsonl').getByRole('button', { name: 'Add to dataset' }).click()
  await expect(page.getByText('Imported 1 rows')).toBeVisible()
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows')).toContainText('1 train · 1 eval')
})
