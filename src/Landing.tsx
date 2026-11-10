import { useEffect, useMemo, useRef, useState } from 'react'
import { TokenHist } from './charts.tsx'
import { histogram, type Report } from './engine/analyze.ts'
import { ISSUES, type IssueCode, type Row } from './engine/types.ts'
import { fmtCompact, fmtN, Link } from './ui.tsx'

interface Demo { rows: Row[]; report: Report; after: Report; parseLines: Set<number> }

const COUNTERS: [string, IssueCode[]][] = [['Broken rows', ['invalid_json', 'bad_role', 'empty_turn', 'no_assistant_final', 'tool_schema', 'system_not_first', 'no_user']], ['Duplicates', ['exact_dup', 'near_dup']], ['Eval leaks', ['leak']], ['PII and keys', ['pii']], ['Refusals', ['refusal']], ['Over 4k context', ['over_context']]]
const DURATION = 9000

function useDemo() {
  const [demo, setDemo] = useState<Demo | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const { parseFiles, runJob } = await import('./projectData.ts')
      const { sampleFiles } = await import('./engine/sample.ts')
      const { DEFAULT_OPTIONS } = await import('./engine/analyze.ts')
      const { DEFAULT_FIXES } = await import('./engine/fixes.ts')
      const ds = parseFiles(sampleFiles('support-sft'))
      const [report, fixed] = await Promise.all([
        runJob<Report>({ kind: 'analyze', rows: ds.rows, opts: DEFAULT_OPTIONS, parseErrors: ds.parseErrors }),
        runJob<{ report: Report }>({ kind: 'fix', rows: ds.rows, opts: DEFAULT_OPTIONS, fixes: DEFAULT_FIXES }),
      ])
      if (live) setDemo({ rows: ds.rows, report, after: fixed.report, parseLines: new Set(ds.parseErrors.map(e => e.line)) })
    })()
    return () => { live = false }
  }, [])
  return demo
}

function HeroLinter() {
  const demo = useDemo()
  const [k, setK] = useState(0)
  const start = useRef(0)
  useEffect(() => {
    if (!demo) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setK(demo.rows.length); return }
    let raf = 0
    start.current = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start.current) / DURATION)
      setK(Math.round(demo.rows.length * (1 - Math.pow(1 - p, 2))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [demo])

  const byRow = useMemo(() => {
    const m = new Map<number, IssueCode[]>()
    for (const i of demo?.report.issues ?? []) if (i.row !== undefined) m.set(i.row, [...(m.get(i.row) ?? []), i.code])
    return m
  }, [demo])
  const counts = useMemo(() => {
    if (!demo) return COUNTERS.map(() => 0)
    return COUNTERS.map(([, codes]) => demo.report.issues.filter(i => codes.includes(i.code) && (i.row === undefined ? i.line <= (demo.rows[k - 1]?.line ?? 0) && i.file === 'support-train.jsonl' : i.row < k)).length)
  }, [demo, k])
  const done = demo && k >= demo.rows.length
  const before = useMemo(() => demo ? histogram(demo.report.tokens.perRow.slice(0, k)) : [], [demo, k])
  const recent = demo ? Array.from({ length: 7 }, (_, j) => k - 1 - j).filter(i => i >= 0).map(i => ({ i, r: demo.rows[i], codes: byRow.get(i) ?? [] })) : []

  return (
    <div className="linter" aria-label="Live demo: the synthetic support dataset running through the linter">
      <div className="linter-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="mono">finetune-lint · support-train.jsonl + support-eval.jsonl</span>
        <span className="badge synthetic">Synthetic</span>
      </div>
      <div className="linter-body">
        <div className="linter-log mono" aria-hidden="true">
          {!demo && <div className="log-line muted">loading 1,320 synthetic rows…</div>}
          {recent.map(({ i, r, codes }) => {
            const worst = codes.find(c => ISSUES[c].sev === 'error') ?? codes.find(c => ISSUES[c].sev === 'warn')
            return (
              <div key={i} className="log-line">
                <span className="ln">{r.file?.includes('eval') ? 'eval' : 'train'}:{r.line}</span>
                <span className={`st ${worst ? ISSUES[worst].sev : 'ok'}`}>{worst ? ISSUES[worst].label : 'ok'}</span>
                <span className="txt">{(r.messages.find(m => m.role === 'user')?.content ?? '').slice(0, 64)}</span>
              </div>
            )
          })}
        </div>
        <div className="linter-counters">
          <div className="lc-main"><small>Rows linted</small><b className="tab-nums">{fmtN(k)}</b><span className="muted">/ {fmtN(demo?.rows.length ?? 1314)}</span></div>
          {COUNTERS.map(([l], j) => <div key={l} className={`lc${counts[j] ? ' hit' : ''}`}><small>{l}</small><b className="tab-nums">{fmtN(counts[j])}</b></div>)}
        </div>
        <div className="linter-hist">
          <div className="row between small"><span>Token lengths {done ? 'before → after fixes' : 'as read'}</span><span className="mono">{demo ? `${fmtCompact(demo.report.tokens.total)}${done ? ` → ${fmtCompact(demo.after.tokens.total)}` : ''} tok` : ''}</span></div>
          {demo && <TokenHist before={before} after={done ? demo.after.tokens.hist : undefined} ctx={4096} height={92} />}
        </div>
      </div>
    </div>
  )
}

