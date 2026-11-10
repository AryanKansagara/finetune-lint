// Content scans: personal data and secrets, refusals, boilerplate openers, language, label balance.

// ---------- PII and secrets ----------

export type PiiType = 'email' | 'phone' | 'card' | 'ssn' | 'secret'
export const PII_LABEL: Record<PiiType, string> = { email: 'Email address', phone: 'Phone number', card: 'Card number (Luhn-valid)', ssn: 'US SSN', secret: 'API key or secret' }
export const PLACEHOLDER: Record<PiiType, string> = { email: '[EMAIL]', phone: '[PHONE]', card: '[CARD]', ssn: '[SSN]', secret: '[SECRET]' }
export interface PiiHit { type: PiiType; start: number; end: number; value: string }

export function luhn(digits: string): boolean {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (alt) { d *= 2; if (d > 9) d -= 9 }
    sum += d; alt = !alt
  }
  return digits.length >= 12 && sum % 10 === 0
}

const SECRET = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bfw_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g,
  /\b(?:api[_-]?key|secret|access[_-]?token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/gi,
]
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g
const SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
const PHONE = /(?:(?<![\w])\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\b\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}\b/g

/** Non-overlapping PII hits, most specific first (a card number is not also reported as a phone number). */
export function scanPii(text: string): PiiHit[] {
  const hits: PiiHit[] = []
  const free = (s: number, e: number) => !hits.some(h => s < h.end && e > h.start)
  const add = (type: PiiType, re: RegExp, ok: (v: string) => boolean = () => true) => {
    for (const m of text.matchAll(re)) {
      const s = m.index!, e = s + m[0].length
      if (ok(m[0]) && free(s, e)) hits.push({ type, start: s, end: e, value: m[0] })
    }
  }
  for (const re of SECRET) add('secret', re)
  add('email', EMAIL)
  add('card', CARD, v => { const d = v.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) })
  add('ssn', SSN)
  // Long digit runs that fail Luhn (order or tracking numbers) are not phone numbers either.
  for (const m of text.matchAll(CARD)) if (free(m.index!, m.index! + m[0].length)) hits.push({ type: 'phone', start: m.index!, end: m.index! + m[0].length, value: '' })
  add('phone', PHONE, v => { const d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15 && !/^(19|20)\d{2}[-./]\d{2}[-./]\d{2}$/.test(v.trim()) })
  return hits.filter(h => h.value).sort((a, b) => a.start - b.start)
}

export function redact(text: string): { text: string; hits: PiiHit[] } {
  const hits = scanPii(text)
  let out = '', at = 0
  for (const h of hits) { out += text.slice(at, h.start) + PLACEHOLDER[h.type]; at = h.end }
  return { text: out + text.slice(at), hits }
}

// ---------- Refusals and boilerplate ----------

const REFUSAL = /\b(?:I'?m sorry,? but I (?:can(?:'|no)?t|am unable|won'?t)|I (?:cannot|can'?t|am unable to|won'?t) (?:help|assist|provide|comply|do that|share)|as an AI(?: language model)?\b|I(?:'m| am) (?:just |only )?an AI\b|I(?:'m| am) not able to (?:help|provide|assist)|I must (?:respectfully )?decline|against my (?:guidelines|programming|policies)|I don'?t have (?:the ability|access) to (?:browse|access real-time))/i

export const isRefusal = (s: string) => REFUSAL.test(s)

/** First five normalised words of a reply; used to find openers repeated across the dataset. */
export const opener = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ')

/** Openers that start at least `minShare` of replies (and at least 8 of them). These teach a verbal tic. */
export function boilerplate(replies: string[], minShare = 0.04): { opener: string; count: number }[] {
  const c = new Map<string, number>()
  for (const r of replies) { const o = opener(r); if (o.split(' ').length >= 3) c.set(o, (c.get(o) ?? 0) + 1) }
  return [...c].filter(([, n]) => n >= Math.max(8, replies.length * minShare)).sort((a, b) => b[1] - a[1]).map(([opener, count]) => ({ opener, count }))
}

