import type { Summary } from './analyze.ts'

export interface Version {
  id: string
  label: string
  at: number
  /** What produced this version: an import, a fix-up run, a split */
  note: string
  summary: Summary
  /** Content key per row, so two versions can be diffed without keeping both datasets */
  keys: string[]
}

export const KEY_CAP = 100_000

export function diffVersions(a: Version, b: Version) {
  const ka = new Map<string, number>(), kb = new Map<string, number>()
  for (const k of a.keys) ka.set(k, (ka.get(k) ?? 0) + 1)
  for (const k of b.keys) kb.set(k, (kb.get(k) ?? 0) + 1)
  let added = 0, removed = 0, kept = 0
  for (const [k, n] of kb) { const m = ka.get(k) ?? 0; added += Math.max(0, n - m); kept += Math.min(n, m) }
  for (const [k, n] of ka) removed += Math.max(0, n - (kb.get(k) ?? 0))
  const delta = Object.fromEntries((Object.keys(b.summary) as (keyof Summary)[]).map(k => [k, b.summary[k] - (a.summary[k] ?? 0)])) as Record<keyof Summary, number>
  return { added, removed, kept, delta }
}
