// Runs every check over a dataset and returns one report the UI, data card and versions all read from.
import { balance, boilerplate, detectLanguage, inferLabels, isRefusal, opener, scanPii, type PiiType } from './content.ts'
import { findDuplicates, findLeaks, rowText } from './dedupe.ts'
import { billedTokens, rowTokens, turnsTokens } from './tokens.ts'
import { ISSUES, type Format, type Issue, type IssueCode, type Row } from './types.ts'
import { validateRow } from './validate.ts'

export interface Options {
  /** Context length the model will be trained at */
  ctx: number
  /** Price per million training tokens, in USD */
  pricePerM: number
  epochs: number
  /** Training throughput in tokens per second, for the time estimate */
  throughput: number
  /** Jaccard similarity above which two rows count as near duplicates */
  nearThreshold: number
}
export const DEFAULT_OPTIONS: Options = { ctx: 4096, pricePerM: 0.5, epochs: 3, throughput: 6000, nearThreshold: 0.8 }

export const HIST_EDGES = [0, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, Infinity]
export const histogram = (xs: number[], edges = HIST_EDGES) => edges.slice(0, -1).map((lo, i) => xs.filter(x => x >= lo && x < edges[i + 1]).length)

const pct = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0

export interface Report {
  n: number
  nTrain: number
  nEval: number
  formats: Partial<Record<Format, number>>
  issues: Issue[]
  counts: Partial<Record<IssueCode, number>>
  /** Rows with at least one error-severity issue */
  errorRows: number
  /** Rows with no issue of any severity above info */
  cleanRows: number
  tokens: { perRow: number[]; total: number; mean: number; p50: number; p95: number; max: number; hist: number[]; overCtx: number; truncated: number; prompt: number; completion: number }
  dup: { exact: number[][]; near: number[][]; exactExtra: number; nearExtra: number; pairs: { a: number; b: number; sim: number }[] }
  leaks: { evalIdx: number; trainIdx: number; kind: string; sim: number }[]
  pii: { byType: Partial<Record<PiiType, number>>; rows: number }
  refusals: number
  openers: { opener: string; count: number }[]
  lang: { counts: [string, number][]; dominant: string; perRow: string[] }
  labels: { source: 'field' | 'inferred' | null; perRow: (string | null)[]; classes: [string, number][]; ratio: number; majorityShare: number }
  dpo: { pairs: number; identical: number; chosenLonger: number; meanRatio: number; biased: boolean } | null
  cost: { billed: number; epochs: number; trainingTokens: number; usd: number; hours: number }
}

