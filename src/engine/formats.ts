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

const MEDIA_KEY = /^(?:input_)?(?:image|audio|video|file)(?:_url)?$|^document$/
/** The kind of a content part that is not text, or null. A text part says so, or has no type and holds a text. */
function partKind(p: unknown): string | null {
  if (!isObj(p)) return null
  const type = typeof p.type === 'string' ? p.type.trim() : ''
  if (MEDIA_KEY.test(type.toLowerCase())) return type
  // Parts of one column are often padded with nulls, so only a key with a value counts.
  const media = Object.keys(p).find(k => MEDIA_KEY.test(k) && p[k] != null && p[k] !== '')
  if (media) return media
  if (/^(?:input_|output_)?text$/i.test(type)) return null
  const text = p.text ?? p.content
  return text == null || Array.isArray(text) ? type || Object.keys(p)[0] || 'empty' : null
}
/** Kinds of the parts that `contentText` cannot keep. */
function lostParts(c: unknown): string[] | undefined {
  const list = Array.isArray(c) ? c : isObj(c) && MEDIA_KEY.test(str(c.type).toLowerCase()) ? [c] : []
  const kinds = [...new Set(list.map(partKind).filter(k => k !== null))]
  return kinds.length ? kinds : undefined
}

const SHAREGPT_ROLE: Record<string, string> = { human: 'user', user: 'user', gpt: 'assistant', assistant: 'assistant', system: 'system', tool: 'tool', observation: 'tool', function_call: 'assistant' }

/** Maps the role spellings found in the wild onto system/user/assistant/tool. Unknown spellings are returned unchanged. */
export const ROLE_SYNONYMS: Record<string, string> = {
  ...SHAREGPT_ROLE, bot: 'assistant', model: 'assistant', ai: 'assistant', chatgpt: 'assistant', response: 'assistant',
  instruction: 'user', prompt: 'user', question: 'user', customer: 'user', function: 'tool', function_response: 'tool', ipython: 'tool', developer: 'system',
}
export const normaliseRole = (r: string) => ROLE_SYNONYMS[r.trim().toLowerCase()] ?? r

function toMsg(m: unknown): Msg {
  if (!isObj(m)) return { role: '', content: str(m) }
  const out: Msg = { role: str(m.role), content: contentText(m.content) }
  if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls as ToolCall[]
  if (typeof m.tool_call_id === 'string') out.tool_call_id = m.tool_call_id
  if (typeof m.name === 'string') out.name = m.name
  if ('weight' in m) out.weight = m.weight
  if (isObj(m.function_call)) out.function_call = m.function_call
  const lost = lostParts(m.content)
  if (lost) out.lostParts = lost
  return out
}

function sharegptMsg(m: unknown): Msg {
  if (!isObj(m)) return { role: '', content: str(m) }
  const raw = str(m.from ?? m.role).trim()
  const c = m.value ?? m.content, lost = lostParts(c)
  return { role: SHAREGPT_ROLE[raw.toLowerCase()] ?? raw, content: contentText(c), ...(lost ? { lostParts: lost } : {}) }
}

const TRANSCRIPT = /(?:^|\n\n)(Human|Assistant|User|H|A):[ \t]?/g
const TRANSCRIPT_ROLE: Record<string, string> = { Human: 'user', User: 'user', H: 'user', Assistant: 'assistant', A: 'assistant' }

/** Splits an HH-RLHF-style transcript ("\n\nHuman: ...\n\nAssistant: ...") into turns; null when the text is not one. */
export function splitTranscript(s: string): Msg[] | null {
  if (!/^\s*(Human|User|H):/.test(s) || !/\n\n(Assistant|A):/.test(s)) return null
  const marks = [...s.matchAll(TRANSCRIPT)]
  return marks.map((m, i) => ({ role: TRANSCRIPT_ROLE[m[1]], content: s.slice(m.index! + m[0].length, marks[i + 1]?.index ?? s.length).trim() }))
}

