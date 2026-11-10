// Exact and near-duplicate detection. Near duplicates use MinHash over word 3-shingles with LSH banding,
// then confirm each candidate pair by its estimated Jaccard similarity.
import type { Msg, Row } from './types.ts'

export const normText = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim()

const joinTurns = (ms: Msg[] | undefined) => (ms ?? []).filter(m => m.role !== 'system').map(m => `${m.role}: ${m.content}${m.tool_calls?.length ? ' ' + JSON.stringify(m.tool_calls) : ''}`).join('\n')
/** Everything the model trains on for this row, minus system prompts (a shared system prompt would make every row look alike). */
export const rowText = (r: Row) => r.format === 'dpo' ? `${joinTurns(r.messages)}\n<chosen>\n${joinTurns(r.chosen)}\n<rejected>\n${joinTurns(r.rejected)}` : joinTurns(r.messages)
/** The conditioning part: every turn except the final assistant answer. */
export const promptText = (r: Row) => joinTurns(r.format === 'dpo' || r.messages.at(-1)?.role !== 'assistant' ? r.messages : r.messages.slice(0, -1))

function fnv(s: string, seed = 0x811c9dc5) {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
const fmix = (h: number) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0 }

/** 64-bit content key (two independent 32-bit hashes) of the normalised text. */
export const textKey = (s: string) => { const n = normText(s); return fnv(n).toString(36) + '.' + fnv(n, 0x9747b28c).toString(36) }
export const rowKey = (r: Row) => textKey(rowText(r))

export const PERMS = 64
const BANDS = 16, ROWS = PERMS / BANDS
const SEEDS = Array.from({ length: PERMS }, (_, i) => fmix(0x9e3779b9 * (i + 1)))

export function shingles(s: string, k = 3): Set<number> {
  const w = normText(s).split(' ').filter(Boolean)
  const out = new Set<number>()
  if (w.length < k) { if (w.length) out.add(fnv(w.join(' '))); return out }
  for (let i = 0; i + k <= w.length; i++) out.add(fnv(w.slice(i, i + k).join(' ')))
  return out
}

export function minhash(sh: Set<number>): Uint32Array {
  const sig = new Uint32Array(PERMS).fill(0xffffffff)
  for (const x of sh) for (let i = 0; i < PERMS; i++) { const h = fmix(x ^ SEEDS[i]); if (h < sig[i]) sig[i] = h }
  return sig
}

export const estJaccard = (a: Uint32Array, b: Uint32Array) => { let s = 0; for (let i = 0; i < PERMS; i++) if (a[i] === b[i]) s++; return s / PERMS }

/** LSH: 16 bands of 4 rows; two signatures sharing any band become a candidate pair (about 50% similarity and up). */
function bandKeys(s: Uint32Array): string[] {
  const out: string[] = []
  for (let b = 0; b < BANDS; b++) {
    let h = b * 0x27d4eb2d
    for (let r = 0; r < ROWS; r++) h = fmix(h ^ s[b * ROWS + r])
    out.push(`${b}:${h}`)
  }
  return out
}

export function jaccard(a: Set<number>, b: Set<number>) {
  if (!a.size && !b.size) return 1
  let i = 0
  for (const x of a) if (b.has(x)) i++
  return i / (a.size + b.size - i)
}

/** Union-find over n items. */
export function groups(n: number, pairs: [number, number][]): number[][] {
  const p = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x] } return x }
  for (const [a, b] of pairs) { const ra = find(a), rb = find(b); if (ra !== rb) p[Math.max(ra, rb)] = Math.min(ra, rb) }
  const m = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const r = find(i); const g = m.get(r); if (g) g.push(i); else m.set(r, [i]) }
  return [...m.values()]
}

export interface DupResult {
  keys: string[]
  /** Groups of row indexes with identical normalised text (size > 1), first index is the one kept */
  exact: number[][]
  /** Groups of near-duplicates (size > 1) after collapsing exact duplicates */
  near: number[][]
  /** Similar pairs with their estimated Jaccard */
  pairs: { a: number; b: number; sim: number }[]
  sigs: Uint32Array[]
}

/** Finds exact duplicates by content key and near duplicates with MinHash LSH at the given Jaccard threshold. */
export function findDuplicates(texts: string[], threshold = 0.8): DupResult {
  const keys = texts.map(textKey)
  const byKey = new Map<string, number[]>()
  keys.forEach((k, i) => { const g = byKey.get(k); if (g) g.push(i); else byKey.set(k, [i]) })
  const exact = [...byKey.values()].filter(g => g.length > 1)
  const reps = [...byKey.values()].map(g => g[0])
  const sigs: Uint32Array[] = new Array(texts.length)
  for (const i of reps) sigs[i] = minhash(shingles(texts[i]))
  for (const g of exact) for (const i of g.slice(1)) sigs[i] = sigs[g[0]]

  const buckets = new Map<string, number[]>()
  for (const i of reps) {
    const s = sigs[i]
    for (const k of bandKeys(s)) { const l = buckets.get(k); if (l) l.push(i); else buckets.set(k, [i]) }
  }
  const seen = new Set<string>(), pairs: { a: number; b: number; sim: number }[] = []
  for (const l of buckets.values()) {
    if (l.length < 2 || l.length > 400) continue
    for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
      const a = l[x], b = l[y], k = a < b ? `${a},${b}` : `${b},${a}`
      if (seen.has(k)) continue
      seen.add(k)
      const sim = estJaccard(sigs[a], sigs[b])
      if (sim >= threshold) pairs.push({ a: Math.min(a, b), b: Math.max(a, b), sim })
    }
  }
  const near = groups(texts.length, pairs.map(p => [p.a, p.b])).filter(g => g.length > 1)
  return { keys, exact, near, pairs, sigs }
}

/** Eval rows whose prompt matches a train prompt exactly, or whose full text is a near duplicate of a train row. */
export function findLeaks(rows: Row[], train: number[], evalIdx: number[], sigs: Uint32Array[], threshold = 0.8): { evalIdx: number; trainIdx: number; kind: 'exact prompt' | 'near duplicate'; sim: number }[] {
  if (!train.length || !evalIdx.length) return []
  const out: { evalIdx: number; trainIdx: number; kind: 'exact prompt' | 'near duplicate'; sim: number }[] = []
  const tp = new Map<string, number>()
  for (const i of train) { const k = textKey(promptText(rows[i])); if (!tp.has(k)) tp.set(k, i) }
  const buckets = new Map<string, number[]>()
  for (const i of train) {
    const s = sigs[i]
    for (const k of bandKeys(s)) { const l = buckets.get(k); if (l) l.push(i); else buckets.set(k, [i]) }
  }
  for (const e of evalIdx) {
    const pk = textKey(promptText(rows[e]))
    if (normText(promptText(rows[e])).length > 12 && tp.has(pk)) { out.push({ evalIdx: e, trainIdx: tp.get(pk)!, kind: 'exact prompt', sim: 1 }); continue }
    const s = sigs[e]
    let best = -1, bestSim = 0
    for (const k of bandKeys(s)) for (const t of buckets.get(k) ?? []) { const sim = estJaccard(s, sigs[t]); if (sim > bestSim) { bestSim = sim; best = t } }
    if (best >= 0 && bestSim >= threshold) out.push({ evalIdx: e, trainIdx: best, kind: 'near duplicate', sim: bestSim })
  }
  return out
}
