export interface ToolCall { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
/** `weight` (0 or 1) is OpenAI's per-turn training mask; `function_call` is the legacy single-call form. Both are kept for export. */
export interface Msg { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string; weight?: unknown; function_call?: { name?: unknown; arguments?: unknown } }

export type Format = 'openai' | 'sharegpt' | 'alpaca' | 'dpo'
export const FORMAT_LABEL: Record<Format, string> = {
  openai: 'OpenAI chat (messages)',
  sharegpt: 'ShareGPT (conversations)',
  alpaca: 'Alpaca (instruction / input / output)',
  dpo: 'Preference (prompt / chosen / rejected)',
}

/** One training example, normalised. SFT rows use `messages`; DPO rows use `messages` as the prompt plus chosen/rejected. */
export interface Row {
  /** 1-based line (JSONL) or record start line (CSV) in the source file */
  line: number
  format: Format
  messages: Msg[]
  chosen?: Msg[]
  rejected?: Msg[]
  /** The class as text, when the source has a label field (the field itself is in `extra`) */
  label?: string
  /** Fields kept as they are on export (id, tools, metadata, label fields) */
  extra?: Record<string, unknown>
  /** Which side of the train/eval split the row is on (imported eval files, or a generated split) */
  split?: 'train' | 'eval'
  /** Source file name, for line references across several imports */
  file?: string
}

export type Severity = 'error' | 'warn' | 'info'
export interface Issue { line: number; code: IssueCode; message: string; turn?: number; /** Index into the rows array (absent for lines that could not be parsed) */ row?: number; file?: string }

export const ISSUES = {
  invalid_json: { sev: 'error', label: 'Invalid JSON' },
  bad_csv: { sev: 'error', label: 'Malformed CSV' },
  unknown_shape: { sev: 'error', label: 'Unrecognised record shape' },
  empty_conversation: { sev: 'error', label: 'No turns' },
  bad_role: { sev: 'error', label: 'Unknown role' },
  empty_turn: { sev: 'error', label: 'Empty turn' },
  no_user: { sev: 'error', label: 'No user turn' },
  no_assistant_final: { sev: 'error', label: 'Does not end on an assistant turn' },
  tool_schema: { sev: 'error', label: 'Tool-call schema' },
  dpo_missing: { sev: 'error', label: 'Missing chosen or rejected' },
  bad_weight: { sev: 'error', label: 'Invalid turn weight' },
  nothing_to_learn: { sev: 'warn', label: 'Every assistant turn has weight 0' },
  system_not_first: { sev: 'warn', label: 'System prompt not first' },
  consecutive_roles: { sev: 'warn', label: 'Same role twice in a row' },
  over_context: { sev: 'warn', label: 'Longer than the context window' },
  exact_dup: { sev: 'warn', label: 'Exact duplicate' },
  near_dup: { sev: 'warn', label: 'Near duplicate' },
  leak: { sev: 'error', label: 'Eval row also in train' },
  pii: { sev: 'warn', label: 'Personal data or secret' },
  refusal: { sev: 'warn', label: 'Refusal' },
  boilerplate: { sev: 'info', label: 'Boilerplate opener' },
  dpo_identical: { sev: 'error', label: 'Chosen equals rejected' },
  language: { sev: 'info', label: 'Off-language' },
} as const satisfies Record<string, { sev: Severity; label: string }>
export type IssueCode = keyof typeof ISSUES

export const STANDARD_ROLES = ['system', 'user', 'assistant', 'tool'] as const
