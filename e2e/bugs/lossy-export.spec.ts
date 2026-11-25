import { formatSelect, importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

const row = JSON.stringify({ messages: [{ role: 'user', content: 'Find it' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find', arguments: '{}' } }] }] })
const called = JSON.stringify({ messages: [{ role: 'user', content: 'Find it' }, { role: 'assistant', content: null, function_call: { name: 'find', arguments: '{}' } }] })
const masked = JSON.stringify({ messages: [{ role: 'user', content: 'Find it' }, { role: 'assistant', content: 'No.', weight: 0 }] })
for (const [target, line, what] of [['alpaca', row, 'tool call'], ['sharegpt', masked, 'zero-weight turn'], ['alpaca', masked, 'zero-weight turn'], ['sharegpt', called, 'function call'], ['alpaca', called, 'function call']] as const) {
  test(`#12 ${target} export skips a ${what} it cannot represent`, async ({ page }) => {
    await newDataset(page)
    await importFile(page, 'a.jsonl', jsonl(line))
    await tab(page, 'Fix & export')
    await formatSelect(page).selectOption(target)
    await expect(page.getByText(/^1 rows cannot be written in this format/)).toBeVisible()
  })
}