const FEATURES: [string, string][] = [
  ['Every line, with its number', 'Invalid JSON, unknown roles, empty turns, a missing final assistant turn, system prompts in the wrong place and broken tool calls, reported as file:line before your job fails at minute 40.'],
  ['Four formats in, four out', 'OpenAI chat, ShareGPT, Alpaca and DPO pairs are detected row by row and converted both ways. CSV columns are mapped by hand when the headers are vague.'],
  ['Duplicates and leakage', 'Exact hashes plus MinHash LSH catch paraphrased copies, and every eval row is checked against train so your eval loss means something.'],
  ['Things you should not train on', 'Emails, phone numbers, Luhn-valid card numbers and API keys, refusals, and the “Certainly! I’d be happy to help” opener your model will repeat forever.'],
  ['Tokens, truncation, cost', 'A tokenizer-free estimate within about 3% of cl100k on chat data, a length histogram against your context window, and cost for your epochs and price.'],
  ['Fix, split, version', 'One-click fix-ups with a before/after preview, a stratified split that keeps duplicate clusters together, clean JSONL export, a printable data card and diffable versions.'],
]

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow light">Dataset doctor for SFT and DPO</div>
            <h1>Fine-tune on data you have <span className="serif">actually read.</span></h1>
            <p className="lede">Finetune Lint validates and cleans chat JSONL before you upload it to any fine-tuning service. It finds broken rows, duplicates, eval leakage and leaked customer data, estimates tokens and cost, and writes back a clean train/eval split.</p>
            <div className="hero-ctas">
              <Link href="/app?sample=support-sft" className="btn primary lg">Open the sample dataset</Link>
              <Link href="/app" className="btn outline lg">Lint your own file</Link>
            </div>
            <p className="hero-note">Runs entirely in your browser. No account, no upload, no API key.</p>
          </div>
          <HeroLinter />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div className="eyebrow">Why</div>
          <h2>Bad rows cost a whole training run</h2>
          <p>The same stories come up in every fine-tuning thread: a job that fails validation after an hour in the queue, a LoRA that overfits because a third of the set was the same ticket pasted twice, an eval score that looked great because eval was in train, a model that starts every reply with the same sentence.</p>
        </div>
        <div className="pain">
          <blockquote><p>Enterprises pay for hosted inference on open models when they serve their own fine-tunes, and the fine-tune is only as good as its data.</p><cite>paraphrased from r/AI_Agents and r/SillyTavernAI threads on Together, Fireworks and DeepInfra</cite></blockquote>
          <blockquote><p>My fine-tune overfit and repeats phrases. Turned out the dataset had format errors and hundreds of near-identical examples.</p><cite>paraphrased from r/LocalLLaMA fine-tuning threads</cite></blockquote>
          <blockquote><p>You are wasting money on AI unless you use the right model for each job, which means more, smaller, tuned models.</p><cite>paraphrased from r/technology on a Fireworks interview</cite></blockquote>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><div className="eyebrow">What it does</div><h2>From a raw export to an upload-ready split</h2></div>
        <div className="features">
          {FEATURES.map(([h, p], i) => <article key={h} className="feature"><span className="feature-n mono">0{i + 1}</span><h3>{h}</h3><p>{p}</p></article>)}
        </div>
      </section>

      <section className="section">
        <div className="cta-band">
          <div>
            <h2>Lint the sample, then lint yours</h2>
            <p>1,200 synthetic support conversations with planted duplicates, leaks, card numbers, refusals and truncated lines, plus a DPO set with a length bias. Every finding is clickable.</p>
          </div>
          <div className="row gap wrap">
            <Link href="/app?sample=support-sft" className="btn light lg">SFT sample</Link>
            <Link href="/app?sample=support-dpo" className="btn outline-light lg">DPO sample</Link>
            <Link href="/docs" className="btn outline-light lg">Format guide</Link>
          </div>
        </div>
      </section>
    </>
  )
}
