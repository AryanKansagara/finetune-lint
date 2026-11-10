// Synthetic datasets for a made-up retailer ("Northwind Outfitters"). Every name, order, card and key is fake.
// The SFT set has planted problems so each check has something real to find.
import { rng } from './fixes.ts'

export interface SampleFile { name: string; text: string; split: 'train' | 'eval' }
export interface SampleDef { id: string; name: string; blurb: string }
export const SAMPLES: SampleDef[] = [
  { id: 'support-sft', name: 'Support bot SFT (synthetic)', blurb: '1,200 train + 120 eval chat rows with planted duplicates, eval leaks, PII, refusals and broken lines' },
  { id: 'support-dpo', name: 'Support bot DPO pairs (synthetic)', blurb: '160 preference pairs with identical pairs, a missing side and a strong length bias' },
]

const SYSTEM = 'You are Nora, the customer support assistant for Northwind Outfitters, an online outdoor gear store. Be accurate, brief and friendly. Use the lookup_order tool when the customer gives an order number. Never ask for full card numbers.'
const FIRST = ['Maya', 'Liam', 'Priya', 'Jonas', 'Aiko', 'Mateo', 'Grace', 'Omar', 'Elena', 'Tom', 'Zara', 'Felix', 'Hana', 'Diego', 'Ruth', 'Sam']
const PRODUCT = ['Ridgeline 2 tent', 'Alpine down jacket', 'Trailhead 45L pack', 'Summit trekking poles', 'Basecamp stove', 'Drift sleeping bag', 'Canyon hiking boots', 'Harbor rain shell', 'Ember headlamp', 'Glacier water filter', 'Pinecrest camp chair', 'Tundra insulated bottle']
const CARRIER = ['UPS', 'FedEx', 'USPS', 'DHL']
const HELLO = ['Hi,', 'Hello,', 'Hey there,', 'Good morning,', '', 'Hi Nora,', 'Quick question:']
const THANKS = ['Thanks!', 'Thank you.', 'Appreciate it.', '', 'Thanks in advance.', 'Please help.']
const OPEN = ['Certainly! I\'d be happy to help with that.', 'Thanks for reaching out.', 'Sorry about the trouble.', 'Good question.', 'Let me sort that out for you.', '', '']
const CLOSE = ['Anything else I can help with?', 'Let me know if you need anything else.', 'Happy trails!', '', 'I\'m here if you have more questions.']

const DETAIL = ['I ordered it on my phone.', 'This is my second order with you.', 'It was a birthday present.', 'I need it before a trip next weekend.', 'My partner placed the order.', 'I used the app, not the website.', 'I paid with Apple Pay.', 'I live in a rural area.', 'The order was a gift for my dad.', 'I already emailed once last week.', 'Your chat widget kept timing out.', 'I am travelling at the moment.', 'We are leaving for the Rockies on Friday.', 'I bought two of them.', 'It was on sale at the time.', 'I have been a Trail Club member for years.', 'The confirmation email looked normal.', 'I checked the FAQ first.', 'It is for a school camping trip.', 'My neighbour had the same problem.', 'I am not very good with websites.', 'I would rather not call.', 'The website was slow yesterday.', 'I am on a work laptop.']
const EXTRA = ['I have added a note to your account so the team has the context.', 'You will get an email confirmation in a few minutes.', 'For a trip this weekend, choose express shipping on any replacement.', 'Trail Club members get free express shipping on replacements.', 'I have also checked that nothing else on the account looks off.', 'The help centre has a short guide with screenshots if you prefer.', 'Nothing else is needed from you right now.', 'If you reply here, the same conversation stays open.', 'Our team replies within a few hours on weekdays.', 'You do not need to call; this chat is enough.', 'This works the same in the app and on the website.', 'I can stay on this chat while you try it.', 'Keep the original packaging if you still have it.', 'Gift orders follow the same rules.', 'Sale items are covered in the same way.', 'Your order history is under Account, then Orders.', 'I have flagged this so it does not happen again.', 'The confirmation will show the updated details.', 'You will see the change reflected within the hour.', 'Thanks for your patience while I checked.']

