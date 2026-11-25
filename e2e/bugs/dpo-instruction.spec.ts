import { exported, importFile, jsonl, newDataset, records, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#4 the instruction of an Alpaca preference row is part of the prompt', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(
    JSON.stringify({ instruction: 'Summarise this.', input: 'The shop is shut.', chosen: 'Shut.', rejected: 'Open.' }),
    JSON.stringify({ instruction: 'Name a colour.', input: '', chosen: 'Red.', rejected: 'Seven.' }),
  ))
  await tab(page, 'Fix & export')
  const out = records((await exported(page, 'train')).text)
  expect(out.map(r => r.input.messages)).toEqual([[{ role: 'user', content: 'Summarise this.\n\nThe shop is shut.' }], [{ role: 'user', content: 'Name a colour.' }]])
})

test.fail('#4 a CSV input column is appended to the user turn of a preference row', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.csv', 'prompt,input,chosen,rejected\nSummarise this.,The shop is shut.,Shut.,Open.\n')
  await tab(page, 'Fix & export')
  expect(records((await exported(page, 'train')).text)[0].input.messages).toEqual([{ role: 'user', content: 'Summarise this.\n\nThe shop is shut.' }])
})
