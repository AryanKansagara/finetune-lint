import { chat, choose, jsonl, newDataset } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

for (const name of ['retrieval-train.jsonl', 'latest.jsonl', 'customer-approval.jsonl']) {
  test.fail(`#16 ${name} is not guessed to be evaluation data`, async ({ page }) => {
    await newDataset(page)
    const p = await choose(page, name, jsonl(chat(['user', 'Hello out there'], ['assistant', 'Hello'])))
    await expect(p.getByLabel('Split for this file')).toHaveValue('train')
  })
}