// ---------- Language ----------

const SCRIPTS: [RegExp, string][] = [
  [/[぀-ヿ]/g, 'ja'], [/[가-힯]/g, 'ko'], [/[一-鿿]/g, 'zh'], [/[Ѐ-ӿ]/g, 'ru'],
  [/[؀-ۿ]/g, 'ar'], [/[ऀ-ॿ]/g, 'hi'], [/[Ͱ-Ͽ]/g, 'el'], [/[֐-׿]/g, 'he'], [/[฀-๿]/g, 'th'],
]
export const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', el: 'Greek', he: 'Hebrew', th: 'Thai', und: 'Undetermined' }

// Short seed texts per language. Character trigram profiles built from these separate Latin-script languages well on 40+ letters.
const SEED: Record<string, string> = {
  en: 'the order was shipped and you should receive it within three business days. thank you for your patience while we look into this. please let me know if there is anything else i can help you with today. your account has been updated and the refund will appear on your statement. what is the best way to reach you about this issue? we have checked the tracking number and it shows that the package is on its way. this is how you reset your password from the settings page',
  es: 'el pedido fue enviado y deberías recibirlo dentro de tres días hábiles. gracias por tu paciencia mientras revisamos esto. por favor avísame si hay algo más en lo que pueda ayudarte hoy. tu cuenta ha sido actualizada y el reembolso aparecerá en tu estado de cuenta. cuál es la mejor manera de contactarte sobre este problema? hemos revisado el número de seguimiento y muestra que el paquete está en camino. así es como puedes restablecer tu contraseña desde la página de configuración',
  fr: 'la commande a été expédiée et vous devriez la recevoir dans les trois jours ouvrables. merci de votre patience pendant que nous examinons cela. n\'hésitez pas à me dire si je peux vous aider avec autre chose aujourd\'hui. votre compte a été mis à jour et le remboursement apparaîtra sur votre relevé. quelle est la meilleure façon de vous joindre au sujet de ce problème? nous avons vérifié le numéro de suivi et le colis est en route. voici comment réinitialiser votre mot de passe depuis la page des paramètres',
  de: 'die bestellung wurde versandt und sie sollten sie innerhalb von drei werktagen erhalten. vielen dank für ihre geduld, während wir das prüfen. bitte lassen sie mich wissen, ob ich ihnen heute noch bei etwas anderem helfen kann. ihr konto wurde aktualisiert und die rückerstattung erscheint auf ihrer abrechnung. wie können wir sie am besten wegen dieses problems erreichen? wir haben die sendungsnummer überprüft und das paket ist unterwegs. so setzen sie ihr passwort auf der seite einstellungen zurück',
  pt: 'o pedido foi enviado e você deve recebê-lo em até três dias úteis. obrigado pela sua paciência enquanto verificamos isso. por favor me avise se houver mais alguma coisa em que eu possa ajudar hoje. sua conta foi atualizada e o reembolso aparecerá no seu extrato. qual é a melhor forma de entrar em contato com você sobre esse problema? verificamos o código de rastreamento e o pacote está a caminho. é assim que você redefine sua senha na página de configurações',
  it: 'l\'ordine è stato spedito e dovresti riceverlo entro tre giorni lavorativi. grazie per la pazienza mentre verifichiamo. fammi sapere se c\'è qualcos\'altro in cui posso aiutarti oggi. il tuo account è stato aggiornato e il rimborso apparirà sul tuo estratto conto. qual è il modo migliore per contattarti riguardo a questo problema? abbiamo controllato il numero di tracciamento e il pacco è in viaggio. ecco come reimpostare la password dalla pagina delle impostazioni',
  nl: 'de bestelling is verzonden en je zou hem binnen drie werkdagen moeten ontvangen. bedankt voor je geduld terwijl we dit bekijken. laat me weten of ik je vandaag nog ergens anders mee kan helpen. je account is bijgewerkt en de terugbetaling verschijnt op je afschrift. wat is de beste manier om je over dit probleem te bereiken? we hebben het trackingnummer gecontroleerd en het pakket is onderweg. zo stel je je wachtwoord opnieuw in via de pagina instellingen',
}

