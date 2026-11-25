import { chat, choose, jsonl, newDataset, panel } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#11 importing the first of two dropped files keeps the second one waiting', async ({ page }) => {
  await newDataset(page)
  await choose(page, 'a-train.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
  await choose(page, 'a-eval.jsonl', jsonl(chat(['user', 'Other words here'], ['assistant', 'Bye'])))
  await panel(page, 'a-train.jsonl').getByRole('button', { name: 'Import and lint' }).click()
  await expect(page.getByText('Imported 1 rows')).toBeVisible()
  await expect(panel(page, 'a-eval.jsonl').getByRole('button', { name: 'Add to dataset' })).toBeVisible()
})
