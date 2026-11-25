import { importFile, jsonl, kpi, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#6 a fresh split puts both answers to one prompt on the same side', async ({ page }) => {
  // 20 questions, each answered twice in unrelated words: no near duplicates, but every pair shares its prompt.
  const w = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo'.split(' ')
  const rows = Array.from({ length: 40 }, (_, i) => JSON.stringify({ prompt: `How do I reset question number ${Math.floor(i / 2)}?`, completion: Array.from({ length: 12 }, (_, k) => w[(i * 7 + k * (i % 5 + 1)) % 18]).join(' ') }))
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(...rows))
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: 'Make the split' }).click()
  await expect(page.getByText(/^Split into/)).toBeVisible()
  await tab(page, 'Duplicates & leaks')
  await expect(kpi(page, 'Eval rows leaking')).toContainText(/of [1-9]\d* eval rows/)
  await expect(kpi(page, 'Eval rows leaking').locator('b')).toHaveText('0')
})