type Gen = (r: () => number) => { user: string; reply: string; tool?: { name: string; args: Record<string, unknown>; result: Record<string, unknown> } }
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]
const order = (r: () => number) => `NW-${10000 + Math.floor(r() * 89999)}`
const money = (r: () => number) => `$${(15 + Math.floor(r() * 380)) + 0.99}`
const days = (r: () => number) => 2 + Math.floor(r() * 6)

const INTENTS: { id: string; weight: number; gens: Gen[] }[] = [
  { id: 'billing', weight: 0.4, gens: [
    r => { const o = order(r), m = money(r); return { user: `I was charged twice for order ${o}, both for ${m}. Can you refund one of them?`, reply: `I can see two authorisations of ${m} for ${o}. One is a pending hold that drops off on its own within ${days(r)} business days; only one charge will settle. If both still show as posted after that, reply here and I will refund the duplicate right away.` } },
    r => { const m = money(r); return { user: `There's a ${m} charge from Northwind on my statement that I don't recognise.`, reply: `Charges from us appear as "NORTHWIND OUTFTRS". The ${m} amount usually matches an order, a gift card or a subscription renewal for Trail Club. If you share the email on the account, I can match it to the exact order for you.` } },
    r => ({ user: `How do I change the billing address on my account? I moved ${pick(r, ['last week', 'recently', 'this month', 'in September'])}.`, reply: `Go to Account, then Payment methods, choose the card and select Edit billing address. The new address applies to future orders; orders already placed keep the address they were paid with.` }),
    r => { const o = order(r); return { user: `Can I get a VAT invoice for order ${o}? My company needs it for expenses.`, reply: `Yes. Open Orders, select ${o} and choose Download invoice. If you need your company name or VAT number on it, add them under Account, then Business details, and download the invoice again; it regenerates with the new details.` } },
    r => { const c = pick(r, ['TRAIL15', 'SUMMIT20', 'WELCOME10', 'CAMPFIRE']); return { user: `My promo code ${c} didn't apply at checkout. ${pick(r, ['It just said invalid.', 'The total did not change.', 'Is it expired?'])}`, reply: `${c} only applies to full-price items and cannot be combined with other offers. If your cart had sale items, the discount is calculated on the rest. Tell me your order number and I can apply the difference as store credit if it should have worked.` } },
    r => ({ user: `Do you offer payment in instalments for the ${pick(r, PRODUCT)}?`, reply: `Yes, orders over $150 can be split into four interest-free payments with Klarna at checkout. The first payment is taken when the order ships.` }),
  ] },
  { id: 'shipping', weight: 0.25, gens: [
    r => { const o = order(r), c = pick(r, CARRIER), d = days(r); return { user: `Where is my order ${o}? It's been ${d + 3} days.`, reply: `Order ${o} shipped with ${c} and is in transit. The latest scan shows it at the regional hub, and the estimated delivery is in ${d} business days. You can follow it from the tracking link in your shipping email.`, tool: { name: 'lookup_order', args: { order_id: o }, result: { order_id: o, status: 'in_transit', carrier: c, eta_days: d } } } },
    r => ({ user: `Do you ship to ${pick(r, ['Canada', 'the UK', 'Australia', 'Germany', 'Japan', 'Mexico'])}?`, reply: `We ship there. International orders take 7 to 14 business days, and duties are calculated at checkout so there is nothing extra to pay on delivery.` }),
    r => { const o = order(r); return { user: `Can I change the delivery address for ${o}? I typed the wrong apartment number.`, reply: `If ${o} has not been packed yet I can update it. Reply with the corrected address and I will change it before it ships; once it is with the carrier you can redirect it from their tracking page.` } },
    r => ({ user: `My tracking says delivered but there's no package. ${pick(r, ['I checked with neighbours.', 'Nothing at the door.', 'The building manager has nothing.'])}`, reply: `Sorry about that. Carriers sometimes mark parcels delivered a day early. Please check again tomorrow; if it still has not arrived, reply here and I will open a trace with the carrier and send a replacement if they cannot find it.` }),
  ] },
  { id: 'account', weight: 0.2, gens: [
    r => ({ user: `I can't log in, the password reset email never arrives. ${pick(r, ['I tried three times.', 'I checked spam.', 'Is something broken?'])}`, reply: `Reset emails come from our no-reply address and can take a few minutes. Check spam and promotions folders. If it is still missing, the account may be under a different email; tell me any other address you use and I will look it up.` }),
    r => ({ user: `How do I delete my Northwind account?`, reply: `Go to Account, then Privacy and choose Delete account. We remove your profile and saved addresses within 30 days. Order records are kept for seven years because tax law requires it.` }),
    r => ({ user: `How do I turn off the marketing emails? I get ${2 + Math.floor(r() * 5)} a week.`, reply: `Use the Unsubscribe link at the bottom of any marketing email, or go to Account, then Notifications and switch off Promotions. Order and shipping emails will still arrive.` }),
    r => ({ user: `Can I merge two accounts? I ordered the ${pick(r, PRODUCT)} as a guest.`, reply: `Yes. Create or sign in to your account with the same email you used as a guest, and guest orders attach automatically within an hour. If you used a different email, send me both and I will link them.` }),
  ] },
  { id: 'returns', weight: 0.1, gens: [
    r => { const p = pick(r, PRODUCT); return { user: `I want to return the ${p}. ${pick(r, ['It is too small.', 'It arrived damaged.', 'I changed my mind.'])}`, reply: `You can return the ${p} within 60 days. Start the return from Orders, choose the item and print the prepaid label. Refunds go back to the original payment method within five business days of the item reaching us.` } },
    r => ({ user: `Is return shipping free?`, reply: `Returns are free in the US with the prepaid label. For international orders the label costs a flat $9.95, which is deducted from the refund.` }),
  ] },
  { id: 'technical', weight: 0.05, gens: [
    r => ({ user: `The pole sleeve on my ${pick(r, ['Ridgeline 2 tent', 'Ridgeline 3 tent'])} tore on the first night. Is that covered?`, reply: `Yes, seams and sleeves are covered by the lifetime workmanship warranty. Send a photo of the tear and your order number, and we will either repair it free or replace the tent.` }),
    r => ({ user: `How do I clean the Glacier water filter? Flow is really slow now.`, reply: `Backflush it: fill the syringe with clean water, attach it to the outlet and push water back through the cartridge two or three times. If flow stays slow after that, the cartridge has reached the end of its life.` }),
  ] },
]

