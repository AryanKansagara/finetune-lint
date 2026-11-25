import { beforeAfter, chat, exported, fixToggle, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#2 personal data in system prompts is counted', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(chat(['system', 'Escalate to jane@example.com.'], ['user', 'Hi there'], ['assistant', 'Hello'])))
  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows with PII')).toEqual(['1', '0'])
})

test('#2 stripping masks tool-call and function-call arguments and kept fields too', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(
    JSON.stringify({ note: 'from bob@example.com', messages: [{ role: 'user', content: 'Look me up' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find', arguments: '{"email":"jane@example.com"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'ok' }, { role: 'assistant', content: 'Found it' }] }),
    JSON.stringify({ messages: [{ role: 'user', content: 'And the other one' }, { role: 'assistant', content: null, function_call: { name: 'find', arguments: '{"email":"omar@example.com"}' } }] }),
  ))
  await tab(page, 'Fix & export')
  await expect(fixToggle(page, 'Strip personal data')).toContainText('3 values replaced')
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await expect(page.getByText('Applied fixes: 2 rows remain')).toBeVisible()
  const { text } = await exported(page, 'train')
  expect(text).not.toContain('@example.com')
  expect(text.match(/\[EMAIL\]/g)).toHaveLength(3)
})
