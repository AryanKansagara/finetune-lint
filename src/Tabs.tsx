import { useMemo, useState } from 'react'
import { Bars, TokenHist } from './charts.tsx'
import { summarise, type Summary } from './engine/analyze.ts'
import { LANG_NAME, PII_LABEL, type PiiType } from './engine/content.ts'
import { FIX_LABEL, makeSplit, type FixSet } from './engine/fixes.ts'
import { TARGET_LABEL, toJsonl, type Target } from './engine/formats.ts'
import { FORMAT_LABEL, ISSUES, type Format, type IssueCode, type Msg, type Row } from './engine/types.ts'
import { diffVersions } from './engine/versions.ts'
import { ProjectSettings } from './Import.tsx'
import type { Tab, TabProps } from './Project.tsx'
import { delVersionData, getVersionData, putData } from './store.ts'
import { deleteVersionCloud } from './sync.ts'
import { ask, Code, download, Empty, fmtCompact, fmtDateTime, fmtHours, fmtN, fmtPct, fmtUsd, go, Link, Modal, signed, toast } from './ui.tsx'

export default function Tabs(props: TabProps & { tab: Tab }) {
  switch (props.tab) {
    case 'issues': return <Issues {...props} />
    case 'dupes': return <Dupes {...props} />
    case 'content': return <Content {...props} />
    case 'fix': return <Fix {...props} />
    case 'history': return <History {...props} />
    default: return <Overview {...props} />
  }
}

const where = (r: Row) => `${r.file ? r.file + ':' : 'line '}${r.line}`
const SEV_TONE = { error: 'var(--bad)', warn: 'var(--warn)', info: 'var(--info)' }

// ---------- Row viewer ----------

function Turns({ ms, title }: { ms: Msg[]; title?: string }) {
  return (
    <div className="turns">
      {title && <div className="turns-title">{title}</div>}
      {ms.map((m, i) => (
        <div key={i} className={`turn ${['system', 'user', 'assistant', 'tool'].includes(m.role) ? m.role : 'odd'}`}>
          <span className="turn-role">{m.role || '(no role)'}{m.tool_call_id ? ` · ${m.tool_call_id}` : ''}</span>
          {m.content ? <p>{m.content.length > 1800 ? m.content.slice(0, 1800) + `… (${fmtN(m.content.length - 1800)} more characters)` : m.content}</p> : !m.tool_calls?.length && <p className="error small">(empty)</p>}
          {m.tool_calls?.length ? <pre className="mono small">{JSON.stringify(m.tool_calls, null, 1)}</pre> : null}
        </div>
      ))}
    </div>
  )
}
export function RowView({ row }: { row: Row }) {
  return row.format === 'dpo'
    ? <><Turns ms={row.messages} title="Prompt" /><div className="grid-2"><Turns ms={row.chosen ?? []} title="Chosen" /><Turns ms={row.rejected ?? []} title="Rejected" /></div></>
    : <Turns ms={row.messages} />
}
function useRowModal(rows: Row[]) {
  const [open, setOpen] = useState<number[] | null>(null)
  const modal = (
    <Modal open={!!open} onClose={() => setOpen(null)} title={open ? open.map(i => where(rows[i])).join('  vs  ') : ''} wide>
      {open && <div className={open.length > 1 ? 'grid-2 compare' : ''}>{open.map(i => <div key={i}><div className="row gap-sm small muted" style={{ marginBottom: 6 }}><span className="mono">{where(rows[i])}</span><span className={`badge ${rows[i].split ?? 'train'}`}>{rows[i].split ?? 'train'}</span>{rows[i].label && <span className="chip">{rows[i].label}</span>}</div><RowView row={rows[i]} /></div>)}</div>}
    </Modal>
  )
  return { show: (...i: number[]) => setOpen(i), modal }
}

// ---------- Overview ----------