const FOREIGN = [
  { user: 'Hola, ¿dónde está mi pedido? Lo compré hace una semana y todavía no llega.', reply: 'Hola. Tu pedido fue enviado y está en camino; la entrega estimada es en tres días hábiles. Puedes seguirlo con el enlace de seguimiento de tu correo de envío.' },
  { user: 'Bonjour, je voudrais retourner ma veste, elle est trop grande. Comment faire ?', reply: 'Bonjour. Vous pouvez retourner la veste sous 60 jours depuis la page Commandes en imprimant l\'étiquette prépayée. Le remboursement est effectué sous cinq jours ouvrables.' },
  { user: 'Hallo, ich wurde für meine Bestellung zweimal belastet. Können Sie das prüfen?', reply: 'Hallo. Eine der beiden Buchungen ist eine vorläufige Reservierung, die innerhalb weniger Tage automatisch verschwindet. Nur ein Betrag wird tatsächlich abgebucht.' },
  { user: 'Olá, como faço para mudar o endereço de entrega do meu pedido? Escrevi o número errado.', reply: 'Olá. Se o pedido ainda não foi embalado, posso atualizar o endereço agora. Responda com o endereço correto e eu faço a alteração antes do envio.' },
]
const PII = [
  (r: () => number) => `You can reach me at ${pick(r, FIRST).toLowerCase()}.${pick(r, ['lee', 'okafor', 'nguyen', 'berg'])}@example.com if that's easier.`,
  () => 'My phone is (415) 555-0137, call me after 5pm.',
  () => 'The card I used was 4111 1111 1111 1111, can you check if it went through?',
  () => 'I tried the API integration with key sk-live-9fQ2mZxR7tWp4LkN8vB3cD6hJ1sA5eYu but orders are not syncing.',
  () => 'Call me on +44 20 7946 0958 please.',
  () => 'My SSN is 219-09-9999 if you need it for verification.',
]
const REFUSALS = ['I\'m sorry, but I can\'t help with that request.', 'As an AI language model, I cannot access your order details.', 'I cannot assist with refunds. Please contact a human agent.', 'I\'m not able to help with account questions.']

