import { choose, chat, importFile, jsonl, kpi, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#8 a row with an image part is reported instead of losing the image', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'a.jsonl', jsonl(JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'https://example.com/x.png' } }] }, { role: 'assistant', content: 'A cat.' }] })))
  await expect(p.locator('.issues')).toContainText(/image/i)
})

test('#8 rows with image or audio parts are not exported as text and the fixes drop them', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(
    JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: 'What is said here?' }, { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }, { role: 'assistant', content: 'Hello.' }] }),
    chat(['user', 'Hello out there'], ['assistant', 'Hello']),
  ))
  await tab(page, 'Fix & export')
  await expect(page.getByRole('button', { name: 'Download train.jsonl (1)' })).toBeEnabled()
  await expect(page.getByText(/^1 rows cannot be written in this format/)).toBeVisible()
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await expect(page.getByText(/^Applied fixes/)).toBeVisible()
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows').locator('b')).toHaveText('1')
})
