import { importFile, jsonl, newDataset, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#20 many small classes still give the eval share that was asked for', async ({ page }) => {
  // 10 classes of 4 rows, 10% eval share: 4 of 40 rows belong in eval. Rounding each class alone gives 0.
  const w = 'apple bridge candle desert engine forest garden hammer island jungle kettle ladder magnet needle orange pepper quartz rocket saddle tunnel umbrella valley window yellow zebra anchor basket copper dragon empire fabric guitar hollow insect jacket kitten lemon mirror nickel oyster'.split(' ')
  await newDataset(page)
  await importFile(page, 'a.jsonl', jsonl(...w.map((x, i) => JSON.stringify({ prompt: `${x} ${w[(i * 3 + 1) % 40]} ${w[(i * 7 + 2) % 40]}`, completion: `${w[(i * 11 + 5) % 40]} ${x}`, label: `c${i % 10}` }))))
  await tab(page, 'Fix & export')
  await page.getByRole('button', { name: 'Make the split' }).click()
  await expect(page.getByText('Split into 36 train and 4 eval rows')).toBeVisible()
})
