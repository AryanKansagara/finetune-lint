// Reading, detecting and writing the four dataset shapes people actually upload.
import type { Format, Issue, Msg, Row, ToolCall } from './types.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)

/** OpenAI content may be a string, null (tool calls) or an array of parts. */
function contentText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(p => isObj(p) ? str(p.text ?? p.content ?? '') : str(p)).join('')
  return c == null ? '' : str(c)
}

const SHAREGPT_ROLE: Record<string, string> = { human: 'user', user: 'user', gpt: 'assistant', assistant: 'assistant', system: 'system', tool: 'tool', observation: 'tool', function_call: 'assistant' }

/** Maps the role spellings found in the wild onto system/user/assistant/tool. Unknown spellings are returned unchanged. */
export const ROLE_SYNONYMS: Record<string, string> = {
  ...SHAREGPT_ROLE, bot: 'assistant', model: 'assistant', ai: 'assistant', chatgpt: 'assistant', claude: 'assistant', response: 'assistant',
  instruction: 'user', prompt: 'user', question: 'user', customer: 'user', function: 'tool', function_response: 'tool', ipython: 'tool', developer: 'system',
}
export const normaliseRole = (r: string) => ROLE_SYNONYMS[r.trim().toLowerCase()] ?? r

function toMsg(m: unknown): Msg {
  if (!isObj(m)) return { role: '', content: str(m) }
  const out: Msg = { role: str(m.role), content: contentText(m.content) }
  if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls as ToolCall[]
  if (typeof m.tool_call_id === 'string') out.tool_call_id = m.tool_call_id
  if (typeof m.name === 'string') out.name = m.name
  return out
}

function sharegptMsg(m: unknown): Msg {
  if (!isObj(m)) return { role: '', content: str(m) }
  const raw = str(m.from ?? m.role).trim()
  return { role: SHAREGPT_ROLE[raw.toLowerCase()] ?? raw, content: contentText(m.value ?? m.content) }
}

/** A string becomes one turn of the given role; an array is read as messages. */
function turns(v: unknown, role: string): Msg[] {
  if (Array.isArray(v)) return v.map(toMsg)
  if (isObj(v) && 'role' in v) return [toMsg(v)]
  return [{ role, content: contentText(v) }]
}

const LABEL_KEYS = ['label', 'class', 'category', 'intent']
const pickLabel = (o: Obj) => { for (const k of LABEL_KEYS) if (typeof o[k] === 'string' || typeof o[k] === 'number') return String(o[k]); return undefined }
function extras(o: Obj, used: string[]) {
  const e: Obj = {}
  for (const k of Object.keys(o)) if (!used.includes(k)) e[k] = o[k]
  return Object.keys(e).length ? e : undefined
}

/** Detects the shape of one parsed record and normalises it. Returns null when the shape is not recognised. */
export function normalise(o: unknown, line: number): Row | null {
  if (!isObj(o)) return null
  const label = pickLabel(o)
  // OpenAI preference fine-tuning: { input: { messages }, preferred_output, non_preferred_output }
  if (isObj(o.input) && Array.isArray(o.input.messages) && 'preferred_output' in o) {
    return { line, format: 'dpo', messages: o.input.messages.map(toMsg), chosen: turns(o.preferred_output, 'assistant'), rejected: turns(o.non_preferred_output, 'assistant'), label, extra: extras(o, ['input', 'preferred_output', 'non_preferred_output', ...LABEL_KEYS]) }
  }
  if ('chosen' in o || 'rejected' in o) {
    const prompt = 'prompt' in o ? turns(o.prompt, 'user') : Array.isArray(o.messages) ? o.messages.map(toMsg) : []
    if ('system' in o && typeof o.system === 'string' && o.system) prompt.unshift({ role: 'system', content: o.system })
    let chosen = turns(o.chosen, 'assistant'), rejected = turns(o.rejected, 'assistant')
    // Some exports put the whole conversation in chosen/rejected with the prompt repeated; strip the shared prefix.
    if (!prompt.length && chosen.length > 1 && rejected.length > 1) {
      let k = 0
      while (k < chosen.length - 1 && k < rejected.length - 1 && chosen[k].role === rejected[k].role && chosen[k].content === rejected[k].content) k++
      prompt.push(...chosen.slice(0, k)); chosen = chosen.slice(k); rejected = rejected.slice(k)
    }
    return { line, format: 'dpo', messages: prompt, chosen, rejected, label, extra: extras(o, ['prompt', 'messages', 'chosen', 'rejected', 'system', ...LABEL_KEYS]) }
  }
  if (Array.isArray(o.messages)) return { line, format: 'openai', messages: o.messages.map(toMsg), label, extra: extras(o, ['messages', ...LABEL_KEYS]) }
  if (Array.isArray(o.conversations)) {
    const messages = o.conversations.map(sharegptMsg)
    if (typeof o.system === 'string' && o.system) messages.unshift({ role: 'system', content: o.system })
    return { line, format: 'sharegpt', messages, label, extra: extras(o, ['conversations', 'system', ...LABEL_KEYS]) }
  }
  const instr = o.instruction ?? o.prompt ?? o.question
  const out = o.output ?? o.completion ?? o.response ?? o.answer
  if (instr !== undefined && out !== undefined) {
    const messages: Msg[] = []
    if (typeof o.system === 'string' && o.system) messages.push({ role: 'system', content: o.system })
    const input = str(o.input ?? '')
    messages.push({ role: 'user', content: str(instr) + (input.trim() ? '\n\n' + input : '') })
    messages.push({ role: 'assistant', content: str(out) })
    return { line, format: 'alpaca', messages, label, extra: extras(o, ['instruction', 'prompt', 'question', 'input', 'output', 'completion', 'response', 'answer', 'system', ...LABEL_KEYS]) }
  }
  return null
}

