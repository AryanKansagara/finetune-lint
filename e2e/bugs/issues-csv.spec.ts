import { chat, importFile, jsonl, newDataset, saved, tab } from '../helpers.ts'
import { expect, test } from '../fixtures.ts'

test('#19 the issues CSV keeps a file name with a comma in one cell', async ({ page }) => {
  await newDataset(page)
  await importFile(page, 'a, final.jsonl', jsonl(chat(['Human', 'Hi'], ['assistant', 'Hello'])))
  await tab(page, 'Issues')
  const f = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
  expect(f.text.split('\n')[1]).toMatch(/^"a, final\.jsonl",1,error,bad_role,/)
})

for (const [name, cell] of [['=1+1.jsonl', "'=1+1.jsonl"], ['+a "b".jsonl', `"'+a ""b"".jsonl"`], ['@x.jsonl', "'@x.jsonl"], ['-x.jsonl', "'-x.jsonl"]] as const) {
  test(`#19 the file name ${name} is written as text`, async ({ page }) => {
    await newDataset(page)
    await importFile(page, name, jsonl(chat(['Human', 'Hi'], ['assistant', 'Hello'])))
    await tab(page, 'Issues')
    const f = await saved(page, () => page.getByRole('button', { name: 'Download CSV' }).click())
    expect(f.text.split('\n')[1]).toBe(`${cell},1,error,bad_role,"Turn 1 has role ""Human""; expected system, user, assistant or tool."`)
  })
}