function conversation(r: () => number, intent: (typeof INTENTS)[number], callN: { n: number }) {
  const g = pick(r, intent.gens)(r)
  const name = pick(r, FIRST)
  const user = [pick(r, HELLO), g.user, pick(r, DETAIL), r() < 0.4 ? pick(r, DETAIL) : '', r() < 0.3 ? `I'm ${name}.` : '', pick(r, THANKS)].filter(Boolean).join(' ')
  const reply = [pick(r, OPEN), g.reply, pick(r, EXTRA), r() < 0.5 ? pick(r, EXTRA) : '', pick(r, CLOSE)].filter(Boolean).join(' ')
  const messages: Record<string, unknown>[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
  if (g.tool && r() < 0.6) {
    const id = `call_${(callN.n++).toString(36).padStart(5, '0')}`
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: g.tool.name, arguments: JSON.stringify(g.tool.args) } }] })
    messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(g.tool.result) })
  }
  messages.push({ role: 'assistant', content: reply })
  if (r() < 0.18) {
    const g2 = pick(r, pick(r, INTENTS).gens)(r)
    messages.push({ role: 'user', content: `Also, ${g2.user.charAt(0).toLowerCase()}${g2.user.slice(1)}` }, { role: 'assistant', content: g2.reply })
  }
  return { messages, intent: intent.id }
}

function pickIntent(r: () => number) {
  let x = r()
  for (const i of INTENTS) { if ((x -= i.weight) < 0) return i }
  return INTENTS[0]
}

/** Long order-history pastes push a row past a 4k context. */
function longLog(r: () => number) {
  const lines: string[] = []
  for (let i = 0; i < 260; i++) lines.push(`2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')} ${order(r)} ${pick(r, PRODUCT)} qty ${1 + (i % 3)} ${money(r)} ${pick(r, ['shipped', 'delivered', 'returned', 'refunded'])}`)
  return lines.join('\n')
}

