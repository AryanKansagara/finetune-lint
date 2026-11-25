import { newDataset, panel } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test.fail('#18 a file that is not UTF-8 is refused instead of imported with damaged letters', async ({ page }) => {
  await newDataset(page)
  // "Café" in Latin-1: the 0xE9 byte is not valid UTF-8.
  await page.locator('input[type=file]').setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('instruction,output\nCaf\xe9,Bar\n', 'latin1') })
  await expect(page.getByText(/not UTF-8/)).toBeVisible()
  await expect(panel(page, 'a.csv')).toHaveCount(0)
})