/** A string becomes one turn of the given role (or several, if it is a Human/Assistant transcript); an array is read as messages. */
function turns(v: unknown, role: string): Msg[] {
  if (Array.isArray(v)) return v.map(toMsg)
  if (typeof v === 'string') { const t = splitTranscript(v); if (t) return t }
  if (isObj(v) && 'role' in v) return [toMsg(v)]
  const lost = lostParts(v)
  return [{ role, content: contentText(v), ...(lost ? { lostParts: lost } : {}) }]
}

const LABEL_KEYS = ['label', 'class', 'category', 'intent']
/** The class of a record: the first label-like field that holds text or a number. The field itself stays in `extra`, under its own name and type. */
export const pickLabel = (o: Obj) => { for (const k of LABEL_KEYS) if (typeof o[k] === 'string' || typeof o[k] === 'number') return String(o[k]); return undefined }
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
    // input.tools and input.parallel_tool_calls are hoisted to the row and put back on export.
    const inner = extras(o.input, ['messages', ...LABEL_KEYS]) ?? {}
    return { line, format: 'dpo', messages: o.input.messages.map(toMsg), chosen: turns(o.preferred_output, 'assistant'), rejected: turns(o.non_preferred_output, 'assistant'), label, extra: extras({ ...o, ...inner }, ['input', 'preferred_output', 'non_preferred_output']) }
  }
  if ('chosen' in o || 'rejected' in o) {
    // Prompt key varies: prompt (TRL, UltraFeedback), question (Intel orca_dpo_pairs), input/instruction (distilabel, Alpaca-style DPO).
    const pk = ['prompt', 'question', 'input', 'instruction'].find(k => typeof o[k] === 'string' || Array.isArray(o[k]))
    let source = pk ? o[pk] : undefined, promptKeys = [pk ?? 'prompt']
    // Alpaca-style pairs (and CSV) put the task in one field and its input in another; both belong in the user turn, as in SFT rows.
    const tasks = ['prompt', 'question', 'instruction'].filter(k => typeof o[k] === 'string' && o[k].trim())
    if (tasks.length === 1 && typeof source === 'string' && typeof o.input === 'string') {
      const task = o[tasks[0]] as string, input = o.input.trim()
      const joined = !input || task.trim() === input || task.includes('\n' + input) ? task : splitTranscript(task) || splitTranscript(o.input) ? null : task + '\n\n' + o.input
      if (joined !== null) { source = joined; promptKeys = [tasks[0], 'input'] }
    }
    const prompt = pk ? turns(source, 'user') : Array.isArray(o.messages) ? o.messages.map(toMsg) : []
    if ('system' in o && typeof o.system === 'string' && o.system) prompt.unshift({ role: 'system', content: o.system })
    let chosen = turns(o.chosen, 'assistant'), rejected = turns(o.rejected, 'assistant')
    const same = (a: Msg, b: Msg) => a.role === b.role && a.content.trim() === b.content.trim()
    // Some exports repeat the prompt at the start of chosen and rejected (UltraFeedback); drop the repeat.
    let p = 0
    while (p < prompt.length && p < chosen.length - 1 && p < rejected.length - 1 && same(prompt[p], chosen[p]) && same(prompt[p], rejected[p])) p++
    if (p === prompt.length && p > 0) { chosen = chosen.slice(p); rejected = rejected.slice(p) }
    // Others put the whole conversation in chosen/rejected (HH-RLHF); the shared prefix is the prompt.
    if (!prompt.some(m => m.role !== 'system') && chosen.length > 1 && rejected.length > 1) {
      let k = 0
      while (k < chosen.length - 1 && k < rejected.length - 1 && same(chosen[k], rejected[k])) k++
      prompt.push(...chosen.slice(0, k)); chosen = chosen.slice(k); rejected = rejected.slice(k)
    }
    return { line, format: 'dpo', messages: prompt, chosen, rejected, label, extra: extras(o, [...promptKeys, 'messages', 'chosen', 'rejected', 'system']) }
  }
  if (Array.isArray(o.messages)) return { line, format: 'openai', messages: o.messages.map(toMsg), label, extra: extras(o, ['messages']) }
  if (Array.isArray(o.conversations)) {
    const messages = o.conversations.map(sharegptMsg)
    if (typeof o.system === 'string' && o.system) messages.unshift({ role: 'system', content: o.system })
    return { line, format: 'sharegpt', messages, label, extra: extras(o, ['conversations', 'system']) }
  }
  const instr = o.instruction ?? o.prompt ?? o.question
  const out = o.output ?? o.completion ?? o.response ?? o.answer
  if (instr !== undefined && out !== undefined) {
    const messages: Msg[] = []
    if (typeof o.system === 'string' && o.system) messages.push({ role: 'system', content: o.system })
    const input = str(o.input ?? '')
    // Answers may well be JSON, so only known media parts count in these fields.
    const media = (...vs: unknown[]) => { const l = vs.flatMap(v => lostParts(v) ?? []).filter(k => MEDIA_KEY.test(k.toLowerCase())); return l.length ? { lostParts: [...new Set(l)] } : {} }
    messages.push({ role: 'user', content: str(instr) + (input.trim() ? '\n\n' + input : ''), ...media(instr, o.input) })
    messages.push({ role: 'assistant', content: str(out), ...media(out) })
    return { line, format: 'alpaca', messages, label, extra: extras(o, ['instruction', 'prompt', 'question', 'input', 'output', 'completion', 'response', 'answer', 'system']) }
  }
  return null
}

