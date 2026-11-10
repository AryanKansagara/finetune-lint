import { useMemo, useRef, useState } from 'react'
import { DEFAULT_OPTIONS, type Options } from './engine/analyze.ts'
import { csvToRecords, guessCsvMapping, parseRecords, parseText, type CsvMapping, type CsvRole } from './engine/formats.ts'
import { sampleFiles } from './engine/sample.ts'
import { FORMAT_LABEL, type Format, type Issue, type Row } from './engine/types.ts'
import { validateRow } from './engine/validate.ts'
import { createBlankProject } from './projectData.ts'
import { putData, saveProject, uuid, type Dataset, type Project } from './store.ts'
import { RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, fmtN, go, Link, toast } from './ui.tsx'

interface Pending { id: string; name: string; text: string; kind: 'jsonl' | 'json' | 'csv'; split: 'train' | 'eval'; map?: CsvMapping; header?: string[] }

const CSV_ROLES: [CsvRole, string][] = [['ignore', 'Ignore'], ['messages', 'Messages (JSON)'], ['system', 'System prompt'], ['user', 'User / instruction'], ['input', 'Input (appended to user)'], ['assistant', 'Assistant / output'], ['chosen', 'Chosen'], ['rejected', 'Rejected'], ['label', 'Label / class']]

function parsePending(p: Pending): { rows: Row[]; errors: Issue[]; formats: Partial<Record<Format, number>> } {
  if (p.kind !== 'csv' || !p.map) return parseText(p.text)
  const csv = parseText(p.text, p.map).csv!
  const { records, errors } = csvToRecords(csv, p.map)
  return parseRecords(records, errors)
}

