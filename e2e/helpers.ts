import { readFile } from 'node:fs/promises'
import { expect, type Download, type Page } from '@playwright/test'

export type Turn = [role: string, content: string]
/** One OpenAI chat record as a JSONL line. */
export const chat = (...turns: Turn[]) => JSON.stringify({ messages: turns.map(([role, content]) => ({ role, content })) })
export const jsonl = (...lines: string[]) => lines.join('\n') + '\n'

/** Starts an empty dataset and lands on its import tab. */
export async function newDataset(page: Page) {
  await page.goto('/app')
  await page.getByRole('button', { name: /^(Import your data|New dataset)$/ }).click()
  await expect(page).toHaveURL(/\/app\/p\/[\w-]+\/data$/)
}

export const panel = (page: Page, name: string) => page.locator('.panel').filter({ has: page.getByRole('heading', { name, exact: true }) })

/** Chooses a file and returns its (not yet imported) validation panel. */
export async function choose(page: Page, name: string, text: string | Buffer) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text as string) })
  const p = panel(page, name)
  await expect(p).toBeVisible()
  return p
}

/** Chooses and imports one file, then waits for the lint to land on the overview. */
export async function importFile(page: Page, name: string, text: string | Buffer) {
  const p = await choose(page, name, text)
  await p.getByRole('button', { name: 'Import and lint' }).click()
  await expect(page.locator('.kpis')).toBeVisible()
}
export async function addFile(page: Page, name: string, text: string) {
  await tab(page, 'Import & settings')
  const p = await choose(page, name, text)
  await p.getByRole('button', { name: 'Add to dataset' }).click()
  await expect(p).toHaveCount(0)
}

export const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('link', { name, exact: true }).click()
/** The whole text of a KPI tile. */
export const kpi = (page: Page, label: string) => page.locator('.kpi').filter({ has: page.locator('small', { hasText: new RegExp(`^${label}`) }) })
export const costCell = (page: Page, label: string) => page.locator('.cost-grid > div').filter({ has: page.locator('small', { hasText: new RegExp(`^${label}`) }) })
export const fixToggle = (page: Page, name: string) => page.locator('.fix-toggle').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) })
/** A row of the before/after table: label, now, after. */
export async function beforeAfter(page: Page, label: string) {
  const row = page.locator('table.ba tbody tr').filter({ has: page.locator('th', { hasText: new RegExp(`^${label}$`) }) })
  await expect(row.locator('td').nth(1)).not.toHaveText('…')
  return (await row.locator('td').allTextContents()).slice(0, 2)
}

export async function saved(page: Page, click: () => Promise<void>): Promise<{ name: string; text: string }> {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]) as [Download, void]
  return { name: d.suggestedFilename(), text: await readFile(await d.path(), 'utf8') }
}
export const exported = (page: Page, side: 'train' | 'eval') => saved(page, () => page.getByRole('button', { name: new RegExp(`^Download ${side}\\.jsonl`) }).click())
export const records = (text: string) => text.trim().split('\n').map(l => JSON.parse(l))
export const formatSelect = (page: Page) => page.locator('label.field').filter({ hasText: 'Format' }).locator('select')

export async function setPrice(page: Page, usdPerMillion: string) {
  const f = page.getByLabel('Price per 1M training tokens ($)')
  await f.fill(usdPerMillion)
  await expect(f).toHaveValue(usdPerMillion)
}