export function supportSft(seed = 7): SampleFile[] {
  const r = rng(seed), callN = { n: 1 }
  const base: { messages: Record<string, unknown>[]; intent: string }[] = []
  for (let i = 0; i < 1052; i++) base.push(conversation(r, pickIntent(r), callN))
  const lines: string[] = base.map(x => JSON.stringify(x))
  const insert = (s: string) => lines.splice(1 + Math.floor(r() * (lines.length - 1)), 0, s)
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
  const userOf = (x: { messages: Record<string, unknown>[] }) => x.messages.find(m => m.role === 'user')!

  for (let i = 0; i < 32; i++) insert(JSON.stringify(base[Math.floor(r() * base.length)]))
  for (let i = 0; i < 28; i++) {
    const x = clone(base[Math.floor(r() * base.length)])
    const u = userOf(x)
    u.content = String(u.content).replace(/\bI\b/, 'I just').replace(/\?/, ' please?') + pick(r, [' Thanks again.', ' Cheers.', ' Much appreciated.'])
    insert(JSON.stringify(x))
  }
  for (let i = 0; i < 30; i++) {
    const x = conversation(r, pickIntent(r), callN)
    const u = userOf(x)
    u.content = `${u.content} ${pick(r, PII)(r)}`
    insert(JSON.stringify(x))
  }
  for (let i = 0; i < 18; i++) { const x = conversation(r, pickIntent(r), callN); (x.messages.at(-1)!).content = pick(r, REFUSALS); insert(JSON.stringify(x)) }
  for (let i = 0; i < 8; i++) { const f = FOREIGN[i % FOREIGN.length]; insert(JSON.stringify({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: i < 4 ? f.user : `${f.user} ${order(r)}` }, { role: 'assistant', content: f.reply }], intent: ['shipping', 'returns', 'billing', 'shipping'][i % 4] })) }
  for (let i = 0; i < 8; i++) { const x = conversation(r, INTENTS[0], callN); const u = userOf(x); u.content = `Here is my full order history, can you find the duplicate charge?\n\n${longLog(r)}`; insert(JSON.stringify(x)) }
  // Broken rows: the kind of thing a scraping or export script produces.
  for (let i = 0; i < 6; i++) { const s = JSON.stringify(conversation(r, pickIntent(r), callN)); insert(s.slice(0, Math.floor(s.length * (0.4 + r() * 0.4)))) }
  for (let i = 0; i < 4; i++) { const x = conversation(r, pickIntent(r), callN); x.messages[1].role = 'Human'; x.messages.at(-1)!.role = 'bot'; insert(JSON.stringify(x)) }
  for (let i = 0; i < 4; i++) { const x = conversation(r, pickIntent(r), callN); x.messages.at(-1)!.content = '  '; insert(JSON.stringify(x)) }
  for (let i = 0; i < 4; i++) { const x = conversation(r, pickIntent(r), callN); x.messages.pop(); insert(JSON.stringify(x)) }
  for (let i = 0; i < 3; i++) { const x = conversation(r, pickIntent(r), callN); const sys = x.messages.shift()!; x.messages.splice(1, 0, sys); insert(JSON.stringify(x)) }
  for (let i = 0; i < 3; i++) {
    const o = order(r)
    insert(JSON.stringify({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Status of ${o}?` }, { role: 'assistant', content: null, tool_calls: [{ type: 'function', function: { name: 'lookup_order', arguments: { order_id: o } } }] }, { role: 'tool', tool_call_id: 'call_x', content: '{"status":"delivered"}' }, { role: 'assistant', content: `${o} was delivered yesterday.` }], intent: 'shipping' }))
  }
  // Pad to exactly 1,200 lines with fresh rows.
  while (lines.length < 1200) insert(JSON.stringify(conversation(r, pickIntent(r), callN)))

  const evalLines: string[] = []
  for (let i = 0; i < 108; i++) evalLines.push(JSON.stringify(conversation(r, pickIntent(r), callN)))
  for (let i = 0; i < 8; i++) evalLines.splice(Math.floor(r() * evalLines.length), 0, JSON.stringify(base[Math.floor(r() * base.length)]))
  for (let i = 0; i < 4; i++) { const x = clone(base[Math.floor(r() * base.length)]); x.messages.at(-1)!.content = 'Here is a different answer written later by another annotator for the same question.'; evalLines.splice(Math.floor(r() * evalLines.length), 0, JSON.stringify(x)) }
  return [
    { name: 'support-train.jsonl', text: lines.join('\n') + '\n', split: 'train' },
    { name: 'support-eval.jsonl', text: evalLines.join('\n') + '\n', split: 'eval' },
  ]
}

export function supportDpo(seed = 11): SampleFile[] {
  const r = rng(seed), out: string[] = []
  for (let i = 0; i < 160; i++) {
    const g = pick(r, pickIntent(r).gens)(r)
    const prompt = [{ role: 'system', content: SYSTEM }, { role: 'user', content: g.user }]
    const good = `${pick(r, OPEN.filter(Boolean))} ${g.reply} ${pick(r, CLOSE.filter(Boolean))}`
    const bad = r() < 0.88 ? pick(r, ['Please check our help centre.', 'I am not sure, try again later.', 'Contact support.', 'That is not something we handle.', 'Check your email.']) : `${g.reply} Also, all sales are final, so no refunds are possible on any order, and shipping times are not guaranteed for any destination.`
    if (i % 31 === 5) out.push(JSON.stringify({ prompt, chosen: [{ role: 'assistant', content: good }], rejected: [{ role: 'assistant', content: good }] }))
    else if (i === 77) out.push(JSON.stringify({ prompt, chosen: [{ role: 'assistant', content: good }] }))
    else out.push(JSON.stringify({ prompt, chosen: [{ role: 'assistant', content: good }], rejected: [{ role: 'assistant', content: bad }] }))
  }
  return [{ name: 'support-dpo.jsonl', text: out.join('\n') + '\n', split: 'train' }]
}

export const sampleFiles = (id: string): SampleFile[] => id === 'support-dpo' ? supportDpo() : supportSft()
