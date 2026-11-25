import { exported, importFile, jsonl, newDataset, records, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#9 normalising roles keeps per-turn weights and function calls', async ({ page }) => {
  const turns = [{ role: 'user', content: 'Where is it?' }, { role: 'assistant', content: 'No idea.', weight: 0 }, { role: 'assistant', content: 'It is at the depot.', weight: 1 }]
  const call = [{ role: 'user', content: 'Find it' }, { role: 'assistant', content: 'Looking.' }, { role: 'assistant', content: '', function_call: { name: 'find', arguments: '{}' } }]
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(JSON.stringify({ messages: turns }), JSON.stringify({ messages: call })))
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await expect(page.getByText(/^Applied fixes/)).toBeVisible()
  const out = records((await exported(page, 'train')).text)
  expect(out[0].messages.at(-1)).toEqual(turns[2])
  expect(out[1].messages.at(-1).function_call).toEqual(call[2].function_call)
})
