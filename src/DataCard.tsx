import { useEffect } from 'react'
import { TokenHist } from './charts.tsx'
import { LANG_NAME, PII_LABEL, type PiiType } from './engine/content.ts'
import { FORMAT_LABEL, ISSUES, type Format, type IssueCode } from './engine/types.ts'
import { useProject, useReport } from './projectData.ts'
import { CopyButton, fmtCompact, fmtDateTime, fmtN, fmtPct, fmtUsd, fmtHours, Link } from './ui.tsx'

/** Printable data card: what is in the dataset, how it was cleaned, what it costs to train on. */
export default function DataCard({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const { report: r } = useReport(ds, project?.opts)
  useEffect(() => { if (project) document.title = `Data card: ${project.name}` }, [project?.name])
  if (loading || (project && !r)) return <div className="boot" role="status"><span className="spinner" /> Building the data card</div>
  if (!project || !r || !ds) return <div className="report"><h1>Dataset not found</h1><Link href="/app">All datasets</Link></div>
  const v = project.versions.at(-1)
  const codes = (Object.keys(ISSUES) as IssueCode[]).filter(c => r.counts[c])
  const md = [
    `# Data card: ${project.name}`, '',
    `- Rows: ${r.n} (${r.nTrain} train, ${r.nEval} eval)`,
    `- Formats: ${(Object.entries(r.formats) as [Format, number][]).map(([f, n]) => `${FORMAT_LABEL[f]} ${n}`).join(', ')}`,
    `- Estimated tokens: ${r.tokens.total} (median ${r.tokens.p50}, p95 ${r.tokens.p95}, max ${r.tokens.max}); ${r.tokens.overCtx} rows over ${project.opts.ctx}`,
    `- Duplicates: ${r.dup.exactExtra} exact, ${r.dup.nearExtra} near; eval leaks: ${r.leaks.length}`,
    `- PII rows: ${r.pii.rows}; refusals: ${r.refusals}`,
    `- Languages: ${r.lang.counts.map(([l, n]) => `${LANG_NAME[l] ?? l} ${n}`).join(', ')}`,
    ...(r.labels.classes.length ? [`- Classes: ${r.labels.classes.map(([l, n]) => `${l} ${n}`).join(', ')}`] : []),
    `- Training estimate: ${r.cost.trainingTokens} tokens over ${r.cost.epochs} epochs, $${r.cost.usd.toFixed(2)} at $${project.opts.pricePerM}/1M`,
    '', '## Version history', ...project.versions.map(x => `- ${x.label} (${new Date(x.at).toISOString().slice(0, 10)}): ${x.note}`),
  ].join('\n')
  return (
    <article className="report card">
      <div className="report-actions">
        <Link href={`/app/p/${project.id}`} className="btn ghost">Back</Link>
        <CopyButton text={md} label="Copy as Markdown" />
        <button type="button" className="btn primary" onClick={() => print()}>Print or save PDF</button>
      </div>
      <div className="eyebrow">Data card · {v ? v.label : 'unsaved'} · {fmtDateTime(Date.now())}</div>
      <h1>{project.name}</h1>
      {project.sampleId && <p className="muted">Synthetic sample data. No real customers.</p>}
      <div className="kpis">
        <div className="kpi"><small>Rows</small><b>{fmtN(r.n)}</b><p>{fmtN(r.nTrain)} train · {fmtN(r.nEval)} eval</p></div>
        <div className="kpi"><small>Tokens</small><b>{fmtCompact(r.tokens.total)}</b><p>median {fmtN(r.tokens.p50)}, p95 {fmtN(r.tokens.p95)}</p></div>
        <div className="kpi"><small>Clean rows</small><b>{fmtPct(r.n ? r.cleanRows / r.n : 0)}</b><p>{fmtN(r.errorRows)} rows with errors</p></div>
        <div className="kpi"><small>Training cost</small><b>{fmtUsd(r.cost.usd)}</b><p>{r.cost.epochs} epochs · {fmtHours(r.cost.hours)}</p></div>
      </div>
      <h2>Composition</h2>
      <table><tbody>
        <tr><th scope="row">Formats</th><td>{(Object.entries(r.formats) as [Format, number][]).map(([f, n]) => `${FORMAT_LABEL[f]}: ${fmtN(n)}`).join(' · ')}</td></tr>
        <tr><th scope="row">Languages</th><td>{r.lang.counts.map(([l, n]) => `${LANG_NAME[l] ?? l} ${fmtPct(n / r.n, 1)}`).join(' · ')}</td></tr>
        {r.labels.classes.length > 0 && <tr><th scope="row">Classes</th><td>{r.labels.classes.map(([l, n]) => `${l} ${fmtN(n)}`).join(' · ')} (ratio {r.labels.ratio.toFixed(1)}×)</td></tr>}
        {r.dpo && <tr><th scope="row">Preference pairs</th><td>{fmtN(r.dpo.pairs)} pairs · chosen longer in {fmtPct(r.dpo.chosenLonger)} · {fmtN(r.dpo.identical)} identical</td></tr>}
        <tr><th scope="row">Files</th><td>{project.imports.map(i => `${i.fileName} (${i.split}, ${fmtN(i.rows)} rows)`).join(' · ')}</td></tr>
      </tbody></table>
      <h2>Token lengths (context {fmtCompact(project.opts.ctx)})</h2>
      <TokenHist before={r.tokens.hist} ctx={project.opts.ctx} height={120} />
      <h2>Quality checks</h2>
      {codes.length === 0 ? <p>All checks pass.</p> : <table><thead><tr><th>Check</th><th>Severity</th><th className="num">Findings</th></tr></thead><tbody>{codes.map(c => <tr key={c}><td>{ISSUES[c].label}</td><td>{ISSUES[c].sev}</td><td className="num">{fmtN(r.counts[c]!)}</td></tr>)}</tbody></table>}
      {r.pii.rows > 0 && <p>Personal data: {(Object.entries(r.pii.byType) as [PiiType, number][]).map(([k, n]) => `${PII_LABEL[k]} ${n}`).join(', ')}.</p>}
      <h2>Version history</h2>
      <ol>{project.versions.map(x => <li key={x.id}><b>{x.label}</b> <span className="muted">({fmtDateTime(x.at)})</span>: {x.note}. {fmtN(x.summary.rows)} rows, {fmtN(x.summary.errors + x.summary.parseErrors)} errors.</li>)}</ol>
      <h2>Method</h2>
      <p className="small">Tokens are estimated with a byte-level BPE approximation (about 3% from cl100k per turn on chat data) plus 4 template tokens per turn. Duplicates: normalised-text hashes and MinHash LSH on word 3-grams at {Math.round(project.opts.nearThreshold * 100)}% Jaccard. PII: regular expressions with Luhn validation for cards. Cost: train rows truncated at the context length × epochs × ${project.opts.pricePerM} per million tokens (user-entered). Produced by Finetune Lint in the browser; no data left the device.</p>
    </article>
  )
}
