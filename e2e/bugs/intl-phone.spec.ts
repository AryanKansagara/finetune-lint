import { beforeAfter, chat, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#21 international phone numbers are found however they are grouped', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(...['+14155550137', '+33 6 12 34 56 78', '+91 98765 43210'].map((n, i) => chat(['user', `Ring ${n}`], ['assistant', ['Will do', 'Okay then', 'Sure thing'][i]]))))
  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows with PII')).toEqual(['3', '0'])
})
