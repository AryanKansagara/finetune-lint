import { useEffect, useState } from 'react'
import { summarise, type Options, type Report } from './engine/analyze.ts'
import { rowKey } from './engine/dedupe.ts'
import type { FixLog, FixSet } from './engine/fixes.ts'
import { parseText } from './engine/formats.ts'
import { SAMPLES, sampleFiles } from './engine/sample.ts'
import type { Issue, Row } from './engine/types.ts'
import { KEY_CAP, type Version } from './engine/versions.ts'
import { getData, getDefaults, getProjects, putVersionData, saveProject, useProjects, uuid, type Dataset, type ImportMeta, type Project } from './store.ts'
import type { Job } from './worker.ts'

// ---------- Worker client ----------

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { res(v: unknown): void; rej(e: Error): void }>()
type JobInput = Job extends infer J ? J extends { id: number } ? Omit<J, 'id'> : never : never
export function runJob<T>(job: JobInput): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const w = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      if (e.data.ok) w?.res(e.data.result); else w?.rej(new Error(e.data.error))
    }
  }
  const id = ++seq
  return new Promise<T>((res, rej) => { waiting.set(id, { res: res as (v: unknown) => void, rej }); worker!.postMessage({ ...job, id }) })
}

// ---------- Samples ----------

/** Parses files into rows tagged with split and file name. */
export function parseFiles(files: { name: string; text: string; split: 'train' | 'eval' }[]): Dataset & { meta: ImportMeta[] } {
  const rows: Row[] = [], parseErrors: Issue[] = [], meta: ImportMeta[] = []
  for (const f of files) {
    const p = parseText(f.text)
    rows.push(...p.rows.map(r => ({ ...r, split: f.split, file: f.name })))
    parseErrors.push(...p.errors.map(e => ({ ...e, file: f.name })))
    meta.push({ id: uuid(), fileName: f.name, split: f.split, rows: p.rows.length, errors: p.errors.length, at: Date.now(), kind: p.kind })
  }
  return { rows, parseErrors, meta }
}

const sampleCache = new Map<string, Dataset & { meta: ImportMeta[] }>()
export function sampleDataset(id: string) {
  if (!SAMPLES.some(s => s.id === id)) return null
  if (!sampleCache.has(id)) sampleCache.set(id, parseFiles(sampleFiles(id)))
  return sampleCache.get(id)!
}

export function newProject(name: string, extra: Partial<Project> = {}): Project {
  const d = getDefaults(), now = Date.now()
  return { id: uuid(), name, createdAt: now, updatedAt: now, opts: d.opts, fixes: d.fixes, evalFraction: d.evalFraction, target: d.target, versions: [], imports: [], ...extra }
}

export async function makeVersion(projectId: string, ds: Dataset, report: Report, label: string, note: string): Promise<Version> {
  const v: Version = { id: uuid(), label, at: Date.now(), note, summary: summarise(report), keys: ds.rows.slice(0, KEY_CAP).map(rowKey) }
  await putVersionData(projectId, v.id, ds)
  return v
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = sampleDataset(sampleId)!
  const p = newProject(def.name, { sampleId, imports: ds.meta })
  const report = await runJob<Report>({ kind: 'analyze', rows: ds.rows, opts: p.opts, parseErrors: ds.parseErrors })
  const v = await makeVersion(p.id, ds, report, 'v1 · raw import', `Imported ${ds.meta.map(m => m.fileName).join(' and ')}`)
  return saveProject({ ...p, versions: [v] })
}

export const createBlankProject = (name: string) => saveProject(newProject(name))

// ---------- Hooks ----------

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') + project.versions.length : ''
  useEffect(() => {
    if (!project) return
    let live = true
    // Samples are regenerated until the user changes them; after that the stored copy wins.
    void getData(project.id).then(d => { if (live) setDs(d ?? ((project.sampleId && sampleDataset(project.sampleId)) || { rows: [], parseErrors: [] })) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project && saveProject({ ...project, ...patch })
  return { loading: list === null || (project !== null && ds === null), project, ds, setDs, update }
}

const reportCache = new WeakMap<Dataset, Map<string, Report>>()
export function useReport(ds: Dataset | null, opts: Options | undefined) {
  const key = JSON.stringify(opts)
  const cached = ds && reportCache.get(ds)?.get(key)
  const [state, setState] = useState<{ report: Report | null; error: string | null }>({ report: cached ?? null, error: null })
  useEffect(() => {
    if (!ds || !opts) return
    const c = reportCache.get(ds)?.get(key)
    if (c) { setState({ report: c, error: null }); return }
    let live = true
    runJob<Report>({ kind: 'analyze', rows: ds.rows, opts, parseErrors: ds.parseErrors })
      .then(r => { const m = reportCache.get(ds) ?? new Map(); m.set(key, r); reportCache.set(ds, m); if (live) setState({ report: r, error: null }) })
      .catch(e => live && setState({ report: null, error: e.message }))
    return () => { live = false }
  }, [ds, key])
  return { report: cached ?? state.report, error: state.error }
}

export interface Fixed { rows: Row[]; log: FixLog[]; report: Report }
const fixCache = new WeakMap<Dataset, Map<string, Fixed>>()
export function useFixed(ds: Dataset | null, opts: Options | undefined, fixes: FixSet | undefined) {
  const key = JSON.stringify([opts, fixes])
  const cached = ds && fixCache.get(ds)?.get(key)
  const [fixed, setFixed] = useState<Fixed | null>(cached ?? null)
  useEffect(() => {
    if (!ds || !opts || !fixes) return
    const c = fixCache.get(ds)?.get(key)
    if (c) { setFixed(c); return }
    let live = true
    setFixed(null)
    void runJob<Fixed>({ kind: 'fix', rows: ds.rows, opts, fixes }).then(r => { const m = fixCache.get(ds) ?? new Map(); m.set(key, r); fixCache.set(ds, m); if (live) setFixed(r) })
    return () => { live = false }
  }, [ds, key])
  return cached ?? fixed
}
