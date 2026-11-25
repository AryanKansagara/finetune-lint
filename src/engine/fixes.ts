// Fix-ups that turn a linted dataset into one you can upload, plus a leakage-free stratified split.
import { findDuplicates, findLeaks, groups, rowText } from './dedupe.ts'
import { normaliseRole } from './formats.ts'
import { redactRow } from './pii.ts'
import { msgTokens, rowTokens, PER_EXAMPLE } from './tokens.ts'
import type { Msg, Row } from './types.ts'
import { BLOCKING, validateRow } from './validate.ts'
import { isRefusal } from './content.ts'
import { leakPromptKey } from './dedupe.ts'

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
  normaliseRoles: ['Normalise roles', 'Map human/gpt/bot/model to user/assistant, move system prompts first, merge back-to-back turns from the same role (unless their weight, name or calls differ).'],
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

const isBlank = (m: Msg) => !m.content.trim() && !m.tool_calls?.length && !m.function_call
/** A weight of 1 is the default; only assistant turns have one. */
const effWeight = (m: Msg) => m.role === 'assistant' ? m.weight ?? 1 : undefined
/** Whether two turns of one role can become one without losing a call, a name or a training mask. */
const mergeable = (a: Msg, b: Msg) => !a.tool_calls && !b.tool_calls && !a.function_call && !b.function_call && a.name === b.name && a.tool_call_id === b.tool_call_id && effWeight(a) === effWeight(b)

function normaliseTurns(ms: Msg[]): Msg[] {
  const mapped = ms.map(m => ({ ...m, role: normaliseRole(m.role) }))
  const sys: Msg[] = mapped.filter(m => m.role === 'system' && m.content.trim()).map(m => ({ role: 'system', content: m.content, ...(m.name ? { name: m.name } : {}) }))
  const rest = mapped.filter(m => m.role !== 'system')
  const out: Msg[] = []
  for (const m of [...sys, ...rest]) {
    const prev = out.at(-1)
    if (!prev || prev.role !== m.role || m.role === 'tool' || prev.tool_calls || m.tool_calls) out.push({ ...m })
    // An empty turn has nothing to lose, whatever its weight or name.
    else if (isBlank(m)) continue
    else if (isBlank(prev)) out[out.length - 1] = { ...m }
    else if (mergeable(prev, m)) { prev.content += '\n\n' + m.content; if (prev.weight === undefined && m.role === 'assistant' && m.weight != null) prev.weight = m.weight }
    else out.push({ ...m })
  }
  return out
}

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
    let n = 0
    rows = rows.map(r => { const x = redactRow(r); n += x.count; return x.row })
    note('stripPii', n, `${n} values replaced`)
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
 * Stratified train/eval split. Rows that share a prompt and near-duplicate clusters move as one unit, and the result
 * is run through the leak check, so no eval row has a twin in train.
 * Strata are the label (classification-style data) or a token-length quartile otherwise.
 */
export function makeSplit(rows: Row[], o: SplitOptions): Row[] {
  const d = findDuplicates(rows.map(rowText), o.nearThreshold)
  const byPrompt = new Map<string, number>()
  const samePrompt = rows.flatMap((r, i): [number, number][] => {
    const k = leakPromptKey(r)
    if (k === null) return []
    if (byPrompt.has(k)) return [[byPrompt.get(k)!, i]]
    byPrompt.set(k, i)
    return []
  })
  const clusters = groups(rows.length, [...samePrompt, ...d.exact.flatMap(g => g.slice(1).map(i => [g[0], i] as [number, number])), ...d.pairs.map(p => [p.a, p.b] as [number, number])])
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
  // Clusters come from sampled candidate pairs; whatever the leak check still finds goes back to train with its cluster.
  const clusterOf = new Map(clusters.flatMap(c => c.map(i => [i, c] as const)))
  for (;;) {
    const side = (s: 'train' | 'eval') => rows.map((_, i) => i).filter(i => split[i] === s)
    const leaks = findLeaks(rows, side('train'), side('eval'), d.sigs, o.nearThreshold)
    if (!leaks.length) break
    for (const l of leaks) for (const i of clusterOf.get(l.evalIdx)!) split[i] = 'train'
  }
  return rows.map((r, i) => ({ ...r, split: split[i] }))
}