const STOP: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  en: 'the and is it to of you that for my was with this have not are can on your what how',
  es: 'el la los las de que y es en un una por para mi tu con no lo se del',
  fr: 'le la les de des et est un une pour je vous que pas mon ma ne du sur',
  de: 'der die das und ist ich nicht ein eine sie zu mit den für mein wir auf',
  pt: 'o a os as de que e é um uma para não meu minha com do da você em',
  it: 'il lo la gli le di che e è un una per non mio con del della sono',
  nl: 'de het een en is ik niet je van dat op te met voor zijn mijn wat',
}).map(([k, v]) => [k, new Set(v.split(' '))]))

function trigrams(s: string): Map<string, number> {
  const t = ' ' + s.toLowerCase().replace(/[^\p{L}\s']+/gu, ' ').replace(/\s+/g, ' ').trim() + ' '
  const m = new Map<string, number>()
  for (let i = 0; i + 3 <= t.length; i++) { const g = t.slice(i, i + 3); m.set(g, (m.get(g) ?? 0) + 1) }
  return m
}
const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0))
const PROFILES = Object.entries(SEED).map(([lang, text]) => { const m = trigrams(text); return { lang, m, n: norm(m) } })

/** Script detection for non-Latin text, then cosine similarity of character trigram profiles for Latin-script languages. */
export function detectLanguage(text: string): { lang: string; confidence: number } {
  const s = text.slice(0, 2000)
  const letters = (s.match(/\p{L}/gu) ?? []).length
  if (letters < 20) return { lang: 'und', confidence: 0 }
  for (const [re, lang] of SCRIPTS) { const n = (s.match(re) ?? []).length; if (n / letters > 0.3) return { lang, confidence: Math.min(1, n / letters) } }
  if (letters < 40) return { lang: 'und', confidence: 0 }
  const m = trigrams(s), n = norm(m)
  // Trigram cosine plus a stop-word share; the stop words settle close calls between related languages.
  const words = s.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean)
  const scores = PROFILES.map(p => {
    let dot = 0
    for (const [g, v] of m) { const w = p.m.get(g); if (w) dot += v * w }
    const stop = words.filter(w => STOP[p.lang].has(w)).length / (words.length || 1)
    return { lang: p.lang, s: dot / (n * p.n || 1) + stop }
  }).sort((a, b) => b.s - a.s)
  const [a, b] = scores
  if (a.s < 0.08) return { lang: 'und', confidence: 0 }
  return { lang: a.lang, confidence: Math.max(0, Math.min(1, (a.s - b.s) / a.s * 2)) }
}

// ---------- Labels ----------

/** Short final answers repeated across many rows mean a classification-style task. Returns the inferred label per row, or null. */
export function inferLabels(finals: string[]): (string | null)[] | null {
  if (finals.length < 20) return null
  const norm = finals.map(f => { const t = f.trim().toLowerCase().replace(/[.!]+$/, ''); return t.split(/\s+/).length <= 4 && t.length <= 40 ? t : null })
  const short = norm.filter(Boolean).length
  const distinct = new Set(norm.filter(Boolean)).size
  if (short / finals.length < 0.8 || distinct > Math.max(20, finals.length * 0.05) || distinct < 2) return null
  return norm
}

export function balance(labels: (string | null | undefined)[]): { classes: [string, number][]; ratio: number; majorityShare: number } {
  const c = new Map<string, number>()
  for (const l of labels) if (l) c.set(l, (c.get(l) ?? 0) + 1)
  const classes = [...c].sort((a, b) => b[1] - a[1])
  const total = classes.reduce((s, x) => s + x[1], 0)
  return { classes, ratio: classes.length > 1 ? classes[0][1] / classes.at(-1)![1] : 1, majorityShare: total ? classes[0]?.[1] / total : 0 }
}
