// Fix-ups that turn a linted dataset into one you can upload, plus a leakage-free stratified split.
import { redact } from './content.ts'
import { findDuplicates, findLeaks, groups, rowText } from './dedupe.ts'
import { normaliseRole } from './formats.ts'
import { msgTokens, rowTokens, PER_EXAMPLE } from './tokens.ts'
import type { Msg, Row } from './types.ts'
import { BLOCKING, validateRow } from './validate.ts'
import { isRefusal } from './content.ts'

export interface FixSet {
  normaliseRoles: boolean
  stripPii: boolean
  dropInvalid: boolean
  dedupeExact: boolean
  dedupeNear: boolean
  dropLeaks: boolean
  trimToContext: boolean
  dropRefusals: boolean
  dropIdenticalPairs: boolean
}
export const FIX_LABEL: Record<keyof FixSet, [string, string]> = {
  normaliseRoles: ['Normalise roles', 'Map human/gpt/bot/model to user/assistant, move system prompts first, merge back-to-back turns from the same role.'],
  stripPii: ['Strip personal data', 'Replace emails, phone numbers, Luhn-valid card numbers, SSNs and API keys with [EMAIL], [PHONE], [CARD], [SSN], [SECRET].'],
  dropInvalid: ['Drop broken rows', 'Remove rows that still fail structural checks (empty turns, unknown roles, no final assistant turn, bad tool calls).'],
  dedupeExact: ['Remove exact duplicates', 'Keep the first copy of every row whose normalised text repeats.'],
  dedupeNear: ['Remove near duplicates', 'Keep one row from each cluster of rows above the similarity threshold.'],
  dropLeaks: ['Drop leaked eval rows', 'Remove eval rows whose prompt or text also appears in train.'],
  trimToContext: ['Fit the context window', 'Drop the oldest middle turns (keeping the system prompt and the final exchange) until the row fits; drop it if it still does not.'],
  dropRefusals: ['Drop refusals', 'Remove rows whose assistant replies refuse (“As an AI…”, “I can’t help with that”).'],
  dropIdenticalPairs: ['Drop empty preference pairs', 'Remove pairs where chosen and rejected are the same text.'],
}
export const DEFAULT_FIXES: FixSet = { normaliseRoles: true, stripPii: true, dropInvalid: true, dedupeExact: true, dedupeNear: true, dropLeaks: true, trimToContext: true, dropRefusals: false, dropIdenticalPairs: true }

function normaliseTurns(ms: Msg[]): Msg[] {
  const mapped = ms.map(m => ({ ...m, role: normaliseRole(m.role) }))
  const sys = mapped.filter(m => m.role === 'system' && m.content.trim())
  const rest = mapped.filter(m => m.role !== 'system')
  const out: Msg[] = sys.length ? [{ role: 'system', content: sys.map(m => m.content).join('\n\n') }] : []
  for (const m of rest) {
    const prev = out.at(-1)
    if (prev && prev.role === m.role && m.role !== 'tool' && !prev.tool_calls && !m.tool_calls) prev.content = [prev.content, m.content].filter(s => s.trim()).join('\n\n')
    else out.push({ ...m })
  }
  return out
}

const redactTurns = (ms: Msg[] | undefined, n: { v: number }) => ms?.map(m => { const r = redact(m.content); n.v += r.hits.length; return r.hits.length ? { ...m, content: r.text } : m })

/** Drops whole middle exchanges until the row fits; keeps system prompt, first user turn and the final exchange. */
export function trimRow(r: Row, ctx: number): Row | null {
  if (rowTokens(r).total <= ctx) return r
  if (r.format === 'dpo') return null
  const ms = [...r.messages]
  const head = ms[0]?.role === 'system' ? 1 : 0
  while (ms.length > head + 2) {
    // Remove the oldest turn after the head and any tool results orphaned by it.
    ms.splice(head, 1)
    while (ms[head] && ms[head].role !== 'user') ms.splice(head, 1)
    const t = PER_EXAMPLE + ms.reduce((s, m) => s + msgTokens(m), 0)
    if (t <= ctx && ms.at(-1)?.role === 'assistant' && ms.some(m => m.role === 'user')) return { ...r, messages: ms }
  }
  return null
}

export interface FixLog { key: keyof FixSet; count: number; note: string }