function Overview({ project, ds, report: r, fixed, update }: TabProps) {
  const after = fixed?.report
  const errs = r.issues.filter(i => ISSUES[i.code].sev === 'error').length
  const warns = r.issues.filter(i => ISSUES[i.code].sev === 'warn').length
  const codes = (Object.keys(ISSUES) as IssueCode[]).filter(c => r.counts[c])
  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Rows</small><b>{fmtN(r.n)}</b><p>{fmtN(r.nTrain)} train · {fmtN(r.nEval)} eval{ds.parseErrors.length ? ` · ${ds.parseErrors.length} unreadable lines` : ''}</p></div>
        <div className="kpi"><small>Tokens (estimated)</small><b>{fmtCompact(r.tokens.total)}</b><p>median {fmtN(r.tokens.p50)} · p95 {fmtN(r.tokens.p95)} · max {fmtCompact(r.tokens.max)}</p></div>
        <div className="kpi"><small>Clean rows</small><b>{fmtPct(r.n ? r.cleanRows / r.n : 0)}</b><p><span className="error">{fmtN(errs)} errors</span> · <span className="warn-text">{fmtN(warns)} warnings</span></p></div>
        <div className="kpi"><small>Training cost</small><b>{fmtUsd(r.cost.usd)}</b><p>{after ? <>after fixes {fmtUsd(after.cost.usd)} · </> : null}{fmtHours(r.cost.hours)} at {fmtCompact(project.opts.throughput)} tok/s</p></div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>What the linter found</h2><Link href={`/app/p/${project.id}/issues`} className="small">All issues</Link></div>
          {codes.length === 0 ? <p className="good-text">No issues. This dataset is ready to upload.</p> : (
            <ul className="issue-grid">
              {codes.map(c => (
                <li key={c}>
                  <button type="button" onClick={() => go(`/app/p/${project.id}/issues?code=${c}`)}>
                    <i style={{ background: SEV_TONE[ISSUES[c].sev] }} aria-hidden="true" />
                    <span>{ISSUES[c].label}</span>
                    <b className="tab-nums">{fmtN(r.counts[c]!)}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row gap wrap small muted" style={{ marginTop: 12 }}>
            {(Object.entries(r.formats) as [Format, number][]).map(([f, n]) => <span key={f} className="chip">{FORMAT_LABEL[f]} <b>{fmtN(n)}</b></span>)}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Token lengths</h2><span className="legend"><span><i style={{ background: 'var(--c-before)' }} />as imported</span>{after && <span><i style={{ background: 'var(--c-after)' }} />after fixes</span>}<span><i className="ctx-key" />context {fmtCompact(project.opts.ctx)}</span></span></div>
          <TokenHist before={r.tokens.hist} after={after?.tokens.hist} ctx={project.opts.ctx} />
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {r.tokens.overCtx ? <><b className="warn-text">{fmtN(r.tokens.overCtx)} rows</b> run past the context window and would lose about {fmtCompact(r.tokens.truncated)} tokens, usually the answer. </> : 'Every row fits the context window. '}
            Prompt tokens {fmtPct(r.tokens.total ? r.tokens.prompt / r.tokens.total : 0)}, completion {fmtPct(r.tokens.total ? r.tokens.completion / r.tokens.total : 0)}.
          </p>
          <div className="tok-stats">
            <div><small>Median</small><b>{fmtN(r.tokens.p50)}</b></div>
            <div><small>p95</small><b>{fmtN(r.tokens.p95)}</b></div>
            <div><small>Longest</small><b>{fmtN(r.tokens.max)}</b></div>
            <div><small>Over context</small><b className={r.tokens.overCtx ? 'warn-text' : ''}>{fmtN(r.tokens.overCtx)}</b></div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Cost and time</h2><span className="muted small">train rows only, each truncated at the context length</span></div>
        <ProjectSettings project={project} update={update} compact />
        <div className="cost-grid">
          <div><small>Tokens per epoch</small><b>{fmtCompact(r.cost.billed)}</b>{after && <span className="muted small">→ {fmtCompact(after.cost.billed)}</span>}</div>
          <div><small>Training tokens ({r.cost.epochs} epochs)</small><b>{fmtCompact(r.cost.trainingTokens)}</b>{after && <span className="muted small">→ {fmtCompact(after.cost.trainingTokens)}</span>}</div>
          <div><small>Estimated cost</small><b>{fmtUsd(r.cost.usd)}</b>{after && <span className="good-text small">→ {fmtUsd(after.cost.usd)}</span>}</div>
          <div><small>Estimated time</small><b>{fmtHours(r.cost.hours)}</b>{after && <span className="muted small">→ {fmtHours(after.cost.hours)}</span>}</div>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Token counts are estimates (within about 3% of cl100k per turn on chat data; see <Link href="/docs#tokens">docs</Link>). Preference pairs bill both sequences. Price is whatever you entered; check your provider.</p>
      </div>
    </>
  )
}

// ---------- Issues ----------

function Issues({ ds, report: r }: TabProps) {
  const q0 = new URLSearchParams(location.search)
  const [code, setCode] = useState<IssueCode | 'all' | 'errors' | 'serious'>((q0.get('code') as IssueCode) ?? 'serious')
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(200)
  const { show, modal } = useRowModal(ds.rows)
  const list = useMemo(() => r.issues.filter(i => (code === 'all' || (code === 'errors' ? ISSUES[i.code].sev === 'error' : code === 'serious' ? ISSUES[i.code].sev !== 'info' : i.code === code)) && (!text || (i.message + ' ' + (i.file ?? '') + ':' + i.line).toLowerCase().includes(text.toLowerCase()))), [r, code, text])
  const csv = () => 'file,line,severity,code,message\n' + list.map(i => [i.file ?? '', i.line, ISSUES[i.code].sev, i.code, `"${i.message.replace(/"/g, '""')}"`].join(',')).join('\n')
  return (
    <div className="panel">
      <div className="row between wrap gap issue-filters" style={{ marginBottom: 12 }}>
        <div className="row gap wrap">
          <label className="sr-only" htmlFor="code">Issue type</label>
          <select id="code" value={code} onChange={e => { setCode(e.target.value as IssueCode); setLimit(200) }}>
            <option value="serious">Errors and warnings ({fmtN(r.issues.filter(i => ISSUES[i.code].sev !== 'info').length)})</option>
            <option value="errors">Errors only ({fmtN(r.issues.filter(i => ISSUES[i.code].sev === 'error').length)})</option>
            <option value="all">Everything, including info ({fmtN(r.issues.length)})</option>
            {(Object.keys(ISSUES) as IssueCode[]).filter(c => r.counts[c]).map(c => <option key={c} value={c}>{ISSUES[c].label} ({fmtN(r.counts[c]!)})</option>)}
          </select>
          <input type="search" placeholder="Filter by text or line" value={text} onChange={e => setText(e.target.value)} aria-label="Filter issues" />
        </div>
        <button type="button" className="btn ghost sm" onClick={() => download('issues.csv', csv())}>Download CSV</button>
      </div>
      {list.length === 0 ? <Empty title="Nothing here"><p className="muted">No issues match this filter.</p></Empty> : (
        <div className="table-wrap"><table className="issue-table">
          <thead><tr><th>Where</th><th>Issue</th><th>Detail</th><th /></tr></thead>
          <tbody>{list.slice(0, limit).map((i, k) => (
            <tr key={k}>
              <td className="mono small nowrap">{i.file ? `${i.file}:` : 'line '}{i.line}{i.turn ? <span className="muted"> · turn {i.turn}</span> : null}</td>
              <td className="nowrap"><span className={`sev ${ISSUES[i.code].sev}`}>{ISSUES[i.code].label}</span></td>
              <td className="small">{i.message}</td>
              <td>{i.row !== undefined && <button type="button" className="btn ghost sm" onClick={() => show(i.row!)}>View</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {list.length > limit && <div className="center" style={{ marginTop: 12 }}><button type="button" className="btn outline sm" onClick={() => setLimit(l => l + 500)}>Show more ({fmtN(list.length - limit)} left)</button></div>}
      {modal}
    </div>
  )
}

// ---------- Duplicates & leaks ----------

function Dupes({ project, ds, report: r, update }: TabProps) {
  const { show, modal } = useRowModal(ds.rows)
  const rows = ds.rows
  const pairOf = useMemo(() => new Map(r.dup.pairs.map(p => [`${p.a},${p.b}`, p.sim])), [r])
  return (
    <>
      <div className="kpis three">
        <div className="kpi"><small>Exact copies</small><b>{fmtN(r.dup.exactExtra)}</b><p>in {fmtN(r.dup.exact.length)} groups</p></div>
        <div className="kpi"><small>Near duplicates</small><b>{fmtN(r.dup.nearExtra)}</b><p>at {Math.round(project.opts.nearThreshold * 100)}% similarity or more</p></div>
        <div className="kpi"><small>Eval rows leaking from train</small><b className={r.leaks.length ? 'error' : ''}>{fmtN(r.leaks.length)}</b><p>{r.nEval ? `of ${fmtN(r.nEval)} eval rows` : 'no eval rows yet'}</p></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Train/eval leakage</h2><span className="muted small">exact prompt match, or near duplicate of a train row</span></div>
        {!r.nEval ? <p className="muted">Import an eval file, or make a split on <Link href={`/app/p/${project.id}/fix`}>Fix &amp; export</Link>, to check for leakage.</p>
          : !r.leaks.length ? <p className="good-text">No eval row overlaps the training set.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Eval row</th><th>Train row</th><th>Match</th><th /></tr></thead>
              <tbody>{r.leaks.map((l, k) => <tr key={k}><td className="mono small">{where(rows[l.evalIdx])}</td><td className="mono small">{where(rows[l.trainIdx])}</td><td>{l.kind}{l.kind !== 'exact prompt' ? ` (${Math.round(l.sim * 100)}%)` : ''}</td><td><button type="button" className="btn ghost sm" onClick={() => show(l.evalIdx, l.trainIdx)}>Compare</button></td></tr>)}</tbody>
            </table></div>
          )}
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Exact duplicates</h2><span className="muted small">case, punctuation and spacing ignored; system prompts excluded</span></div>
          {!r.dup.exact.length ? <p className="good-text">None.</p> : (
            <ul className="dup-list">{r.dup.exact.slice(0, 100).map((g, k) => <li key={k}><button type="button" className="linkish mono small" onClick={() => show(g[0], g[1])}>{g.slice(0, 4).map(i => where(rows[i])).join(', ')}{g.length > 4 ? ` +${g.length - 4}` : ''}</button><span className="muted small">{g.length} copies · “{(rows[g[0]].messages.find(m => m.role === 'user')?.content ?? '').slice(0, 60)}…”</span></li>)}</ul>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Near duplicates</h2>
            <label className="small row gap-sm">Threshold <input type="range" min="0.5" max="0.98" step="0.02" value={project.opts.nearThreshold} onChange={e => update({ opts: { ...project.opts, nearThreshold: Number(e.target.value) } })} aria-label="Near-duplicate threshold" /> {Math.round(project.opts.nearThreshold * 100)}%</label>
          </div>
          {!r.dup.near.length ? <p className="good-text">None at this threshold.</p> : (
            <ul className="dup-list">{r.dup.near.slice(0, 100).map((g, k) => { const sim = pairOf.get(`${g[0]},${g[1]}`); return <li key={k}><button type="button" className="linkish mono small" onClick={() => show(g[0], g[1])}>{g.slice(0, 4).map(i => where(rows[i])).join(', ')}{g.length > 4 ? ` +${g.length - 4}` : ''}</button><span className="muted small">{g.length} rows{sim ? ` · ${Math.round(sim * 100)}% similar` : ''}</span></li> })}</ul>
          )}
          <p className="muted small" style={{ margin: '10px 0 0' }}>MinHash over word 3-grams (64 hashes, 16 LSH bands). Similarity is the estimated Jaccard overlap of those 3-grams.</p>
        </div>
      </div>
      {modal}
    </>
  )
}

// ---------- Content ----------

function Content({ project, ds, report: r }: TabProps) {
  const pii = Object.entries(r.pii.byType) as [PiiType, number][]
  const total = r.n || 1
  return (
    <>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Personal data and secrets</h2><span className="muted small">{fmtN(r.pii.rows)} rows</span></div>
          {!pii.length ? <p className="good-text">No emails, phone numbers, card numbers, SSNs or keys found.</p> : <Bars items={pii.map(([k, v]) => [PII_LABEL[k], v])} />}
          <p className="muted small" style={{ margin: '10px 0 0' }}>Fine-tuned models can repeat training data verbatim. Card numbers count only when they pass the Luhn check. <Link href={`/app/p/${project.id}/issues?code=pii`}>See each row</Link>.</p>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Refusals and verbal tics</h2></div>
          <p><b>{fmtN(r.refusals)}</b> rows ({fmtPct(r.refusals / total, 1)}) teach the model to refuse. {r.refusals ? <Link href={`/app/p/${project.id}/issues?code=refusal`}>Review them</Link> : null}</p>
          {r.openers.length ? <>
            <p className="small muted" style={{ marginBottom: 6 }}>Replies that open the same way (the tuned model will too):</p>
            <Bars items={r.openers.slice(0, 6).map(o => [`“${o.opener}…”`, o.count])} total={total} />
          </> : <p className="good-text small">No opener repeats across more than 4% of replies.</p>}
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head"><h2>Languages</h2><span className="muted small">character trigrams, script ranges</span></div>
          <Bars items={r.lang.counts.slice(0, 8).map(([l, n]) => [LANG_NAME[l] ?? l, n])} total={total} tone={l => l === LANG_NAME[r.lang.dominant] ? 'var(--brand)' : undefined} />
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Class balance</h2><span className="muted small">{r.labels.source === 'field' ? 'from the label field' : r.labels.source === 'inferred' ? 'inferred from short final answers' : 'not a classification task'}</span></div>
          {r.labels.classes.length ? <>
            <Bars items={r.labels.classes.slice(0, 10)} total={r.labels.classes.reduce((s, c) => s + c[1], 0)} />
            <p className={`small ${r.labels.ratio > 5 ? 'warn-text' : 'muted'}`} style={{ margin: '10px 0 0' }}>Largest class is {r.labels.ratio.toFixed(1)}× the smallest. {r.labels.ratio > 5 ? 'The model will lean to the majority class; upsample the small ones or collect more.' : ''} The split on Fix &amp; export keeps these proportions in eval.</p>
          </> : <p className="muted small">No label, class, category or intent field, and final answers are free text.</p>}
        </div>
      </div>
      {r.dpo && (
        <div className="panel">
          <div className="panel-head"><h2>Preference pairs</h2><span className="muted small">{fmtN(r.dpo.pairs)} pairs</span></div>
          <div className="cost-grid">
            <div><small>Chosen equals rejected</small><b className={r.dpo.identical ? 'error' : ''}>{fmtN(r.dpo.identical)}</b></div>
            <div><small>Chosen is longer</small><b className={r.dpo.biased ? 'warn-text' : ''}>{fmtPct(r.dpo.chosenLonger)}</b></div>
            <div><small>Mean length ratio</small><b>{r.dpo.meanRatio.toFixed(2)}×</b></div>
            <div><small>Missing a side</small><b>{fmtN(r.counts.dpo_missing ?? 0)}</b></div>
          </div>
          {r.dpo.biased && <p className="warn-text small" style={{ margin: 0 }}>Length bias: in {fmtPct(r.dpo.chosenLonger)} of pairs the chosen answer is longer. DPO will learn &ldquo;longer is better&rdquo;. Add pairs where the better answer is the shorter one, or use a length-normalised objective.</p>}
        </div>
      )}
      {ds.rows.length > 0 && !r.dpo && <p className="muted small">Preference checks appear when the dataset has prompt/chosen/rejected pairs.</p>}
    </>
  )
}

// ---------- Fix & export ----------

const delta = (a: number, b: number, f = fmtN) => b === a ? <span className="muted">no change</span> : <span className={b < a ? 'good-text' : 'warn-text'}>{signed(b - a, f)}</span>

function Fix({ project, ds, report: r, fixed, update, commit }: TabProps) {
  const [busy, setBusy] = useState(false)
  const target = project.target
  const before = summarise(r), after = fixed ? summarise(fixed.report) : null
  const toggle = (k: keyof FixSet) => update({ fixes: { ...project.fixes, [k]: !project.fixes[k] } })
  const apply = async () => {
    if (!fixed) return
    setBusy(true)
    const prev = ds
    await commit({ rows: fixed.rows, parseErrors: [] }, `v${project.versions.length + 1} · fixed`, fixed.log.filter(l => l.count).map(l => `${FIX_LABEL[l.key][0]}: ${l.note}`).join('; ') || 'No changes')
    setBusy(false)
    toast(`Applied fixes: ${fmtN(fixed.rows.length)} rows remain`, { tone: 'ok', undo: () => void commit(prev, `v${project.versions.length + 2} · undo fixes`, 'Restored the rows from before the fix-up') })
  }
  const split = async () => {
    setBusy(true)
    const next = makeSplit(ds.rows, { evalFraction: project.evalFraction, seed: project.versions.length + 1, nearThreshold: project.opts.nearThreshold, labels: r.labels.source ? r.labels.perRow : undefined })
    const ev = next.filter(x => x.split === 'eval').length
    await commit({ ...ds, rows: next }, `v${project.versions.length + 1} · split`, `Stratified split: ${fmtN(next.length - ev)} train / ${fmtN(ev)} eval`)
    setBusy(false)
    toast(`Split into ${fmtN(next.length - ev)} train and ${fmtN(ev)} eval rows`, { tone: 'ok' })
  }
  const exp = useMemo(() => ({
    train: toJsonl(ds.rows.filter(x => x.split !== 'eval'), target),
    eval: toJsonl(ds.rows.filter(x => x.split === 'eval'), target),
  }), [ds, target])
  const base = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dataset'
  const ROWS: [keyof Summary, string][] = [['rows', 'Rows'], ['errors', 'Errors'], ['exactDupes', 'Exact copies'], ['nearDupes', 'Near duplicates'], ['leaks', 'Eval leaks'], ['pii', 'Rows with PII'], ['overCtx', 'Over context'], ['refusals', 'Refusals'], ['tokens', 'Tokens']]
  return (
    <>
      <div className="grid-2 fix-layout">
        <div className="panel">
          <div className="panel-head"><h2>1. Fix-ups</h2><span className="muted small">preview updates as you toggle</span></div>
          <div className="fix-toggles">
            {(Object.keys(FIX_LABEL) as (keyof FixSet)[]).map(k => {
              const log = fixed?.log.find(l => l.key === k)
              return (
                <label key={k} className={`fix-toggle${project.fixes[k] ? ' on' : ''}`}>
                  <input type="checkbox" checked={project.fixes[k]} onChange={() => toggle(k)} />
                  <span className="ft-text"><b>{FIX_LABEL[k][0]}</b><small>{FIX_LABEL[k][1]}</small></span>
                  <span className="ft-n tab-nums">{project.fixes[k] ? (log ? log.note : '…') : 'off'}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Before and after</h2>{!fixed && <span className="muted small"><span className="spinner sm" /> previewing</span>}</div>
          <table className="ba">
            <thead><tr><th /><th className="num">Now</th><th className="num">After</th><th className="num">Change</th></tr></thead>
            <tbody>{ROWS.map(([k, l]) => <tr key={k}><th scope="row">{l}</th><td className="num">{k === 'tokens' ? fmtCompact(before[k]) : fmtN(before[k])}</td><td className="num">{after ? (k === 'tokens' ? fmtCompact(after[k]) : fmtN(after[k])) : '…'}</td><td className="num small">{after ? delta(before[k], after[k], k === 'tokens' ? fmtCompact : fmtN) : ''}</td></tr>)}
              <tr><th scope="row">Training cost</th><td className="num">{fmtUsd(before.usd)}</td><td className="num">{after ? fmtUsd(after.usd) : '…'}</td><td className="num small">{after ? delta(before.usd, after.usd, fmtUsd) : ''}</td></tr>
            </tbody>
          </table>
          {fixed && <TokenHist before={r.tokens.hist} after={fixed.report.tokens.hist} ctx={project.opts.ctx} height={110} />}
          <button type="button" className="btn primary block" style={{ marginTop: 14 }} disabled={!fixed || busy} onClick={() => void apply()}>Apply fixes and save as a new version</button>
          <p className="muted small" style={{ margin: '8px 0 0' }}>The current rows stay in History; you can restore them any time.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>2. Train/eval split</h2><span className="muted small">{r.nEval ? `currently ${fmtN(r.nTrain)} train / ${fmtN(r.nEval)} eval` : 'no eval rows yet'}</span></div>
        <div className="row gap wrap">
          <label className="field" style={{ maxWidth: 220 }}><span>Eval share ({Math.round(project.evalFraction * 100)}%)</span><input type="range" min="0.02" max="0.3" step="0.01" value={project.evalFraction} onChange={e => update({ evalFraction: Number(e.target.value) })} /></label>
          <p className="small muted grow" style={{ margin: 0 }}>Stratified by {r.labels.source ? 'class label' : 'token-length quartile'}. Exact and near-duplicate clusters stay on one side, so the new eval set cannot leak. Deterministic for a given version.</p>
          <button type="button" className="btn outline" disabled={busy} onClick={async () => { if (!r.nEval || await ask('Re-split every row?', 'Rows currently marked eval (including imported eval files) are pooled and split again.', 'Re-split', false)) void split() }}>{r.nEval ? 'Re-split all rows' : 'Make the split'}</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>3. Export</h2><span className="muted small">exports the current version; apply fixes first</span></div>
        <div className="row gap wrap" style={{ marginBottom: 12 }}>
          <label className="field" style={{ minWidth: 280 }}><span>Format</span>
            <select value={target} onChange={e => update({ target: e.target.value as Target })}>{(Object.keys(TARGET_LABEL) as Target[]).map(t => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}</select>
          </label>
        </div>
        <div className="export-row">
          <button type="button" className="btn primary" disabled={!exp.train.written} onClick={() => download(`${base}-train.jsonl`, exp.train.text, 'application/jsonl')}>Download train.jsonl ({fmtN(exp.train.written)})</button>
          <button type="button" className="btn outline" disabled={!exp.eval.written} onClick={() => download(`${base}-eval.jsonl`, exp.eval.text, 'application/jsonl')}>Download eval.jsonl ({fmtN(exp.eval.written)})</button>
          <Link href={`/app/p/${project.id}/card`} className="btn ghost">Printable data card</Link>
        </div>
        {(exp.train.skipped.length + exp.eval.skipped.length > 0) && <p className="warn-text small">{fmtN(exp.train.skipped.length + exp.eval.skipped.length)} rows cannot be written in this format ({[...new Set([...exp.train.skipped, ...exp.eval.skipped].map(s => s.reason))].join('; ')}).</p>}
        {r.errorRows > 0 && <p className="warn-text small">{fmtN(r.errorRows)} rows still have errors that most fine-tuning services reject. Apply the fixes above first.</p>}
        <Code label="Upload with firectl (Fireworks CLI), or use your provider's equivalent" code={`firectl create dataset ${base}-train ${base}-train.jsonl\nfirectl create dataset ${base}-eval ${base}-eval.jsonl`} />
      </div>
    </>
  )
}

// ---------- History ----------

function History({ project, ds, update, commit }: TabProps) {
  const vs = project.versions
  const [a, setA] = useState(vs.length > 1 ? vs[vs.length - 2].id : vs[0]?.id)
  const [b, setB] = useState(vs.at(-1)?.id)
  const va = vs.find(v => v.id === a), vb = vs.find(v => v.id === b)
  const d = va && vb ? diffVersions(va, vb) : null
  if (!vs.length) return <Empty title="No versions yet"><p className="muted">Every import, fix-up and split saves a version here. You can also press <kbd>S</kbd>.</p></Empty>
  const restore = async (id: string) => {
    const data = await getVersionData(project.id, id)
    const v = vs.find(x => x.id === id)!
    if (!data) { toast('The rows for that version are on another device; only its summary synced.', { tone: 'error' }); return }
    const prev = ds
    await commit(data, `v${vs.length + 1} · restored ${v.label.split(' ')[0]}`, `Restored ${v.label}`)
    toast(`Restored ${v.label}`, { tone: 'ok', undo: () => void putData(project.id, prev) })
  }
  const exportV = async (id: string) => {
    const data = await getVersionData(project.id, id)
    if (!data) { toast('The rows for that version are on another device.', { tone: 'error' }); return }
    download(`${project.name.replace(/\W+/g, '-')}-${vs.find(v => v.id === id)!.label.split(' ')[0]}.jsonl`, toJsonl(data.rows, project.target).text, 'application/jsonl')
  }
  const remove = async (id: string) => {
    const v = vs.find(x => x.id === id)!
    if (!(await ask(`Delete ${v.label}?`, 'Removes this version and its saved rows. The current dataset is not affected.', 'Delete version'))) return
    const data = await getVersionData(project.id, id)
    await update({ versions: vs.filter(x => x.id !== id) })
    void delVersionData(project.id, id)
    void deleteVersionCloud(id)
    toast(`Deleted ${v.label}`, { undo: async () => { if (data) { const { putVersionData } = await import('./store.ts'); await putVersionData(project.id, id, data) } await update({ versions: vs }) } })
  }
  const KEYS: [keyof Summary, string, (n: number) => string][] = [['rows', 'Rows', fmtN], ['train', 'Train', fmtN], ['eval', 'Eval', fmtN], ['tokens', 'Tokens', fmtCompact], ['errors', 'Errors', fmtN], ['parseErrors', 'Unreadable lines', fmtN], ['exactDupes', 'Exact copies', fmtN], ['nearDupes', 'Near duplicates', fmtN], ['leaks', 'Eval leaks', fmtN], ['pii', 'Rows with PII', fmtN], ['refusals', 'Refusals', fmtN], ['overCtx', 'Over context', fmtN], ['usd', 'Training cost', fmtUsd]]
  return (
    <>
      {vs.length > 1 && va && vb && d && (
        <div className="panel">
          <div className="panel-head"><h2>Compare versions</h2></div>
          <div className="row gap wrap" style={{ marginBottom: 14 }}>
            <select value={a} onChange={e => setA(e.target.value)} aria-label="Older version">{vs.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
            <span className="muted">→</span>
            <select value={b} onChange={e => setB(e.target.value)} aria-label="Newer version">{vs.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          </div>
          <div className="cost-grid">
            <div><small>Rows kept</small><b>{fmtN(d.kept)}</b></div>
            <div><small>Rows removed or changed</small><b className="warn-text">{fmtN(d.removed)}</b></div>
            <div><small>Rows added or changed</small><b className="good-text">{fmtN(d.added)}</b></div>
            <div><small>Cost change</small><b>{signed(d.delta.usd, fmtUsd)}</b></div>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th /><th className="num">{va.label}</th><th className="num">{vb.label}</th><th className="num">Change</th></tr></thead>
            <tbody>{KEYS.map(([k, l, f]) => <tr key={k}><th scope="row">{l}</th><td className="num">{f(va.summary[k])}</td><td className="num">{f(vb.summary[k])}</td><td className="num small">{delta(va.summary[k], vb.summary[k], f)}</td></tr>)}</tbody>
          </table></div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>Rows are matched by normalised content, so a row whose PII was masked counts as one removed and one added.</p>
        </div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Versions</h2><span className="muted small">newest first</span></div>
        <ol className="versions">
          {[...vs].reverse().map((v, i) => (
            <li key={v.id}>
              <div className="v-dot" aria-hidden="true" />
              <div className="grow">
                <div className="row gap-sm wrap"><b>{v.label}</b>{i === 0 && <span className="badge train">current</span>}<span className="muted small">{fmtDateTime(v.at)}</span></div>
                <p className="small muted" style={{ margin: '2px 0 4px' }}>{v.note}</p>
                <p className="small" style={{ margin: 0 }}>{fmtN(v.summary.rows)} rows · {fmtCompact(v.summary.tokens)} tokens · {fmtN(v.summary.errors + v.summary.parseErrors)} errors · {fmtN(v.summary.exactDupes + v.summary.nearDupes)} duplicates · {fmtN(v.summary.leaks)} leaks · {fmtUsd(v.summary.usd)}</p>
              </div>
              <div className="row gap-sm wrap">
                {i > 0 && <button type="button" className="btn ghost sm" onClick={() => void restore(v.id)}>Restore</button>}
                <button type="button" className="btn ghost sm" onClick={() => void exportV(v.id)}>JSONL</button>
                {vs.length > 1 && <button type="button" className="btn danger-ghost sm" onClick={() => void remove(v.id)}>Delete</button>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}
