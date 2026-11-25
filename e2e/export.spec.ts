import { chat, exported, formatSelect, importFile, jsonl, newDataset, records, saved, tab } from './helpers.ts'
import { expect, test } from './fixtures.ts'

const SFT = jsonl(
  chat(['system', 'Be brief.'], ['user', 'Hi "there"'], ['assistant', 'Line one\nline two']),
  chat(['user', 'A first'], ['assistant', 'B'], ['user', 'C then'], ['assistant', 'D']),
)

test.describe('export formats', () => {
  test.beforeEach(async ({ page }) => {
    await newDataset(page)
    await importFile(page, 'desk.jsonl', SFT)
    await tab(page, 'Fix & export')
  })

  test('OpenAI JSONL is the input, record for record', async ({ page }) => {
    const f = await exported(page, 'train')
    expect(f.name).toMatch(/-train\.jsonl$/)
    expect(records(f.text)).toEqual(SFT.trim().split('\n').map(l => JSON.parse(l)))
  })

  test('ShareGPT', async ({ page }) => {
    await formatSelect(page).selectOption('sharegpt')
    expect(records((await exported(page, 'train')).text)[0]).toEqual({ conversations: [{ from: 'system', value: 'Be brief.' }, { from: 'human', value: 'Hi "there"' }, { from: 'gpt', value: 'Line one\nline two' }] })
  })

  test('Alpaca writes the single-turn row and counts the one it cannot', async ({ page }) => {
    await formatSelect(page).selectOption('alpaca')
    expect(records((await exported(page, 'train')).text)).toEqual([{ system: 'Be brief.', instruction: 'Hi "there"', input: '', output: 'Line one\nline two' }])
    await expect(page.getByText('1 rows cannot be written in this format (multi-turn conversations do not fit Alpaca).')).toBeVisible()
  })

  test('TRL refuses chat rows', async ({ page }) => {
    await formatSelect(page).selectOption('trl-dpo')
    await expect(page.getByRole('button', { name: 'Download train.jsonl (0)' })).toBeDisabled()
    await expect(page.getByText('2 rows cannot be written in this format (not a preference pair).')).toBeVisible()
  })
})

test('preference pairs export to TRL and OpenAI', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'pairs.jsonl', jsonl(JSON.stringify({ prompt: 'Q here', chosen: 'yes', rejected: 'no' })))
  await tab(page, 'Fix & export')
  const q = [{ role: 'user', content: 'Q here' }], y = [{ role: 'assistant', content: 'yes' }], n = [{ role: 'assistant', content: 'no' }]
  expect(records((await exported(page, 'train')).text)).toEqual([{ input: { messages: q }, preferred_output: y, non_preferred_output: n }])
  await formatSelect(page).selectOption('trl-dpo')
  expect(records((await exported(page, 'train')).text)).toEqual([{ prompt: q, chosen: y, rejected: n }])
})

test('issues CSV quotes its messages', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'desk.jsonl', jsonl(chat(['Human', 'Hi'], ['assistant', 'Hello'])))
  await tab(page, 'Issues')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  const lines = f.text.split('\n')
  expect(lines[0]).toBe('file,line,severity,code,message')
  expect(lines[1]).toBe('desk.jsonl,1,error,bad_role,"Turn 1 has role ""Human""; expected system, user, assistant or tool."')
})

test('data card shows the dataset and its history', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'desk.jsonl', SFT)
  await page.getByRole('link', { name: 'Data card' }).click()
  await expect(page.locator('article.card')).toContainText('desk.jsonl (train, 2 rows)')
  await expect(page.locator('article.card')).toContainText('All checks pass.')
  await expect(page.locator('article.card')).toContainText('v1 · import')
})

test('Export all my data holds the rows and nothing about an account', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'desk.jsonl', SFT)
  await page.goto('/settings')
  const f = await saved(page, () => page.getByRole('button', { name: 'Export all my data (JSON)' }).click())
  const o = JSON.parse(f.text)
  expect(Object.keys(o).sort()).toEqual(['app', 'exportedAt', 'projects'])
  expect(o.projects).toHaveLength(1)
  expect(o.projects[0].dataset.rows).toHaveLength(2)
})
