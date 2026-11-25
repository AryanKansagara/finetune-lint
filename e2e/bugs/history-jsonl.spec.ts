import { addFile, chat, formatSelect, importFile, jsonl, newDataset, records, saved, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#17 a version exported from History does not mix eval rows into train', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a-train.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
  await addFile(page, 'a-eval.jsonl', jsonl(chat(['user', 'Held out question'], ['assistant', 'Held out answer'])))
  await tab(page, 'History')
  const f = await saved(page, () => page.locator('.versions li').first().getByRole('button', { name: /JSONL/ }).first().click())
  expect(records(f.text)).toHaveLength(1)
  expect(f.name).toMatch(/-v2-train\.jsonl$/)
  expect(records(f.text)[0].messages[0].content).toBe('Hello out there')
  const e = await saved(page, () => page.locator('.versions li').first().getByRole('button', { name: 'Eval JSONL' }).click())
  expect(e.name).toMatch(/-v2-eval\.jsonl$/)
  expect(records(e.text).map(r => r.messages[0].content)).toEqual(['Held out question'])
  // v1 has no eval rows, so there is no eval file to save.
  await expect(page.locator('.versions li').last().getByRole('button', { name: /JSONL/ })).toHaveText(['Train JSONL'])
})

test('#17 rows a version cannot write in the chosen format are counted', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello']), chat(['user', 'A first'], ['assistant', 'B'], ['user', 'C then'], ['assistant', 'D'])))
  await tab(page, 'Fix & export')
  await formatSelect(page).selectOption('alpaca')
  await tab(page, 'History')
  const f = await saved(page, () => page.getByRole('button', { name: 'Train JSONL' }).click())
  expect(records(f.text)).toHaveLength(1)
  await expect(page.locator('.toast.error')).toContainText('1 train rows written; 1 cannot be written in this format (multi-turn conversations do not fit Alpaca).')
  await tab(page, 'Fix & export')
  await formatSelect(page).selectOption('trl-dpo')
  await tab(page, 'History')
  await page.getByRole('button', { name: 'Train JSONL' }).click()
  await expect(page.locator('.toast.error').last()).toContainText('Nothing written: 2 cannot be written')
})
