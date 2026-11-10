// node scripts/qa-sync.mjs <email> <password> : checks what a QA account synced (projects + versions for this app), then deletes the account.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const [email, password] = process.argv.slice(2)
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const fail = m => { console.log('FAIL', m); process.exitCode = 1 }
const s = await sb.auth.signInWithPassword({ email, password })
if (s.error) { fail('sign in: ' + s.error.message); process.exit(1) }
const rows = await sb.from('projects').select('id,name,data').eq('app', 'finetune-lint')
if (rows.error) fail(rows.error.message)
for (const r of rows.data ?? []) console.log('ok   project', r.name, '| rows synced:', r.data.dataset?.rows?.length ?? 'kept on device', '| settings ctx', r.data.project.opts.ctx)
const vs = await sb.from('project_versions').select('label').in('project_id', (rows.data ?? []).map(r => r.id))
console.log(vs.data?.length ? `ok   ${vs.data.length} versions: ${vs.data.map(v => v.label).join(', ')}` : 'FAIL no versions')
const del = await sb.rpc('delete_my_account')
if (del.error) fail('delete: ' + del.error.message); else console.log('ok   delete_my_account')
const after = await sb.auth.signInWithPassword({ email, password })
console.log(after.error ? 'ok   account gone (' + after.error.message + ')' : 'FAIL account still exists')
