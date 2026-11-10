// Structural checks that make a fine-tuning job reject a file or silently learn the wrong thing.
import { STANDARD_ROLES, type Issue, type Msg, type Row } from './types.ts'

const STD = new Set<string>(STANDARD_ROLES)

function checkTurns(msgs: Msg[], line: number, out: Issue[], where = '') {
  const callIds = new Set<string>()
  msgs.forEach((m, i) => {
    const t = i + 1
    if (!STD.has(m.role)) out.push({ line, turn: t, code: 'bad_role', message: `Turn ${t}${where} has role "${m.role || '(missing)'}"; expected system, user, assistant or tool.` })
    if (!m.content.trim() && !m.tool_calls?.length) out.push({ line, turn: t, code: 'empty_turn', message: `Turn ${t}${where} (${m.role || 'no role'}) is empty.` })
    if (m.role === 'system' && i > 0) out.push({ line, turn: t, code: 'system_not_first', message: `System prompt at turn ${t}${where}; most chat templates only accept it first.` })
    if (i > 0 && m.role === msgs[i - 1].role && m.role !== 'tool' && STD.has(m.role)) out.push({ line, turn: t, code: 'consecutive_roles', message: `Turns ${t - 1} and ${t}${where} are both ${m.role}.` })
    for (const [k, c] of (m.tool_calls ?? []).entries()) {
      const name = c?.function?.name, args = c?.function?.arguments
      const bad = (why: string) => out.push({ line, turn: t, code: 'tool_schema', message: `Turn ${t}${where}, tool call ${k + 1}: ${why}` })
      if (m.role !== 'assistant') bad('only assistant turns may make tool calls.')
      if (typeof name !== 'string' || !name) bad('function.name is missing.')
      if (typeof args !== 'string') bad('function.arguments must be a JSON-encoded string.')
      else { try { JSON.parse(args) } catch { bad('function.arguments is not valid JSON.') } }
      if (c?.type !== undefined && c.type !== 'function') bad(`type is "${String(c.type)}", expected "function".`)
      if (typeof c?.id === 'string') callIds.add(c.id)
      else bad('id is missing, so tool results cannot be matched to it.')
    }
    if (m.role === 'tool') {
      if (!m.tool_call_id) out.push({ line, turn: t, code: 'tool_schema', message: `Turn ${t}${where} is a tool result without tool_call_id.` })
      else if (!callIds.has(m.tool_call_id)) out.push({ line, turn: t, code: 'tool_schema', message: `Turn ${t}${where} answers tool_call_id "${m.tool_call_id}", which no earlier assistant turn made.` })
    }
  })
}

export function validateRow(r: Row): Issue[] {
  const out: Issue[] = [], line = r.line
  if (r.format === 'dpo') {
    checkTurns(r.messages, line, out, ' of the prompt')
    if (!r.messages.some(m => m.role === 'user')) out.push({ line, code: 'no_user', message: 'The prompt has no user turn.' })
    for (const [k, side] of [['chosen', r.chosen], ['rejected', r.rejected]] as const) {
      if (!side?.length || side.every(m => !m.content.trim() && !m.tool_calls?.length)) out.push({ line, code: 'dpo_missing', message: `The ${k} response is missing or empty.` })
      else {
        checkTurns(side, line, out, ` of ${k}`)
        if (side.at(-1)!.role !== 'assistant') out.push({ line, code: 'no_assistant_final', message: `The ${k} response does not end on an assistant turn.` })
      }
    }
    return out
  }
  if (!r.messages.length) return [{ line, code: 'empty_conversation', message: 'The conversation has no turns.' }]
  checkTurns(r.messages, line, out)
  if (!r.messages.some(m => m.role === 'user')) out.push({ line, code: 'no_user', message: 'There is no user turn to learn from.' })
  const last = r.messages.at(-1)!
  if (last.role !== 'assistant') out.push({ line, turn: r.messages.length, code: 'no_assistant_final', message: `Ends on a ${last.role || 'roleless'} turn; the last turn is what the model is trained to produce, so it should be the assistant.` })
  return out
}

/** Rows with an error-severity structural problem; fine-tuning services reject these. */
export const BLOCKING = new Set(['bad_role', 'empty_turn', 'no_user', 'no_assistant_final', 'tool_schema', 'dpo_missing', 'empty_conversation'])