// ---------- CSV ----------

/** RFC 4180 CSV with quoted fields and embedded newlines. Returns rows and the source line each starts on. */
export function parseCsv(text: string): { rows: string[][]; lines: number[] } {
  const rows: string[][] = [], lines: number[] = []
  const delim = (text.split('\n', 1)[0].match(/\t/g)?.length ?? 0) > (text.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  let row: string[] = [], field = '', q = false, line = 1, start = 1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else { if (c === '\n') line++; field += c }
    } else if (c === '"' && field === '') q = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) { rows.push(row); lines.push(start) }
      row = []; line++; start = line
    } else field += c
  }
  row.push(field)
  if (row.some(f => f !== '')) { rows.push(row); lines.push(start) }
  return { rows, lines }
}

export type CsvRole = 'system' | 'user' | 'input' | 'assistant' | 'chosen' | 'rejected' | 'label' | 'messages' | 'ignore'
export type CsvMapping = CsvRole[]
const CSV_GUESS: [RegExp, CsvRole][] = [
  [/^(messages|conversation|conversations|chat)$/i, 'messages'],
  [/^(system|system_prompt|sys)$/i, 'system'],
  [/^(instruction|prompt|question|query|user|input_text|human)$/i, 'user'],
  [/^(input|context)$/i, 'input'],
  [/^(output|completion|response|answer|assistant|reply|target|gpt)$/i, 'assistant'],
  [/^(chosen|preferred|accepted|winner)$/i, 'chosen'],
  [/^(rejected|dispreferred|non_preferred|loser)$/i, 'rejected'],
  [/^(label|class|category|intent)$/i, 'label'],
]
export const guessCsvMapping = (header: string[]): CsvMapping => header.map(h => CSV_GUESS.find(([re]) => re.test(h.trim()))?.[1] ?? 'ignore')

export function csvToRecords(csv: { rows: string[][]; lines: number[] }, map: CsvMapping): { records: { obj: unknown; line: number }[]; errors: Issue[] } {
  const records: { obj: unknown; line: number }[] = [], errors: Issue[] = []
  const col = (r: CsvRole) => map.indexOf(r)
  for (let i = 1; i < csv.rows.length; i++) {
    const r = csv.rows[i], line = csv.lines[i]
    const get = (role: CsvRole) => { const c = col(role); return c >= 0 ? (r[c] ?? '') : undefined }
    const o: Obj = {}
    const m = get('messages')
    if (m !== undefined) {
      try { const v = JSON.parse(m); o[Array.isArray(v) && isObj(v[0]) && 'from' in v[0] ? 'conversations' : 'messages'] = v } catch { errors.push({ line, code: 'invalid_json', message: 'The messages column is not valid JSON.' }); continue }
    }
    if (get('system')) o.system = get('system')
    if (get('user') !== undefined) o.prompt = get('user')
    if (get('input')) o.input = get('input')
    if (get('chosen') !== undefined) { o.chosen = get('chosen'); o.rejected = get('rejected') ?? '' }
    else if (get('assistant') !== undefined) o.output = get('assistant')
    if (get('label')) o.label = get('label')
    records.push({ obj: o, line })
  }
  return { records, errors }
}

// ---------- Whole-file parse ----------

export interface Parsed { rows: Row[]; errors: Issue[]; formats: Partial<Record<Format, number>>; kind: 'jsonl' | 'json' | 'csv'; csv?: { rows: string[][]; lines: number[] } }

export function parseRecords(records: { obj: unknown; line: number }[], errors: Issue[] = []): Pick<Parsed, 'rows' | 'errors' | 'formats'> {
  const rows: Row[] = [], formats: Partial<Record<Format, number>> = {}
  for (const { obj, line } of records) {
    const r = normalise(obj, line)
    if (!r) { errors.push({ line, code: 'unknown_shape', message: `Expected messages, conversations, instruction/output or prompt/chosen/rejected; found keys: ${isObj(obj) ? Object.keys(obj).slice(0, 6).join(', ') || 'none' : typeof obj}.` }); continue }
    rows.push(r)
    formats[r.format] = (formats[r.format] ?? 0) + 1
  }
  return { rows, errors, formats }
}