// ---------- CSV ----------

/** `openQuote`: start line of a last record whose quoted field never closes; it has swallowed the rest of the file. `badQuotes`: start lines of records with text after a closing quote. */
export interface Csv { rows: string[][]; lines: number[]; openQuote?: number; badQuotes?: Set<number> }

/** RFC 4180 CSV with quoted fields and embedded newlines. Returns rows and the source line each starts on. */
export function parseCsv(text: string): Csv {
  const rows: string[][] = [], lines: number[] = []
  const delim = (text.split('\n', 1)[0].match(/\t/g)?.length ?? 0) > (text.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  let row: string[] = [], field = '', q = false, closed = false, line = 1, start = 1
  const badQuotes = new Set<number>()
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else { q = false; closed = true } }
      else { if (c === '\n') line++; field += c }
    } else if (c === '"' && field === '' && !closed) q = true
    else if (c === delim) { row.push(field); field = ''; closed = false }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''; closed = false
      if (row.some(f => f !== '')) { rows.push(row); lines.push(start) }
      row = []; line++; start = line
    } else {
      if (closed && c.trim()) badQuotes.add(start)
      field += c
    }
  }
  row.push(field)
  if (q) return { rows, lines, badQuotes, openQuote: start }
  if (row.some(f => f !== '')) { rows.push(row); lines.push(start) }
  return { rows, lines, badQuotes }
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

