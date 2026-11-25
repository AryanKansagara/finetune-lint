import { choose, newDataset, panel } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#18 a file that is not UTF-8 is refused instead of imported with damaged letters', async ({ page }) => {
  await newDataset(page)
  // "Café" in Latin-1: the 0xE9 byte is not valid UTF-8.
  await page.locator('input[type=file]').setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('instruction,output\nCaf\xe9,Bar\n', 'latin1') })
  await expect(page.getByText(/not UTF-8/)).toBeVisible()
  await expect(panel(page, 'a.csv')).toHaveCount(0)
})

test('#18 UTF-16 and cut-off UTF-8 are refused, and the next file can be imported', async ({ page }) => {
  await newDataset(page)
  for (const [name, buffer] of [['u16.csv', Buffer.from('\ufeffinstruction,output\nFoo,Bar\n', 'utf16le')], ['cut.csv', Buffer.from('instruction,output\nFoo,Café').subarray(0, -1)]] as const) {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer })
    await expect(page.getByText(`${name} is not UTF-8`)).toBeVisible()
    await expect(panel(page, name)).toHaveCount(0)
  }
  const p = await choose(page, 'b.csv', '\ufeffinstruction,output\nCafé,日本 \ufffd 🙂\n')
  await expect(p).toContainText('1 rows read')
  await expect(p.locator('label.field').first()).toContainText('instruction')
})
