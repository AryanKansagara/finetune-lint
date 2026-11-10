import { useState } from 'react'
import { FIX_LABEL, type FixSet } from './engine/fixes.ts'
import { TARGET_LABEL, type Target } from './engine/formats.ts'
import { deleteProject, getDefaults, getProjects, setDefaults, type Defaults } from './store.ts'
import { exportAll, RAW_SYNC_LIMIT, useSync } from './sync.ts'
import { ask, download, setTheme, toast, useDark } from './ui.tsx'

const CTX = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const sync = useSync()
  const save = (p: Partial<Defaults>) => { const next = { ...d, ...p }; setD(next); setDefaults(next); toast('Saved', { tone: 'ok', ttl: 1500 }) }
  const opt = (p: Partial<Defaults['opts']>) => save({ opts: { ...d.opts, ...p } })

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel">
        <h2>Defaults for new datasets</h2>
        <p className="muted small">Existing datasets keep their own settings; change those on the dataset&rsquo;s Import &amp; settings tab.</p>
        <div className="inline-fields">
          <label className="field"><span>Context length</span><select value={d.opts.ctx} onChange={e => opt({ ctx: Number(e.target.value) })}>{CTX.map(c => <option key={c} value={c}>{c.toLocaleString()}</option>)}</select></label>
          <label className="field"><span>Price per 1M training tokens ($)</span><input type="number" min="0" step="0.05" value={d.opts.pricePerM} onChange={e => opt({ pricePerM: Math.max(0, Number(e.target.value)) })} /></label>
          <label className="field"><span>Epochs</span><input type="number" min="1" max="50" value={d.opts.epochs} onChange={e => opt({ epochs: Math.max(1, Math.round(Number(e.target.value))) })} /></label>
          <label className="field"><span>Throughput (tokens / second)</span><input type="number" min="100" step="500" value={d.opts.throughput} onChange={e => opt({ throughput: Math.max(100, Number(e.target.value)) })} /></label>
          <label className="field"><span>Near-duplicate threshold ({Math.round(d.opts.nearThreshold * 100)}%)</span><input type="range" min="0.5" max="0.98" step="0.02" value={d.opts.nearThreshold} onChange={e => opt({ nearThreshold: Number(e.target.value) })} /></label>
          <label className="field"><span>Eval share ({Math.round(d.evalFraction * 100)}%)</span><input type="range" min="0.02" max="0.3" step="0.01" value={d.evalFraction} onChange={e => save({ evalFraction: Number(e.target.value) })} /></label>
          <label className="field"><span>Export format</span><select value={d.target} onChange={e => save({ target: e.target.value as Target })}>{(Object.keys(TARGET_LABEL) as Target[]).map(t => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}</select></label>
        </div>
        <h3 style={{ marginTop: 18, fontSize: 15 }}>Fix-ups switched on by default</h3>
        <div className="check-grid">
          {(Object.keys(FIX_LABEL) as (keyof FixSet)[]).map(k => <label key={k} className="row gap-sm small"><input type="checkbox" checked={d.fixes[k]} onChange={e => save({ fixes: { ...d.fixes, [k]: e.target.checked } })} />{FIX_LABEL[k][0]}</label>)}
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Datasets live in this browser (IndexedDB) and are parsed here; nothing is uploaded for linting. {sync.user ? <>Signed in as <b>{sync.user.email}</b>: settings, fix choices, version summaries and datasets under {(RAW_SYNC_LIMIT / 1e6).toFixed(1)} MB sync to your account. Saved rows for older versions stay on this device.</> : 'Sign in from the account menu (top right) to sync across devices. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`finetune-lint-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete all local datasets?', `Removes ${list.length} dataset${list.length > 1 ? 's' : ''} from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(p => deleteProject(p.id)))
            toast(`Deleted ${list.length} datasets`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all datasets</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch dataset sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a version</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable data card</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last delete or fix-up</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>Show shortcuts on a dataset page</dd></div>
        </dl>
      </div>
    </section>
  )
}
