// Finds and strips personal data over everything a row exports: all turns (system prompts too), call arguments,
// the label and kept fields. Scanning and stripping walk the row with the same function, so they cannot disagree.
import { PLACEHOLDER, scanPii, type PiiHit } from './content.ts'
import type { Msg, Row } from './types.ts'

/** Receives every text in the row and returns its replacement. `idLike` marks values stored under an id-like key. */
type Visit = (s: string, idLike?: boolean) => string

const ID_KEY = /(?:^|[_-])(?:id|ids|uuid|guid|hash|sha\d*)$/i

/** Rewrites the strings and numbers inside JSON text in place, so numbers that are not touched keep every digit. */
function visitJson(text: string, f: Visit): string {
  try { JSON.parse(text) } catch { return f(text) }
  return text.replace(/"(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*/g, lit => {
    const s = lit[0] === '"' ? JSON.parse(lit) as string : lit
    const out = f(s)
    return out === s ? lit : JSON.stringify(out)
  })
}

function visitDeep(v: unknown, f: Visit, idLike = false): unknown {
  if (typeof v === 'string') return f(v, idLike)
  if (Array.isArray(v)) return v.map(x => visitDeep(x, f, idLike))
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visitDeep(x, f, ID_KEY.test(k))]))
  return v
}

const visitArgs = (a: unknown, f: Visit) => typeof a === 'string' ? visitJson(a, f) : visitDeep(a, f)

function visitMsg(m: Msg, f: Visit): Msg {
  const out: Msg = { ...m, content: f(m.content) }
  // Call ids, types and function names stay as they are: they link calls to results and to the tool list.
  if (m.tool_calls) out.tool_calls = m.tool_calls.map(c => c?.function && 'arguments' in c.function ? { ...c, function: { ...c.function, arguments: visitArgs(c.function.arguments, f) } } : c)
  if (m.function_call && 'arguments' in m.function_call) out.function_call = { ...m.function_call, arguments: visitArgs(m.function_call.arguments, f) }
  return out
}

function visitRow(r: Row, f: Visit): Row {
  const out: Row = { ...r, messages: r.messages.map(m => visitMsg(m, f)) }
  if (r.chosen) out.chosen = r.chosen.map(m => visitMsg(m, f))
  if (r.rejected) out.rejected = r.rejected.map(m => visitMsg(m, f))
  if (r.label !== undefined) out.label = f(r.label)
  if (r.extra) out.extra = visitDeep(r.extra, f) as Record<string, unknown>
  return out
}

// Digits in an id are not phone or card numbers; an email or key stored as an id still counts.
const hitsOf = (s: string, idLike?: boolean) => idLike ? scanPii(s).filter(h => h.type === 'email' || h.type === 'secret') : scanPii(s)

export function rowPii(r: Row): PiiHit[] {
  const hits: PiiHit[] = []
  visitRow(r, (s, id) => { hits.push(...hitsOf(s, id)); return s })
  return hits
}

export function redactRow(r: Row): { row: Row; count: number } {
  let count = 0
  const row = visitRow(r, (s, id) => {
    let out = '', at = 0
    for (const h of hitsOf(s, id)) { out += s.slice(at, h.start) + PLACEHOLDER[h.type]; at = h.end; count++ }
    return out + s.slice(at)
  })
  return count ? { row, count } : { row: r, count }
}
