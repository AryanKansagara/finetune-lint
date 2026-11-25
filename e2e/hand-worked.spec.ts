import { addFile, beforeAfter, chat, costCell, exported, importFile, jsonl, kpi, newDataset, records, setPrice, tab } from './helpers.ts'
import { expect, test } from './fixtures.ts'

// Worked on paper from the documented method (docs, "Token estimate" and "Cost and time"), not copied from the app.
// Every word below is at most 8 plain letters, so it is one token; every punctuation mark is one token;
// each turn adds 4 and each row adds 1.
//
//   train:1  "Where is my order?" 5+4, "It shipped today." 4+4            -> 1+9+8    = 18
//   train:2  "where is my order" 4+4, "it shipped today" 3+4              -> 1+8+7    = 16  (copy of train:1)
//   train:3  "Be brief." 3+4, "Can I get a refund?" 6+4, "Yes, you can." 5+4 -> 1+7+10+9 = 27
//   eval:1   "Where is my order?" 5+4, "Check your email please." 5+4     -> 1+9+9    = 19  (same prompt as train:1)
//   eval:2   broken JSON, never a row
//
// All rows 80 tokens. Train 18+16+27 = 61 per epoch, x 3 epochs = 183, at $10,000 per 1M ($0.01 a token) = $1.83.
// After fixes train:2 (copy) and eval:1 (leak) go: 18+27 = 45, x 3 = 135 = $1.35.
export const TRAIN = jsonl(
  chat(['user', 'Where is my order?'], ['assistant', 'It shipped today.']),
  chat(['user', 'where is my order'], ['assistant', 'it shipped today']),
  chat(['system', 'Be brief.'], ['user', 'Can I get a refund?'], ['assistant', 'Yes, you can.']),
)
export const EVAL = jsonl(
  chat(['user', 'Where is my order?'], ['assistant', 'Check your email please.']),
  '{"messages": [{"role": "user", "content": "cut off',
)

test('tokens, duplicates, leaks and cost match the paper numbers, before and after fixes', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'desk-train.jsonl', TRAIN)
  await addFile(page, 'desk-eval.jsonl', EVAL)
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows')).toContainText('3 train · 1 eval · 1 unreadable lines')
  await expect(kpi(page, 'Tokens').locator('b')).toHaveText('80')
  await expect(kpi(page, 'Tokens')).toContainText('max 27')
  // Broken line + leak are errors; the copy is a warning. Two of the four rows are clean.
  await expect(kpi(page, 'Clean rows')).toContainText('50%')
  await expect(kpi(page, 'Clean rows')).toContainText('2 errors')
  await expect(kpi(page, 'Clean rows')).toContainText('1 warnings')
  await setPrice(page, '10000')
  await expect(costCell(page, 'Tokens per epoch')).toContainText('61')
  await expect(costCell(page, 'Tokens per epoch')).toContainText('→ 45')
  await expect(costCell(page, 'Training tokens')).toContainText('183')
  await expect(costCell(page, 'Training tokens')).toContainText('→ 135')
  await expect(costCell(page, 'Estimated cost')).toContainText('$1.83')
  await expect(costCell(page, 'Estimated cost')).toContainText('→ $1.35')

  await tab(page, 'Duplicates & leaks')
  await expect(kpi(page, 'Exact copies').locator('b')).toHaveText('1')
  await expect(kpi(page, 'Near duplicates').locator('b')).toHaveText('0')
  await expect(kpi(page, 'Eval rows leaking').locator('b')).toHaveText('1')
  await expect(page.locator('tr', { hasText: 'exact prompt' })).toContainText('desk-eval.jsonl:1')

  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows')).toEqual(['4', '2'])
  expect(await beforeAfter(page, 'Tokens')).toEqual(['80', '45'])
  expect(await beforeAfter(page, 'Training cost')).toEqual(['$1.83', '$1.35'])
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await expect(page.getByText('Applied fixes: 2 rows remain')).toBeVisible()
  const out = await exported(page, 'train')
  expect(records(out.text)).toEqual([TRAIN.split('\n')[0], TRAIN.split('\n')[2]].map(l => JSON.parse(l)))
})