/** Parses JSONL, a JSON array, or CSV (with a column mapping). Bad lines are reported with their line number, never dropped silently. */
export function parseText(text: string, csvMap?: CsvMapping): Parsed {
  const t = text.replace(/^﻿/, '')
  const head = t.trimStart()
  if (head.startsWith('[')) {
    try {
      const arr = JSON.parse(t)
      if (Array.isArray(arr)) return { kind: 'json', ...parseRecords(arr.map((obj, i) => ({ obj, line: i + 1 }))) }
    } catch { /* fall through: maybe JSONL whose first record is an array */ }
  }
  if (head.startsWith('{') || head.startsWith('[')) {
    const records: { obj: unknown; line: number }[] = [], errors: Issue[] = []
    const lines = t.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim()
      if (!s) continue
      try { records.push({ obj: JSON.parse(s), line: i + 1 }) } catch (e) {
        errors.push({ line: i + 1, code: 'invalid_json', message: `Not valid JSON: ${(e instanceof Error ? e.message : String(e)).replace(/^JSON\.parse: |^Unexpected token/, m => m.startsWith('JSON') ? '' : m).slice(0, 90)}` })
      }
    }
    return { kind: 'jsonl', ...parseRecords(records, errors) }
  }
  const csv = parseCsv(t)
  const map = csvMap ?? guessCsvMapping(csv.rows[0] ?? [])
  const { records, errors } = csvToRecords(csv, map)
  return { kind: 'csv', csv, ...parseRecords(records, errors) }
}

// ---------- Export ----------

export type Target = 'openai' | 'sharegpt' | 'alpaca' | 'trl-dpo'
export const TARGET_LABEL: Record<Target, string> = { openai: 'OpenAI chat JSONL (also Fireworks, Together, Axolotl chat_template)', sharegpt: 'ShareGPT JSONL', alpaca: 'Alpaca JSONL (single-turn only)', 'trl-dpo': 'TRL preference JSONL (prompt / chosen / rejected)' }

const plain = (m: Msg) => {
  const o: Obj = { role: m.role, content: m.content }
  if (m.tool_calls) o.tool_calls = m.tool_calls
  if (m.tool_call_id) o.tool_call_id = m.tool_call_id
  if (m.name) o.name = m.name
  return o
}
const SHARE_FROM: Record<string, string> = { user: 'human', assistant: 'gpt', system: 'system', tool: 'tool' }

/** Converts one row to the target shape, or returns a reason it cannot be represented there. */
export function convert(r: Row, target: Target): Obj | { skip: string } {
  const keep = { ...(r.extra ?? {}), ...(r.label !== undefined ? { label: r.label } : {}) }
  const isPref = r.format === 'dpo'
  if (target === 'trl-dpo') {
    if (!isPref) return { skip: 'not a preference pair' }
    return { ...keep, prompt: r.messages.map(plain), chosen: (r.chosen ?? []).map(plain), rejected: (r.rejected ?? []).map(plain) }
  }
  if (isPref) {
    if (target !== 'openai') return { skip: 'preference pairs export to OpenAI or TRL format' }
    return { ...keep, input: { messages: r.messages.map(plain) }, preferred_output: (r.chosen ?? []).map(plain), non_preferred_output: (r.rejected ?? []).map(plain) }
  }
  if (target === 'openai') return { ...keep, messages: r.messages.map(plain) }
  if (target === 'sharegpt') {
    if (r.messages.some(m => m.tool_calls?.length)) return { skip: 'tool calls have no standard ShareGPT form' }
    return { ...keep, conversations: r.messages.map(m => ({ from: SHARE_FROM[m.role] ?? m.role, value: m.content })) }
  }
  const sys = r.messages.filter(m => m.role === 'system')
  const rest = r.messages.filter(m => m.role !== 'system')
  if (rest.length !== 2 || rest[0].role !== 'user' || rest[1].role !== 'assistant') return { skip: 'multi-turn conversations do not fit Alpaca' }
  return { ...keep, ...(sys.length ? { system: sys.map(m => m.content).join('\n\n') } : {}), instruction: rest[0].content, input: '', output: rest[1].content }
}

export function toJsonl(rows: Row[], target: Target): { text: string; written: number; skipped: { line: number; reason: string }[] } {
  const out: string[] = [], skipped: { line: number; reason: string }[] = []
  for (const r of rows) {
    const c = convert(r, target)
    if ('skip' in c && typeof c.skip === 'string' && Object.keys(c).length === 1) skipped.push({ line: r.line, reason: c.skip })
    else out.push(JSON.stringify(c))
  }
  return { text: out.join('\n') + (out.length ? '\n' : ''), written: out.length, skipped }
}
