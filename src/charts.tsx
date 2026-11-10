import { HIST_EDGES } from './engine/analyze.ts'
import { fmtCompact, fmtN } from './ui.tsx'

const binLabel = (i: number) => HIST_EDGES[i + 1] === Infinity ? `${fmtCompact(HIST_EDGES[i])}+` : fmtCompact(HIST_EDGES[i + 1])

/** Token-length histogram: before (muted) and after fixes (accent), with the context window marked. */
export function TokenHist({ before, after, ctx, height = 170, labels = true }: { before: number[]; after?: number[]; ctx: number; height?: number; labels?: boolean }) {
  // Trim empty bins at both ends but keep the context bin visible.
  const ctxBin = HIST_EDGES.findIndex((e, i) => ctx >= e && ctx < HIST_EDGES[i + 1])
  const used = before.map((v, i) => v || after?.[i] || i === ctxBin ? i : -1).filter(i => i >= 0)
  const lo = Math.max(0, Math.min(...used) - 1), hi = Math.min(before.length - 1, Math.max(...used) + 1)
  const bins = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)
  const max = Math.max(1, ...bins.map(i => Math.max(before[i], after?.[i] ?? 0)))
  const w = 100 / bins.length
  return (
    <figure className="thist" style={{ height }} aria-label="Token length histogram">
      <svg viewBox={`0 0 100 ${100}`} preserveAspectRatio="none" aria-hidden="true">
        {bins.map((i, k) => {
          const hb = before[i] / max * 100, ha = after ? (after[i] / max) * 100 : 0
          return (
            <g key={i} className={HIST_EDGES[i] >= ctx ? 'over' : ''}>
              <rect className="b" x={k * w + w * 0.12} width={w * (after ? 0.38 : 0.76)} y={100 - hb} height={hb} rx="0.6" />
              {after && <rect className="a" x={k * w + w * 0.5} width={w * 0.38} y={100 - ha} height={ha} rx="0.6" />}
            </g>
          )
        })}
        {ctxBin >= lo && <line className="ctx" x1={(ctxBin - lo + 1) * w} x2={(ctxBin - lo + 1) * w} y1="0" y2="100" />}
      </svg>
      {labels && (
        <div className="thist-x" style={{ gridTemplateColumns: `repeat(${bins.length}, 1fr)` }}>
          {bins.map(i => <span key={i} title={`${fmtN(before[i])} rows${after ? `, ${fmtN(after[i])} after fixes` : ''}`}>{binLabel(i)}</span>)}
        </div>
      )}
    </figure>
  )
}

export function Bars({ items, total, fmt = fmtN, tone }: { items: [string, number][]; total?: number; fmt?: (n: number) => string; tone?: (label: string) => string | undefined }) {
  const max = Math.max(1, ...items.map(i => i[1]))
  return (
    <ul className="bars">
      {items.map(([l, v]) => (
        <li key={l}>
          <span className="bars-l">{l}</span>
          <span className="bars-t"><i style={{ width: `${(v / max) * 100}%`, background: tone?.(l) }} /></span>
          <b className="tab-nums">{fmt(v)}{total ? <small> {Math.round(v / total * 100)}%</small> : null}</b>
        </li>
      ))}
    </ul>
  )
}
