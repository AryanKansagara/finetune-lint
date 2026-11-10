// Runs the analysis and fix-ups off the main thread so large datasets do not freeze the page.
import { analyze, type Options } from './engine/analyze.ts'
import { applyFixes, type FixSet } from './engine/fixes.ts'
import type { Issue, Row } from './engine/types.ts'

export type Job =
  | { id: number; kind: 'analyze'; rows: Row[]; opts: Options; parseErrors: Issue[] }
  | { id: number; kind: 'fix'; rows: Row[]; opts: Options; fixes: FixSet }

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data
  try {
    if (j.kind === 'analyze') {
      const before = analyze(j.rows, j.opts, j.parseErrors)
      postMessage({ id: j.id, ok: true, result: before })
    } else {
      const fixed = applyFixes(j.rows, j.fixes, j.opts)
      postMessage({ id: j.id, ok: true, result: { ...fixed, report: analyze(fixed.rows, j.opts) } })
    }
  } catch (err) {
    postMessage({ id: j.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