export function applyFixes(input: Row[], fx: FixSet, opts: { ctx: number; nearThreshold: number }): { rows: Row[]; log: FixLog[] } {
  let rows = input.map(r => ({ ...r }))
  const log: FixLog[] = []
  const note = (key: keyof FixSet, count: number, n: string) => log.push({ key, count, note: n })

  if (fx.normaliseRoles) {
    let changed = 0
    rows = rows.map(r => {
      const next = { ...r, messages: normaliseTurns(r.messages), chosen: r.chosen && normaliseTurns(r.chosen), rejected: r.rejected && normaliseTurns(r.rejected) }
      if (JSON.stringify(next) !== JSON.stringify(r)) changed++
      return next
    })
    note('normaliseRoles', changed, `${changed} rows rewritten`)
  }
  if (fx.stripPii) {
    const n = { v: 0 }
    rows = rows.map(r => ({ ...r, messages: redactTurns(r.messages, n)!, chosen: redactTurns(r.chosen, n), rejected: redactTurns(r.rejected, n) }))
    note('stripPii', n.v, `${n.v} values replaced`)
  }
  if (fx.trimToContext) {
    let trimmed = 0, dropped = 0
    rows = rows.flatMap(r => {
      const t = trimRow(r, opts.ctx)
      if (!t) { dropped++; return [] }
      if (t !== r) trimmed++
      return [t]
    })
    note('trimToContext', trimmed + dropped, `${trimmed} trimmed, ${dropped} dropped`)
  }
  if (fx.dropInvalid) {
    const before = rows.length
    rows = rows.filter(r => !validateRow(r).some(i => BLOCKING.has(i.code)))
    note('dropInvalid', before - rows.length, `${before - rows.length} rows dropped`)
  }
  if (fx.dropIdenticalPairs) {
    const before = rows.length
    rows = rows.filter(r => r.format !== 'dpo' || (r.chosen ?? []).map(m => m.content).join('\n').trim() !== (r.rejected ?? []).map(m => m.content).join('\n').trim())
    note('dropIdenticalPairs', before - rows.length, `${before - rows.length} pairs dropped`)
  }
  if (fx.dropRefusals) {
    const before = rows.length
    rows = rows.filter(r => !(r.format === 'dpo' ? r.chosen ?? [] : r.messages.filter(m => m.role === 'assistant')).some(m => isRefusal(m.content)))
    note('dropRefusals', before - rows.length, `${before - rows.length} rows dropped`)
  }
  if (fx.dedupeExact || fx.dedupeNear || fx.dropLeaks) {
    const d = findDuplicates(rows.map(rowText), opts.nearThreshold)
    const drop = new Set<number>()
    if (fx.dedupeExact) for (const g of d.exact) for (const i of g.slice(1)) drop.add(i)
    note('dedupeExact', fx.dedupeExact ? drop.size : 0, `${fx.dedupeExact ? drop.size : 0} copies removed`)
    if (fx.dedupeNear) {
      const before = drop.size
      // Prefer keeping a train row so the eval side loses the copy.
      for (const g of d.near) { const keep = g.find(i => rows[i].split !== 'eval') ?? g[0]; for (const i of g) if (i !== keep) drop.add(i) }
      note('dedupeNear', drop.size - before, `${drop.size - before} near copies removed`)
    }
    if (fx.dropLeaks) {
      const train: number[] = [], ev: number[] = []
      rows.forEach((r, i) => { if (!drop.has(i)) (r.split === 'eval' ? ev : train).push(i) })
      const leaks = findLeaks(rows, train, ev, d.sigs, opts.nearThreshold)
      for (const l of leaks) drop.add(l.evalIdx)
      note('dropLeaks', leaks.length, `${leaks.length} eval rows removed`)
    }
    rows = rows.filter((_, i) => !drop.has(i))
  }
  return { rows, log }
}

// ---------- Split ----------

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export interface SplitOptions { evalFraction: number; seed: number; nearThreshold: number; labels?: (string | null)[] }

/**
 * Stratified train/eval split. Near-duplicate clusters move as one unit so no eval row has a twin in train.
 * Strata are the label (classification-style data) or a token-length quartile otherwise.
 */
export function makeSplit(rows: Row[], o: SplitOptions): Row[] {
  const d = findDuplicates(rows.map(rowText), o.nearThreshold)
  const clusters = groups(rows.length, [...d.exact.flatMap(g => g.slice(1).map(i => [g[0], i] as [number, number])), ...d.pairs.map(p => [p.a, p.b] as [number, number])])
  const len = rows.map(r => rowTokens(r).total)
  const sorted = [...len].sort((a, b) => a - b)
  const q = [0.25, 0.5, 0.75].map(p => sorted[Math.floor(p * sorted.length)] ?? 0)
  const stratum = (i: number) => o.labels?.[i] ?? `len${q.filter(x => len[i] > x).length}`
  const by = new Map<string, number[][]>()
  for (const c of clusters) { const k = stratum(c[0]); const l = by.get(k); if (l) l.push(c); else by.set(k, [c]) }
  const rand = rng(o.seed)
  const split: ('train' | 'eval')[] = rows.map(() => 'train')
  for (const cs of by.values()) {
    for (let i = cs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cs[i], cs[j]] = [cs[j], cs[i]] }
    const size = cs.reduce((s, c) => s + c.length, 0)
    const want = Math.round(size * o.evalFraction)
    let got = 0
    // Singletons first fill the eval quota, so big clusters of paraphrases stay in train.
    for (const c of [...cs].sort((a, b) => a.length - b.length)) {
      if (got >= want) break
      if (got + c.length > want + 1) continue
      for (const i of c) split[i] = 'eval'
      got += c.length
    }
  }
  return rows.map((r, i) => ({ ...r, split: split[i] }))
}
