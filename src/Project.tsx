import { lazy, Suspense, useEffect, useState } from 'react'
import type { Report } from './engine/analyze.ts'
import { makeVersion, runJob, useFixed, useProject, useReport, type Fixed } from './projectData.ts'
import { putData, type Dataset, type Project } from './store.ts'
import { Empty, fmtN, go, isTyping, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

const Tabs = lazy(() => import('./Tabs.tsx'))
const DataTab = lazy(() => import('./Import.tsx'))

export const TABS = [['overview', 'Overview'], ['issues', 'Issues'], ['dupes', 'Duplicates & leaks'], ['content', 'Content'], ['fix', 'Fix & export'], ['history', 'History'], ['data', 'Import & settings']] as const
export type Tab = (typeof TABS)[number][0]

export interface TabProps {
  project: Project
  ds: Dataset
  report: Report
  fixed: Fixed | null
  update(p: Partial<Project>): void
  /** Replaces the working dataset and records a version */
  commit(ds: Dataset, label: string, note: string): Promise<void>
}

export default function ProjectView({ id, tab: rawTab }: { id: string; tab: string }) {
  const { loading, project, ds, setDs, update } = useProject(id)
  const tab = (TABS.some(t => t[0] === rawTab) ? rawTab : 'overview') as Tab
  const { report, error } = useReport(ds, project?.opts)
  const fixed = useFixed(ds, project?.opts, project?.fixes)
  const [help, setHelp] = useState(false)

  useEffect(() => { if (project) document.title = `${project.name} · Finetune Lint` }, [project?.name])

  const setTab = (t: Tab) => go(`/app/p/${id}${t === 'overview' ? '' : '/' + t}`, { keepScroll: true })

  const commit = async (next: Dataset, label: string, note: string) => {
    if (!project) return
    const r = await runJob<Report>({ kind: 'analyze', rows: next.rows, opts: project.opts, parseErrors: next.parseErrors })
    const v = await makeVersion(project.id, next, r, label, note)
    await putData(project.id, next)
    setDs(next)
    await update({ versions: [...project.versions, v], dataMissing: false })
  }

  const saveVersion = async () => {
    if (!project || !ds || !report) return
    const n = project.versions.length + 1
    const v = await makeVersion(project.id, ds, report, `v${n} · saved`, 'Saved by hand')
    await update({ versions: [...project.versions, v] })
    toast(`Saved version v${n}`, { tone: 'ok', undo: () => void update({ versions: project.versions }) })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { e.preventDefault(); setTab(TABS[n - 1][0]) }
      else if (e.key === '?') setHelp(true)
      else if (e.key === 's') void saveVersion()
      else if (e.key === 'p') go(`/app/p/${id}/card`)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading the dataset</div>
  if (!project || !ds) return (
    <section className="page narrow center">
      <Empty title="Dataset not found"><p className="muted">It may have been deleted, or it lives on another device.</p><Link href="/app" className="btn primary">All datasets</Link></Empty>
    </section>
  )
  const empty = !ds.rows.length && !ds.parseErrors.length

  return (
    <section className="page">
      <div className="proj-head">
        <div>
          <div className="eyebrow"><Link href="/app">Datasets</Link></div>
          <h1 className="row gap wrap">{project.name} {project.sampleId && <SyntheticBadge />}</h1>
          {!empty && <p className="muted small" style={{ margin: 0 }}>{fmtN(ds.rows.length)} rows · {project.imports.map(i => i.fileName).slice(0, 3).join(', ')}{project.versions.length ? ` · ${project.versions.at(-1)!.label}` : ''}</p>}
        </div>
        {!empty && (
          <div className="toolbar">
            <button type="button" className="btn outline" onClick={() => void saveVersion()} title="Save a version (S)">Save version</button>
            <Link href={`/app/p/${id}/card`} className="btn primary" title="Printable data card (P)">Data card</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label="Dataset sections">
        {TABS.map(([t, l], i) => <Link key={t} href={`/app/p/${id}${t === 'overview' ? '' : '/' + t}`} aria-current={t === tab ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}</Link>)}
      </nav>
      <Suspense fallback={<div className="boot"><span className="spinner" /></div>}>
        {tab === 'data' || empty
          ? <DataTab project={project} ds={ds} update={update} commit={commit} />
          : error ? <div className="banner warn">Analysis failed: {error}</div>
          : !report ? <div className="boot" role="status"><span className="spinner" /> Linting {fmtN(ds.rows.length)} rows</div>
          : <Tabs tab={tab} project={project} ds={ds} report={report} fixed={fixed} update={update} commit={commit} />}
      </Suspense>
      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>7</kbd></dt><dd>Switch sections</dd></div>
          <div><dt><kbd>S</kbd></dt><dd>Save a version of the current dataset</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Open the printable data card</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last destructive action</dd></div>
        </dl>
      </Modal>
    </section>
  )
}