export default function DataTab({ project, ds, update, commit }: { project: Project; ds: Dataset; update(p: Partial<Project>): void; commit(ds: Dataset, label: string, note: string, patch?: Partial<Project>): Promise<void> }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sync = useSync()
  const rawSize = useMemo(() => JSON.stringify(ds).length, [ds])

  const readFiles = async (files: FileList | File[]) => {
    setBusy(true)
    const next: Pending[] = []
    for (const f of [...files]) {
      if (f.size > 200_000_000) { toast(`${f.name} is over 200 MB. Split it or lint a sample of it first.`, { tone: 'error' }); continue }
      if (/\.parquet$/i.test(f.name)) { toast(`${f.name}: Parquet is not read in the browser. Convert with pandas: pd.read_parquet(f).to_json("data.jsonl", orient="records", lines=True)`, { tone: 'error', ttl: 9000 }); continue }
      const text = await f.text()
      if (!text.trim()) { toast(`${f.name} is empty.`, { tone: 'error' }); continue }
      const head = text.trimStart()
      const kind = head.startsWith('[') && /\.json$/i.test(f.name) ? 'json' : head.startsWith('{') || head.startsWith('[') ? 'jsonl' : 'csv'
      const split = /(eval|valid|val|test|dev)[^/]*$/i.test(f.name) ? 'eval' : 'train'
      const p: Pending = { id: uuid(), name: f.name, text, kind, split }
      if (kind === 'csv') { const csv = parseText(text); p.header = csv.csv?.rows[0] ?? []; p.map = guessCsvMapping(p.header) }
      next.push(p)
    }
    setPending(x => [...x, ...next])
    setBusy(false)
  }

  /** Samples keep their synthetic files; importing your own data into one starts a new project. */
  const add = async (p: Pending, mode: 'append' | 'replace') => {
    const parsed = parsePending(p)
    if (!parsed.rows.length && !parsed.errors.length) { toast('Nothing to import in that file.', { tone: 'error' }); return }
    const rows = parsed.rows.map(r => ({ ...r, split: p.split, file: p.name }))
    const errors = parsed.errors.map(e => ({ ...e, file: p.name }))
    const meta = { id: uuid(), fileName: p.name, split: p.split, rows: rows.length, errors: errors.length, at: Date.now(), kind: p.kind }
    if (project.sampleId) {
      const t = await createBlankProject(p.name.replace(/\.(jsonl?|csv|tsv)$/i, ''))
      const next = { rows, parseErrors: errors }
      await putData(t.id, next)
      await saveProject({ ...t, imports: [meta] })
      go(`/app/p/${t.id}`)
      toast(`Started a new dataset from ${p.name}`, { tone: 'ok' })
      return
    }
    if (mode === 'replace' && ds.rows.length && !(await ask('Replace the dataset?', `The current ${fmtN(ds.rows.length)} rows are replaced by ${fmtN(rows.length)} rows from ${p.name}. Earlier versions stay in History and can be restored.`, 'Replace', false))) return
    const keep = mode === 'append' ? ds : { rows: [], parseErrors: [] }
    const next = { rows: [...keep.rows, ...rows], parseErrors: [...keep.parseErrors, ...errors] }
    await commit(next, `v${project.versions.length + 1} · import`, `${mode === 'append' ? 'Added' : 'Imported'} ${p.name} (${fmtN(rows.length)} rows as ${p.split})`, { imports: [...(mode === 'append' ? project.imports : []), meta] })
    setPending(x => x.filter(y => y.id !== p.id))
    if (!ds.rows.length) go(`/app/p/${project.id}`)
    toast(`Imported ${fmtN(rows.length)} rows${errors.length ? `; ${errors.length} lines could not be read` : ''}`, { tone: 'ok' })
  }

  return (
    <>
      {project.dataMissing && <div className="banner warn"><span><strong>This dataset&rsquo;s rows are on another device.</strong> Settings and version history synced; datasets over {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB stay where they were imported. Re-import here to lint again.</span></div>}
      {!ds.rows.length && !pending.length && (
        <div className="banner"><span><strong>Start here.</strong> Drop your training file (and an eval file, if you have one). Not sure what shape it needs? <Link href="/docs">See the format guide</Link>.</span></div>
      )}
      <div className="panel">
        <div className="panel-head"><h2>Import</h2><span className="muted small">JSONL · JSON array · CSV/TSV &nbsp;|&nbsp; OpenAI chat, ShareGPT, Alpaca, DPO</span></div>
        {project.sampleId && <p className="muted small">This is a synthetic sample. Importing here starts a new dataset. Want to rehearse the import? {sampleFiles(project.sampleId).map(f => <button key={f.name} type="button" className="linkish" style={{ marginRight: 10 }} onClick={() => download(f.name, f.text, 'application/jsonl')}>Download {f.name}</button>)}</p>}
        <div className={`drop${drag ? ' over' : ''}`} role="button" tabIndex={0} aria-label="Choose dataset files to import"
          onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void readFiles(e.dataTransfer.files) }}>
          <h3>{busy ? 'Reading files' : 'Drop train or eval files here, or click to choose'}</h3>
          <p className="muted small" style={{ margin: 0 }}>Parsed in your browser; nothing is uploaded. Files named *eval*, *valid* or *test* are marked as eval.</p>
          <input ref={input} type="file" accept=".jsonl,.json,.csv,.tsv,.txt,.ndjson" multiple hidden onChange={e => { if (e.target.files) void readFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {pending.map(p => <PendingFile key={p.id} p={p} hasData={ds.rows.length > 0} onChange={n => setPending(x => x.map(y => y.id === p.id ? n : y))} onCancel={() => setPending(x => x.filter(y => y.id !== p.id))} onAdd={add} />)}

      <ProjectSettings project={project} update={update} />

      {project.imports.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Files in this dataset</h2><span className="muted small">{sync.user ? (rawSize <= RAW_SYNC_LIMIT ? 'Rows sync to your account' : `Rows stay on this device (over ${(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB); settings and versions sync`) : 'Stored on this device'}</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>File</th><th>Split</th><th className="num">Rows</th><th className="num">Unreadable lines</th><th>Imported</th></tr></thead>
            <tbody>{project.imports.map(i => <tr key={i.id}><th scope="row" className="mono small">{i.fileName}</th><td><span className={`badge ${i.split}`}>{i.split}</span></td><td className="num">{fmtN(i.rows)}</td><td className={`num${i.errors ? ' error' : ''}`}>{fmtN(i.errors)}</td><td className="muted small">{new Date(i.at).toLocaleString()}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </>
  )
}

function PendingFile({ p, hasData, onChange, onCancel, onAdd }: { p: Pending; hasData: boolean; onChange(p: Pending): void; onCancel(): void; onAdd(p: Pending, mode: 'append' | 'replace'): Promise<void> }) {
  const parsed = useMemo(() => parsePending(p), [p.text, p.map])
  const structural = useMemo(() => parsed.rows.flatMap(validateRow), [parsed])
  const [busy, setBusy] = useState(false)
  const lines = [...parsed.errors, ...structural].sort((a, b) => a.line - b.line)
  const fmts = Object.entries(parsed.formats) as [Format, number][]
  const run = async (mode: 'append' | 'replace') => { setBusy(true); try { await onAdd(p, mode) } finally { setBusy(false) } }
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="mono" style={{ fontSize: '1.05rem' }}>{p.name}</h2>
        <span className="muted small">{p.kind.toUpperCase()} · {fmtN(parsed.rows.length)} rows read{parsed.errors.length ? ` · ${parsed.errors.length} lines unreadable` : ''}</span>
      </div>
      <div className="row gap wrap" style={{ marginBottom: 12 }}>
        <span className="small strong">Detected:</span>
        {fmts.length ? fmts.map(([f, n]) => <span key={f} className="chip">{FORMAT_LABEL[f]} <b>{fmtN(n)}</b></span>) : <span className="error small">No recognisable rows</span>}
        {fmts.length > 1 && <span className="warn-text small">Mixed formats in one file; they are normalised to one shape on export.</span>}
      </div>
      {p.kind === 'csv' && p.header && p.map && (
        <div className="stack-sm" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 15 }}>Map columns</h3>
          <div className="map-grid">
            {p.header.map((h, i) => (
              <label key={i} className="field"><span className="mono">{h || `column ${i + 1}`}</span>
                <select value={p.map![i]} onChange={e => { const map = [...p.map!]; map[i] = e.target.value as CsvRole; onChange({ ...p, map }) }}>
                  {CSV_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      <h3 style={{ fontSize: 15 }}>Validation report {lines.length ? <span className="muted small">({fmtN(lines.length)} findings{lines.length > 300 ? ', first 300 shown' : ''})</span> : <span className="good-text small">no structural problems</span>}</h3>
      {lines.length > 0 && (
        <div className="issues" role="list">
          {lines.slice(0, 300).map((x, i) => <div key={i} role="listitem" className={x.code === 'invalid_json' || x.code === 'unknown_shape' ? 'error-row' : ''}><span className="ln">line {x.line}</span><span>{x.message}</span></div>)}
        </div>
      )}
      <div className="row between wrap gap" style={{ marginTop: 14 }}>
        <label className="row gap-sm small">Use as
          <select value={p.split} onChange={e => onChange({ ...p, split: e.target.value as 'train' | 'eval' })} aria-label="Split for this file">
            <option value="train">training data</option><option value="eval">evaluation data</option>
          </select>
        </label>
        <div className="row gap-sm">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          {hasData && <button type="button" className="btn outline" disabled={busy} onClick={() => void run('replace')}>Replace dataset</button>}
          <button type="button" className="btn primary" disabled={busy || (!parsed.rows.length && !parsed.errors.length)} onClick={() => void run('append')}>{hasData ? 'Add to dataset' : 'Import and lint'}</button>
        </div>
      </div>
    </div>
  )
}

const CTX = [2048, 4096, 8192, 16384, 32768, 65536, 131072]
export function ProjectSettings({ project, update, compact }: { project: Project; update(p: Partial<Project>): void; compact?: boolean }) {
  const o = project.opts
  const set = (patch: Partial<Options>) => update({ opts: { ...o, ...patch } })
  const num = (v: string, min: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= min ? n : fallback }
  return (
    <div className={compact ? '' : 'panel'}>
      {!compact && <div className="panel-head"><h2>Training settings</h2><span className="muted small">Used for truncation, the cost estimate and duplicate matching</span></div>}
      <div className="inline-fields">
        <label className="field"><span>Context length (tokens)</span>
          <select value={o.ctx} onChange={e => set({ ctx: Number(e.target.value) })}>{CTX.map(c => <option key={c} value={c}>{c.toLocaleString()}</option>)}</select>
        </label>
        <label className="field"><span>Price per 1M training tokens ($)</span><input type="number" min="0" step="0.05" value={o.pricePerM} onChange={e => set({ pricePerM: num(e.target.value, 0, DEFAULT_OPTIONS.pricePerM) })} /></label>
        <label className="field"><span>Epochs</span><input type="number" min="1" max="50" step="1" value={o.epochs} onChange={e => set({ epochs: Math.round(num(e.target.value, 1, 1)) })} /></label>
        {!compact && <label className="field"><span>Throughput (tokens / second)</span><input type="number" min="100" step="500" value={o.throughput} onChange={e => set({ throughput: num(e.target.value, 1, DEFAULT_OPTIONS.throughput) })} /></label>}
        {!compact && <label className="field"><span>Near-duplicate threshold ({Math.round(o.nearThreshold * 100)}% similar)</span><input type="range" min="0.5" max="0.98" step="0.02" value={o.nearThreshold} onChange={e => set({ nearThreshold: Number(e.target.value) })} /></label>}
      </div>
      {!compact && <p className="muted small" style={{ margin: '10px 0 0' }}>No default price is a quote. Enter the rate from your provider&rsquo;s pricing page for the model size you are tuning (<Link href="/docs#cost">how the estimate works</Link>).</p>}
    </div>
  )
}
