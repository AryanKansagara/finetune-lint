import { exported, importFile, jsonl, newDataset, records, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#15 label fields come back out under their own name and type', async ({ page }) => {
  const rows = [{ prompt: 'One', completion: 'a', label: true }, { prompt: 'Two', completion: 'b', label: 1 }, { prompt: 'Three', completion: 'c', intent: 'x' }, { prompt: 'Four', completion: 'd', label: 'p', category: 'q' }]
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(...rows.map(r => JSON.stringify(r))))
  await tab(page, 'Fix & export')
  const out = records((await exported(page, 'train')).text)
  expect(out.map(({ messages: _, ...rest }) => rest)).toEqual(rows.map(({ prompt: _p, completion: _c, ...rest }) => rest))
})
