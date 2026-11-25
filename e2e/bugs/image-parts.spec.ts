import { choose, jsonl, newDataset } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#8 a row with an image part is reported instead of losing the image', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'a.jsonl', jsonl(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'https://example.com/x.png' } }] }, { role: 'assistant', content: 'A cat.' }] })))
  await expect(p.locator('.issues')).toContainText(/image/i)
})