export function csvToRecords(csv: Csv, map: CsvMapping): { records: { obj: unknown; line: number }[]; errors: Issue[] } {
  const records: { obj: unknown; line: number }[] = [], errors: Issue[] = []
  const col = (r: CsvRole) => map.indexOf(r)
  for (let i = 0; i < csv.rows.length; i++) {
    const r = csv.rows[i], line = csv.lines[i]
    if (csv.badQuotes?.has(line)) { errors.push({ line, code: 'bad_csv', message: 'There is text after a closing double quote in this record. Write quotes inside quoted text as "".' }); continue }
    if (i === 0) continue
    if (r.slice(csv.rows[0].length).some(f => f.trim())) { errors.push({ line, code: 'bad_csv', message: `This record has ${r.length} fields but the header has ${csv.rows[0].length}. Put double quotes around text that contains the separator.` }); continue }
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
  if (csv.openQuote !== undefined) errors.push({ line: csv.openQuote, code: 'bad_csv', message: 'A double quote in the record that starts here is never closed, so the rest of the file could not be read.' })
  return { records, errors }
}

/** One CSV cell as text: quoted when it has to be, and never read as a formula by a spreadsheet. */
export const csvCell = (v: string) => {
  const t = /^\s*[=+\-@]/.test(v) || /^[\t\r\n]/.test(v) ? "'" + v : v
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

// ---------- File names ----------

const TRAIN_WORD = /^train(?:ing)?(?:set|data|split)?$/i
const EVAL_WORD = /^(?:eval(?:s|uation|uations)?|valid(?:ation)?|val|tests?|testing|dev)(?:set|data|split)?$/i

/** Whether a file name says evaluation data. Only whole words count ("support_eval.jsonl", "evalSet2.csv"; not "retrieval"), and a name that says train is train. */
export function guessSplit(name: string): 'train' | 'eval' {
  const words = name.replace(/(\p{Ll})(?=\p{Lu})|(\p{Lu})(?=\p{Lu}\p{Ll})/gu, '$1$2 ').split(/[^\p{L}\p{M}]+/u)
  return !words.some(w => TRAIN_WORD.test(w)) && words.some(w => EVAL_WORD.test(w)) ? 'eval' : 'train'
}

// ---------- Whole-file parse ----------

export interface Parsed { rows: Row[]; errors: Issue[]; formats: Partial<Record<Format, number>>; kind: 'jsonl' | 'json' | 'csv'; csv?: Csv }

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
  if (m.function_call) o.function_call = m.function_call
  if (m.weight !== undefined) o.weight = m.weight
  return o
}
const SHARE_FROM: Record<string, string> = { user: 'human', assistant: 'gpt', system: 'system', tool: 'tool' }

/** Converts one row to the target shape, or returns a reason it cannot be represented there. */
export function convert(r: Row, target: Target): Obj | { skip: string } {
  if ([...r.messages, ...(r.chosen ?? []), ...(r.rejected ?? [])].some(m => m.lostParts)) return { skip: 'image, audio and other non-text parts are not kept' }
  // Rows stored by earlier versions have the label only as text.
  const keep = { ...(r.extra ?? {}), ...(r.label !== undefined && pickLabel(r.extra ?? {}) === undefined ? { label: r.label } : {}) }
  const isPref = r.format === 'dpo'
  if (target === 'trl-dpo') {
    if (!isPref) return { skip: 'not a preference pair' }
    return { ...keep, prompt: r.messages.map(plain), chosen: (r.chosen ?? []).map(plain), rejected: (r.rejected ?? []).map(plain) }
  }
  if (isPref) {
    if (target !== 'openai') return { skip: 'preference pairs export to OpenAI or TRL format' }
    const { tools, parallel_tool_calls, ...rest } = keep as Obj
    const input: Obj = { messages: r.messages.map(plain) }
    if (tools !== undefined) input.tools = tools
    if (parallel_tool_calls !== undefined) input.parallel_tool_calls = parallel_tool_calls
    return { ...rest, input, preferred_output: (r.chosen ?? []).map(plain), non_preferred_output: (r.rejected ?? []).map(plain) }
  }
  if (target === 'openai') return { ...keep, messages: r.messages.map(plain) }
  const name = target === 'sharegpt' ? 'ShareGPT' : 'Alpaca'
  if (r.messages.some(m => m.tool_calls?.length)) return { skip: `tool calls have no standard ${name} form` }
  if (r.messages.some(m => m.function_call)) return { skip: `function calls have no standard ${name} form` }
  // A weight of 1 (or none) is what every turn has there anyway.
  if (r.messages.some(m => m.weight != null && m.weight !== 1)) return { skip: `turn weights other than 1 have no ${name} form` }
  if (target === 'sharegpt') {
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
