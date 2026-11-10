export interface ToolCall { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }
export interface Msg { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }

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
  /** Explicit class/label field when the source has one */
  label?: string
  /** Fields we do not interpret but keep on export (id, tools, metadata) */
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
  unknown_shape: { sev: 'error', label: 'Unrecognised record shape' },
  empty_conversation: { sev: 'error', label: 'No turns' },
  bad_role: { sev: 'error', label: 'Unknown role' },
  empty_turn: { sev: 'error', label: 'Empty turn' },
  no_user: { sev: 'error', label: 'No user turn' },
  no_assistant_final: { sev: 'error', label: 'Does not end on an assistant turn' },
  tool_schema: { sev: 'error', label: 'Tool-call schema' },
  dpo_missing: { sev: 'error', label: 'Missing chosen or rejected' },
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
