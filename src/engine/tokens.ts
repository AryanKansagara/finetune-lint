// Tokenizer-free token estimate that mimics byte-level BPE (GPT-4 / Llama 3 family).
// Text is pre-split with the same kind of regex those tokenizers use (words with their leading space,
// 1-3 digit number chunks, punctuation runs, whitespace), then each piece is charged by length and script.
// Measured against tiktoken cl100k_base: 2.9% mean absolute error per turn and +1.8% on the total for the
// synthetic support chats; 6.5% per document and +3.4% in total on 72 README files (markdown, URLs, code).
// Against o200k_base: 4.4% per turn. Expect wider error on CJK, emoji-heavy text and minified code.
import type { Msg, Row } from './types.ts'

export const PRE = /'(?:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/giu
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/u

function letters(w: string): number {
  if (/^[a-z]+$/.test(w)) return w.length <= 8 ? 1 : 1 + Math.ceil((w.length - 8) / 6)
  if (/^[A-Za-z]+$/.test(w)) {
    // Capitalised words merge like lowercase ones; ALL CAPS splits more; camelCase is charged per hump.
    if (/^[A-Z][a-z]+$/.test(w)) return w.length <= 7 ? 1 : 1 + Math.ceil((w.length - 7) / 5)
    if (/^[A-Z]+$/.test(w)) return w.length <= 5 ? 1 : Math.ceil(w.length / 3)
    const humps = w.split(/(?=[A-Z][a-z])/)
    return humps.length > 1 ? humps.reduce((s, h) => s + letters(h), 0) : Math.ceil(w.length / 2.5)
  }
  let n = 0, latin = 0
  for (const ch of w) {
    if (CJK.test(ch)) n += 1
    else if (ch.charCodeAt(0) < 0x250) latin++
    else n += 0.5
  }
  return Math.max(1, Math.round(n + (latin ? Math.ceil(latin / 3.5) : 0)))
}

export function countTokens(s: string): number {
  if (!s) return 0
  let n = 0
  for (const m of s.matchAll(PRE)) {
    const p = m[0]
    if (/^\s+$/.test(p)) {
      const nl = p.replace(/[^\n]/g, '').length || p.replace(/[^\r]/g, '').length
      const sp = p.replace(/[\r\n]/g, '').length
      n += nl ? Math.ceil(nl / 2) + (sp && !/[\r\n]$/.test(p) ? 1 : 0) : Math.ceil(sp / 8)
      continue
    }
    // A punctuation mark glued to a word ("/babel", ".npmjs") usually costs part of an extra token.
    const glued = p.length > 1 && /^[^\p{L}\p{N}\s]\p{L}/u.test(p)
    const body = glued || (p[0] === ' ' && p.length > 1) ? p.slice(1) : p
    if (/^\p{N}+$/u.test(body)) n += 1
    else if (/^\p{L}+$/u.test(body)) n += letters(body) + (glued ? 0.4 : 0)
    else if (/^'/.test(p) && p.length <= 3) n += 1
    else {
      // Punctuation runs merge well (://, ```, **:); trailing newlines and non-ASCII symbols add to it.
      const cs = [...body.replace(/[\r\n]+$/, '')]
      n += Math.max(1, Math.ceil(cs.length / 3)) + cs.filter(c => c.charCodeAt(0) > 0x2000).length + (/[\r\n]$/.test(body) ? 1 : 0)
    }
  }
  return Math.round(n)
}

/** Chat-template overhead: role header and end-of-turn markers (Llama 3 uses about 4 per turn, ChatML 4-5), plus BOS. */
export const PER_TURN = 4
export const PER_EXAMPLE = 1

export const msgTokens = (m: Msg) => PER_TURN + countTokens(m.content) + (m.tool_calls?.length ? countTokens(JSON.stringify(m.tool_calls)) : 0)
export const turnsTokens = (ms: Msg[] | undefined) => (ms ?? []).reduce((s, m) => s + msgTokens(m), 0)

/** Tokens the trainer sees for one example. For preference pairs, prompt + the longer response (each side is a separate sequence). */
export function rowTokens(r: Row): { total: number; prompt: number; completion: number } {
  if (r.format === 'dpo') {
    const prompt = PER_EXAMPLE + turnsTokens(r.messages)
    const c = turnsTokens(r.chosen), j = turnsTokens(r.rejected)
    return { total: prompt + Math.max(c, j), prompt, completion: Math.max(c, j) }
  }
  const lastA = r.messages.at(-1)?.role === 'assistant' ? msgTokens(r.messages.at(-1)!) : 0
  const total = PER_EXAMPLE + turnsTokens(r.messages)
  return { total, prompt: total - lastA, completion: lastA }
}

/** Training tokens billed for a preference pair: both sequences (prompt + chosen, prompt + rejected) go through the model. */
export function billedTokens(r: Row, ctx: number): number {
  if (r.format === 'dpo') {
    const p = PER_EXAMPLE + turnsTokens(r.messages)
    return Math.min(ctx, p + turnsTokens(r.chosen)) + Math.min(ctx, p + turnsTokens(r.rejected))
  }
  return Math.min(ctx, rowTokens(r).total)
}
