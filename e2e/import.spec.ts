import { addFile, chat, choose, importFile, jsonl, kpi, newDataset, panel, tab } from './helpers.ts'
import { expect, test } from './fixtures.ts'

const FORMATS: [name: string, file: string, text: string, chip: string][] = [
  ['OpenAI chat JSONL', 'a.jsonl', jsonl(chat(['user', 'Hi there'], ['assistant', 'Hello']), chat(['user', 'Bye now'], ['assistant', 'Goodbye'])), 'OpenAI chat (messages) 2'],
  ['ShareGPT JSONL', 'a.jsonl', jsonl(...[1, 2].map(i => JSON.stringify({ conversations: [{ from: 'human', value: `Hi ${i}` }, { from: 'gpt', value: `Hello ${i}` }] }))), 'ShareGPT (conversations) 2'],
  ['Alpaca JSON array', 'a.json', JSON.stringify([1, 2].map(i => ({ instruction: `Do ${i}`, input: '', output: `Done ${i}` })), null, 2), 'Alpaca (instruction / input / output) 2'],
  ['DPO JSONL with CRLF and a BOM', 'a.jsonl', '﻿' + [1, 2].map(i => JSON.stringify({ prompt: `Q ${i}`, chosen: 'yes', rejected: 'no' })).join('\r\n') + '\r\n', 'Preference (prompt / chosen / rejected) 2'],
  ['OpenAI preference JSONL', 'a.jsonl', jsonl(...[1, 2].map(i => JSON.stringify({ input: { messages: [{ role: 'user', content: `Q ${i}` }] }, preferred_output: [{ role: 'assistant', content: 'y' }], non_preferred_output: [{ role: 'assistant', content: 'n' }] }))), 'Preference (prompt / chosen / rejected) 2'],
  ['CSV', 'a.csv', 'instruction,output\r\n"Say ""hi"", twice","Hi\r\nhi"\r\nAsk,Answer\r\n', 'Alpaca (instruction / input / output) 2'],
  ['TSV', 'a.tsv', 'prompt\tresponse\nAsk\tAnswer\nAsk more\tAnswer, more\n', 'Alpaca (instruction / input / output) 2'],
]
for (const [name, file, text, chip] of FORMATS) {
  test(`reads ${name}`, async ({ page }) => {
    await newDataset(page)
    const p = await choose(page, file, text)
    await expect(p.locator('.chip')).toHaveText(chip)
    await expect(p.getByText('no structural problems')).toBeVisible()
    await p.getByRole('button', { name: 'Import and lint' }).click()
    await expect(kpi(page, 'Rows').locator('b')).toHaveText('2')
  })
}

test('CSV columns can be mapped by hand', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'odd.csv', 'ask_col,reply_col\nWhere?,Here.\n')
  await expect(p.getByText('No recognisable rows')).toBeVisible()
  await p.getByLabel('ask_col').selectOption('user')
  await p.getByLabel('reply_col').selectOption('assistant')
  await expect(p.locator('.chip')).toHaveText('Alpaca (instruction / input / output) 1')
})

test('truncated JSONL names the bad line and keeps the good one', async ({ page }) => {
  await newDataset(page)
  const good = chat(['user', 'Hi there'], ['assistant', 'Hello'])
  const p = await choose(page, 'cut.jsonl', good + '\n' + good.slice(0, 40))
  await expect(p).toContainText('1 rows read · 1 lines unreadable')
  await expect(p.locator('.issues .error-row')).toContainText('line 2')
  await expect(p.locator('.issues .error-row')).toContainText('Not valid JSON')
})

test('a truncated JSON array is reported, not imported as clean', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'cut.json', JSON.stringify([{ instruction: 'a', output: 'b' }, { instruction: 'c', output: 'd' }]).slice(0, -9))
  await expect(p.getByText('No recognisable rows')).toBeVisible()
  await expect(p.locator('.error-row')).toContainText('Not valid JSON')
})

test('a file of another kind gives an error on every record', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'notes.txt', 'Dear all,\nthis is not a dataset\n')
  await expect(p.getByText('No recognisable rows')).toBeVisible()
  await expect(p.locator('.error-row').first()).toContainText('Expected messages, conversations')
})

test('empty and Parquet files are refused with a reason', async ({ page }) => {
  await newDataset(page)
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'empty.jsonl', mimeType: 'text/plain', buffer: Buffer.from(' \n') })
  await expect(page.getByText('empty.jsonl is empty.')).toBeVisible()
  await input.setInputFiles({ name: 'd.parquet', mimeType: 'application/octet-stream', buffer: Buffer.from('PAR1') })
  await expect(page.getByText(/Parquet is not read in the browser/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import and lint' })).toHaveCount(0)
})

test('structural checks point at the line and turn', async ({ page }) => {
  await newDataset(page)
  const p = await choose(page, 'bad.jsonl', jsonl(
    chat(['Human', 'Hi'], ['assistant', 'Hello']),
    chat(['user', 'Hi'], ['assistant', '  ']),
    chat(['user', 'Hi']),
    JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: { a: 1 } } }] }, { role: 'tool', tool_call_id: 'zz', content: 'r' }, { role: 'assistant', content: 'ok' }] }),
    JSON.stringify({ messages: [] }),
    JSON.stringify({ prompt: 'Q', chosen: 'y' }),
  ))
  for (const t of ['Turn 1 has role "Human"', 'Turn 2 (assistant) is empty', 'Ends on a user turn', 'function.arguments must be a JSON-encoded string', 'answers tool_call_id "zz"', 'The conversation has no turns', 'The rejected response is missing or empty']) {
    await expect(p.locator('.issues')).toContainText(t)
  }
})

test('HTML in the data is shown as text', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'x.jsonl', jsonl(chat(['user', '<img src=x onerror="window.__pwned=1">mail a@example.com'], ['assistant', '<script>window.__pwned=1</script>ok'])))
  await tab(page, 'Issues')
  await page.getByRole('button', { name: 'View' }).first().click()
  await expect(page.locator('dialog[open]')).toContainText('<img src=x onerror=')
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
})

test('replace asks first and leaves the old rows in History', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'one.jsonl', jsonl(chat(['user', 'First row here'], ['assistant', 'Hello'])))
  await addFile(page, 'two.jsonl', jsonl(chat(['user', 'Second row here'], ['assistant', 'Hello'])))
  const p = await choose(page, 'three.jsonl', jsonl(chat(['user', 'Third row here'], ['assistant', 'Hello'])))
  await p.getByRole('button', { name: 'Replace dataset' }).click()
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(p).toHaveCount(0)
  await expect(panel(page, 'Files in this dataset').locator('tbody tr')).toHaveCount(1)
  await tab(page, 'History')
  await expect(page.locator('.versions li')).toHaveCount(3)
  await page.locator('.versions li').nth(1).getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Restored v2 · import', { exact: true }).first()).toBeVisible()
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows').locator('b')).toHaveText('2')
})
