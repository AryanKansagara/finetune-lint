import { chat, fixToggle, importFile, jsonl, kpi, newDataset, tab } from './helpers.ts'
import { expect, test } from './fixtures.ts'

for (const [path, heading] of [['/', /./], ['/docs', /Format guide and method/], ['/settings', /^Settings$/], ['/app', /^Datasets$/]] as const) {
  test(`${path} renders`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  })
}

test('the support sample reads 1,314 of its 1,320 lines (6 are cut short) and is labelled synthetic', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/app?sample=support-sft')
  // 1,200 train lines - 6 truncated + 120 eval.
  await expect(kpi(page, 'Rows').locator('b')).toHaveText('1,314')
  await expect(kpi(page, 'Rows')).toContainText('1,194 train · 120 eval · 6 unreadable lines')
  await expect(page.locator('.proj-head')).toContainText(/synthetic/i)
  for (const [name, sel] of [['Issues', '.issue-table'], ['Duplicates & leaks', '.dup-list'], ['Content', '.panel'], ['Fix & export', '.fix-toggles'], ['History', '.versions'], ['Import & settings', '.drop']]) {
    if (name === 'Content') await page.keyboard.press('4')
    else await tab(page, name)
    await expect(page.locator(sel).first()).toBeVisible()
  }
})

test('the DPO sample shows its length bias', async ({ page }) => {
  await page.goto('/app?sample=support-dpo&tab=content')
  await expect(page.getByText(/^Length bias: in/)).toBeVisible()
  await expect(page.locator('.cost-grid > div', { hasText: 'Missing a side' }).locator('b')).toHaveText('1')
})

test('rows, settings, versions and fix choices survive a reload', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'keep.jsonl', jsonl(chat(['user', 'Keep me please'], ['assistant', 'Kept'])))
  await page.getByLabel('Epochs').fill('7')
  await expect(page.getByLabel('Epochs')).toHaveValue('7')
  await tab(page, 'Fix & export')
  // The box is redrawn after the choice is stored, so click() and wait rather than check().
  await fixToggle(page, 'Drop refusals').locator('input').click()
  await expect(fixToggle(page, 'Drop refusals').locator('input')).toBeChecked()
  await expect(fixToggle(page, 'Drop refusals')).toContainText('0 rows dropped')
  await page.reload()
  await expect(fixToggle(page, 'Drop refusals').locator('input')).toBeChecked()
  await tab(page, 'Overview')
  await expect(kpi(page, 'Rows').locator('b')).toHaveText('1')
  await expect(page.getByLabel('Epochs')).toHaveValue('7')
  await tab(page, 'History')
  await expect(page.locator('.versions li')).toHaveCount(1)
})

test('deleting a dataset can be undone', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'keep.jsonl', jsonl(chat(['user', 'Keep me please'], ['assistant', 'Kept'])))
  await page.goto('/app')
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Delete dataset' }).click()
  await expect(page.locator('.project-card')).toHaveCount(0)
  await page.locator('.toast').getByRole('button', { name: /undo/i }).click()
  await expect(page.locator('.project-card')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.project-card dl').first()).toContainText('Rows1')
})

test('an unknown dataset link says so', async ({ page }) => {
  await page.goto('/app/p/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Dataset not found' })).toBeVisible()
})