/** Analyses parsed rows. `parseErrors` are lines that never became rows (bad JSON, unknown shape). */
export function analyze(rows: Row[], opts: Options = DEFAULT_OPTIONS, parseErrors: Issue[] = []): Report {
  const issues: Issue[] = [...parseErrors]
  const add = (i: number, code: IssueCode, message: string, turn?: number) => issues.push({ line: rows[i].line, file: rows[i].file, row: i, code, message, turn })

  rows.forEach((r, i) => { for (const x of validateRow(r)) issues.push({ ...x, row: i, file: r.file }) })

  // Tokens and truncation
  const toks = rows.map(rowTokens)
  const perRow = toks.map(t => t.total)
  const sorted = [...perRow].sort((a, b) => a - b)
  let truncated = 0, overCtx = 0
  perRow.forEach((t, i) => { if (t > opts.ctx) { overCtx++; truncated += t - opts.ctx; add(i, 'over_context', `About ${t.toLocaleString('en-US')} tokens; ${(t - opts.ctx).toLocaleString('en-US')} past the ${opts.ctx.toLocaleString('en-US')}-token context would be cut, usually from the end, which drops the answer.`) } })

  // Duplicates and leakage
  const texts = rows.map(rowText)
  const dup = findDuplicates(texts, opts.nearThreshold)
  for (const g of dup.exact) for (const i of g.slice(1)) add(i, 'exact_dup', `Same as ${rows[g[0]].file ? rows[g[0]].file + ':' : 'line '}${rows[g[0]].line}.`)
  const pairOf = new Map<number, { o: number; sim: number }>()
  for (const p of dup.pairs) { if (!pairOf.has(p.b)) pairOf.set(p.b, { o: p.a, sim: p.sim }) }
  for (const g of dup.near) for (const i of g.slice(1)) { const p = pairOf.get(i); const o = p?.o ?? g[0]; add(i, 'near_dup', `About ${Math.round((p?.sim ?? opts.nearThreshold) * 100)}% similar to ${rows[o].file ? rows[o].file + ':' : 'line '}${rows[o].line}.`) }

  const trainIdx: number[] = [], evalIdx: number[] = []
  rows.forEach((r, i) => (r.split === 'eval' ? evalIdx : trainIdx).push(i))
  const leaks = findLeaks(rows, trainIdx, evalIdx, dup.sigs, opts.nearThreshold)
  for (const l of leaks) add(l.evalIdx, 'leak', `${l.kind === 'exact prompt' ? 'Same prompt as' : `${Math.round(l.sim * 100)}% similar to`} train row ${rows[l.trainIdx].file ? rows[l.trainIdx].file + ':' : 'line '}${rows[l.trainIdx].line}; eval scores will look better than they are.`)

  // PII, refusals, openers, language
  const byType: Partial<Record<PiiType, number>> = {}
  let piiRows = 0, refusals = 0
  const finals: string[] = []
  const perLang: string[] = []
  rows.forEach((r, i) => {
    const hits = scanPii(texts[i])
    if (hits.length) {
      piiRows++
      const kinds = [...new Set(hits.map(h => h.type))]
      for (const h of hits) byType[h.type] = (byType[h.type] ?? 0) + 1
      add(i, 'pii', `Contains ${kinds.map(k => k === 'secret' ? 'a secret' : `a ${k === 'ssn' ? 'SSN' : k}`).join(', ')}: ${hits.slice(0, 2).map(h => h.value.length > 24 ? h.value.slice(0, 10) + '…' : h.value).join(', ')}.`)
    }
    const answers = r.format === 'dpo' ? (r.chosen ?? []) : r.messages.filter(m => m.role === 'assistant')
    const refused = answers.find(m => isRefusal(m.content))
    if (refused) { refusals++; add(i, 'refusal', `${r.format === 'dpo' ? 'The chosen response' : 'An assistant turn'} refuses: “${refused.content.slice(0, 80)}${refused.content.length > 80 ? '…' : ''}”`) }
    const final = r.format === 'dpo' ? r.chosen?.at(-1)?.content ?? '' : r.messages.at(-1)?.role === 'assistant' ? r.messages.at(-1)!.content : ''
    finals.push(final)
    perLang.push(detectLanguage([...r.messages, ...(r.chosen ?? [])].filter(m => m.role !== 'system' && m.role !== 'tool').map(m => m.content).join('\n')).lang)
  })
  const openers = boilerplate(finals)
  const tic = new Map(openers.map(o => [o.opener, o.count]))
  finals.forEach((f, i) => { const o = opener(f); if (tic.has(o)) add(i, 'boilerplate', `Starts with “${o}…”, like ${tic.get(o)! - 1} other replies.`) })

  const langCounts = new Map<string, number>()
  for (const l of perLang) langCounts.set(l, (langCounts.get(l) ?? 0) + 1)
  const counts_ = [...langCounts].sort((a, b) => b[1] - a[1])
  const dominant = counts_.find(c => c[0] !== 'und')?.[0] ?? 'und'
  perLang.forEach((l, i) => { if (l !== dominant && l !== 'und' && rows.length >= 10) add(i, 'language', `Detected ${l}; most of the dataset is ${dominant}.`) })

  // Labels
  const fieldLabels = rows.map(r => r.label ?? null)
  const hasField = fieldLabels.filter(Boolean).length >= rows.length * 0.5 && rows.length > 0
  const inferred = hasField ? null : inferLabels(finals)
  const labelRows = hasField ? fieldLabels : inferred ?? rows.map(() => null)
  const bal = balance(labelRows)

  // Preference pairs
  const pairs = rows.filter(r => r.format === 'dpo')
  let dpo: Report['dpo'] = null
  if (pairs.length) {
    let identical = 0, longer = 0, ratioSum = 0, ratioN = 0
    rows.forEach((r, i) => {
      if (r.format !== 'dpo') return
      const c = (r.chosen ?? []).map(m => m.content).join('\n').trim(), j = (r.rejected ?? []).map(m => m.content).join('\n').trim()
      if (c && c === j) { identical++; add(i, 'dpo_identical', 'Chosen and rejected are the same text, so the pair carries no preference signal.') }
      const tc = turnsTokens(r.chosen), tj = turnsTokens(r.rejected)
      if (tc > tj) longer++
      if (tj > 0) { ratioSum += tc / tj; ratioN++ }
    })
    const share = longer / pairs.length
    dpo = { pairs: pairs.length, identical, chosenLonger: share, meanRatio: ratioN ? ratioSum / ratioN : 1, biased: pairs.length >= 10 && (share > 0.75 || share < 0.25) }
  }

  // Cost: train rows only, each truncated at the context length.
  const billed = trainIdx.reduce((s, i) => s + billedTokens(rows[i], opts.ctx), 0)
  const trainingTokens = billed * opts.epochs
  const cost = { billed, epochs: opts.epochs, trainingTokens, usd: trainingTokens / 1e6 * opts.pricePerM, hours: opts.throughput > 0 ? trainingTokens / opts.throughput / 3600 : 0 }

  const counts: Partial<Record<IssueCode, number>> = {}
  const errorSet = new Set<number>(), warnSet = new Set<number>()
  for (const x of issues) {
    counts[x.code] = (counts[x.code] ?? 0) + 1
    if (x.row === undefined) continue
    const sev = ISSUES[x.code].sev
    if (sev === 'error') errorSet.add(x.row)
    if (sev !== 'info') warnSet.add(x.row)
  }
  issues.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.line - b.line)

  return {
    n: rows.length, nTrain: trainIdx.length, nEval: evalIdx.length,
    formats: rows.reduce((m, r) => ({ ...m, [r.format]: (m[r.format] ?? 0) + 1 }), {} as Partial<Record<Format, number>>),
    issues, counts, errorRows: errorSet.size, cleanRows: rows.length - warnSet.size,
    tokens: {
      perRow, total: perRow.reduce((a, b) => a + b, 0), mean: perRow.length ? perRow.reduce((a, b) => a + b, 0) / perRow.length : 0,
      p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted.at(-1) ?? 0, hist: histogram(perRow), overCtx, truncated,
      prompt: toks.reduce((s, t) => s + t.prompt, 0), completion: toks.reduce((s, t) => s + t.completion, 0),
    },
    dup: { exact: dup.exact, near: dup.near, exactExtra: dup.exact.reduce((s, g) => s + g.length - 1, 0), nearExtra: dup.near.reduce((s, g) => s + g.length - 1, 0), pairs: dup.pairs },
    leaks, pii: { byType, rows: piiRows }, refusals, openers,
    lang: { counts: counts_, dominant, perRow: perLang },
    labels: { source: hasField ? 'field' : inferred ? 'inferred' : null, perRow: labelRows, ...bal },
    dpo, cost,
  }
}

/** Small, sync-friendly summary kept on every dataset version. */
export interface Summary { rows: number; train: number; eval: number; tokens: number; errors: number; warnings: number; clean: number; exactDupes: number; nearDupes: number; leaks: number; pii: number; refusals: number; overCtx: number; usd: number; parseErrors: number }
export function summarise(r: Report): Summary {
  const errors = r.issues.filter(i => ISSUES[i.code].sev === 'error').length
  return {
    rows: r.n, train: r.nTrain, eval: r.nEval, tokens: r.tokens.total, errors, warnings: r.issues.filter(i => ISSUES[i.code].sev === 'warn').length, clean: r.cleanRows,
    exactDupes: r.dup.exactExtra, nearDupes: r.dup.nearExtra, leaks: r.leaks.length, pii: r.pii.rows, refusals: r.refusals, overCtx: r.tokens.overCtx, usd: r.cost.usd,
    parseErrors: r.issues.filter(i => i.row === undefined).length,
  }
}
