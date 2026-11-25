import { chat, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#14 a refusal typed with a curly apostrophe is found', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(chat(['user', 'Please help me'], ['assistant', 'I can’t help with that.'])))
  await tab(page, 'Content')
  await expect(page.getByText('1 rows (100.0%) teach the model to refuse.')).toBeVisible()
})
