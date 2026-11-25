import { chat, importFile, jsonl, newDataset, saved, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#19 the issues CSV keeps a file name with a comma in one cell', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a, final.jsonl', jsonl(chat(['Human', 'Hi'], ['assistant', 'Hello'])))
  await tab(page, 'Issues')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  expect(f.text.split('\n')[1]).toMatch(/^"a, final\.jsonl",1,error,bad_role,/)
})
