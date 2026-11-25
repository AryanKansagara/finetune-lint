import { addFile, chat, importFile, jsonl, newDataset, records, saved, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#17 a version exported from History does not mix eval rows into train', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a-train.jsonl', jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
  await addFile(page, 'a-eval.jsonl', jsonl(chat(['user', 'Held out question'], ['assistant', 'Held out answer'])))
  await tab(page, 'History')
  const f = await saved(page, () => page.locator('.versions li').first().getByRole('button', { name: /JSONL/ }).first().click())
  expect(records(f.text)).toHaveLength(1)
})