test('a context of 2048 truncates one long row by the paper amount', async ({ page }) => {
  // 3,000 one-token words + 4, then "Yes." 2+4, plus 1 = 3,011 tokens: 963 past 2,048. Billed 2,048 x 3 = 6,144.
  await newDataset(page)
  await page.getByLabel('Context length (tokens)').selectOption('2048')
  await importFile(page, 'long.jsonl', jsonl(chat(['user', Array(3000).fill('word').join(' ')], ['assistant', 'Yes.'])))
  await expect(kpi(page, 'Tokens').locator('p')).toContainText('median 3,011')
  await setPrice(page, '1000')
  await expect(costCell(page, 'Estimated cost')).toContainText('$6.14')
  await tab(page, 'Issues')
  await expect(page.locator('.issue-table')).toContainText('963 past the 2,048-token context')
})

test('preference pairs bill both sequences', async ({ page }) => {
  // Prompt "Can I get a refund?" 6+4+1 = 11; chosen "Yes, you can." 9; rejected "No." 6. (11+9)+(11+6) = 37, x 3 = 111 tokens = $1.11.
  await newDataset(page)
  await importFile(page, 'pairs.jsonl', jsonl(JSON.stringify({ prompt: 'Can I get a refund?', chosen: 'Yes, you can.', rejected: 'No.' })))
  await setPrice(page, '10000')
  await expect(costCell(page, 'Tokens per epoch')).toContainText('37')
  await expect(costCell(page, 'Estimated cost')).toContainText('$1.11')
})

test('the stratified split takes one in ten from each class', async ({ page }) => {
  // Two classes of 10 rows, eval share 10% -> one eval row per class, 18 train.
  const words = 'apple bridge candle desert engine forest garden hammer island jungle kettle ladder magnet needle orange pepper quartz rocket saddle tunnel'.split(' ')
  const rows = words.map((w, i) => JSON.stringify({ instruction: `Sort ${w} ${words[(i + 7) % 20]} ${words[(i * 3 + 1) % 20]}`, output: `${w} ok`, label: i < 10 ? 'red' : 'blue' }))
  await newDataset(page)
  await importFile(page, 'classes.jsonl', jsonl(...rows))
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: 'Make the split' }).click()
  await expect(page.getByText('Split into 18 train and 2 eval rows')).toBeVisible()
  const ev = records((await exported(page, 'eval')).text)
  expect(ev.map(r => r.label).sort()).toEqual(['blue', 'red'])
  const train = records((await exported(page, 'train')).text)
  expect([...train, ...ev].map(r => r.messages[0].content).sort()).toEqual(rows.map(r => JSON.parse(r).instruction).sort())
})

test('a card is found only when its Luhn sum works out, and the export is masked', async ({ page }) => {
  // 4111111111111111: doubled digits 4->8 and seven 1->2 = 22, plus eight 1s = 30, divisible by 10. Ending in 2 it is 31, not a card.
  await newDataset(page)
  await importFile(page, 'pii.jsonl', jsonl(
    chat(['user', 'My card is 4111 1111 1111 1111.'], ['assistant', 'Thanks for that.']),
    chat(['user', 'The parcel is 4111 1111 1111 1112.'], ['assistant', 'Looking into it.']),
    chat(['user', 'Write to jane@example.com or (415) 555-0137.'], ['assistant', 'Will do so.']),
  ))
  await tab(page, 'Fix & export')
  expect(await beforeAfter(page, 'Rows with PII')).toEqual(['2', '0'])
  await page.getByRole('button', { name: /^Apply fixes/ }).click()
  await expect(page.getByText('Applied fixes: 3 rows remain')).toBeVisible()
  const t = (await exported(page, 'train')).text
  expect(t).toContain('My card is [CARD].')
  expect(t).toContain('4111 1111 1111 1112')
  expect(t).toContain('Write to [EMAIL] or [PHONE].')
})
