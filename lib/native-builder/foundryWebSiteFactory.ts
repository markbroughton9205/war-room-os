/**
 * Application Builder website factory for a real Commander transportation project.
 * Research informs structure and topics. Copy is original. Company facts are never invented.
 */
import type { FoundryAssetRequest, FoundryProductRequirements, FoundryUnknownBusinessFact } from './foundryApplicationBuilderTypes'

export const WORKING_BRAND = 'Lane & Box Transport'
const TAGLINE = 'Box truck capacity for shippers and brokers'
const DESCRIPTION = 'Request box truck and dedicated freight capacity. Legal name, authority, and terminals are published when the operator provides them.'

function nav(active: string, includeFaq: boolean): string {
  const items: Array<[string, string]> = [
    ['index.html', 'Home'],
    ['services.html', 'Services'],
    ['about.html', 'About'],
    ['contact.html', 'Get a quote'],
  ]
  if (includeFaq) items.splice(3, 0, ['faq.html', 'FAQ'])
  return items.map(([href, label]) => `<a href="${href}" class="${active === href ? 'is-active' : ''}"${href === 'contact.html' ? ' data-cta="nav"' : ''}>${esc(label)}</a>`).join('')
}

function chrome(input: { title: string; active: string; main: string; includeFaq: boolean; extraHead?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(input.title)} · ${esc(WORKING_BRAND)}</title>
  <meta name="description" content="${esc(DESCRIPTION)}">
  <meta name="robots" content="noindex,nofollow">
  <link rel="stylesheet" href="styles.css">
  ${input.extraHead ?? ''}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <a class="brand" href="index.html">
      <img src="logo.svg" width="40" height="40" alt="">
      <span>
        <strong>${esc(WORKING_BRAND)}</strong>
        <small>${esc(TAGLINE)}</small>
      </span>
    </a>
    <button class="menu" type="button" aria-expanded="false" aria-controls="site-nav" data-testid="nav-toggle">Menu</button>
    <nav id="site-nav" data-testid="site-nav">${nav(input.active, input.includeFaq)}</nav>
  </header>
  <main id="main">${input.main}</main>
  <footer>
    <div>
      <strong>${esc(WORKING_BRAND)}</strong>
      <p>Working title pending legal business name. Quote requests stay on this computer until dispatch email is authorized.</p>
    </div>
    <p class="fine">No live rates, no invented authority numbers, and no customer testimonials on this site.</p>
  </footer>
  <script src="app.js" defer></script>
</body>
</html>
`
}

function profile(facts: FoundryUnknownBusinessFact[]): string {
  return `<section class="profile" data-testid="company-profile" aria-labelledby="profile-heading">
    <h2 id="profile-heading">Company profile</h2>
    <p>These operating facts are published only when the operator supplies them.</p>
    <dl>${facts.map(fact => `<div><dt>${esc(labelFact(fact.field))}</dt><dd>To be published</dd></div>`).join('')}</dl>
  </section>`
}

function labelFact(field: string): string {
  const labels: Record<string, string> = {
    legal_business_name: 'Legal business name',
    years_in_business: 'Years in operation',
    locations: 'Terminals and lanes',
    licenses: 'MC / DOT / insurance',
    testimonials: 'Customer references',
    partners: 'Named partners',
    phone_email: 'Phone and email',
    fleet_size: 'Fleet size',
    rates: 'Published rates',
  }
  return labels[field] ?? field.replace(/_/g, ' ')
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch))
}

export function buildWebsiteFiles(input: {
  requirements: FoundryProductRequirements
  previewOrigin: string
  includeFaq?: boolean
}): { files: Record<string, string>; assetRequests: FoundryAssetRequest[] } {
  const facts = input.requirements.unknownBusinessFacts
  const includeFaq = input.includeFaq === true
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: WORKING_BRAND,
    description: DESCRIPTION,
    url: input.previewOrigin,
  })}</script>`

  const home = chrome({
    title: 'Home',
    active: 'index.html',
    includeFaq,
    extraHead: jsonLd,
    main: `
      <section class="hero" data-testid="home-hero">
        <div>
          <p class="eyebrow">Box truck &amp; dedicated freight</p>
          <h1>Tell us the lane. We will ask for a real quote — not a fake guarantee.</h1>
          <p class="lead">Shippers and brokers typically need equipment type, origin, destination, and timing in one visit. This site is built for that workflow. Operating authority and terminals appear when the operator provides them.</p>
          <div class="actions">
            <a class="cta" href="contact.html" data-testid="hero-quote">Request a quote</a>
            <a class="ghost" href="services.html">See typical services</a>
          </div>
        </div>
        <figure class="hero-art" aria-hidden="true">
          <img src="logo.svg" width="220" height="220" alt="">
        </figure>
      </section>
      <section class="strip" aria-label="How a quote works">
        <article><span>01</span><h2>Describe the move</h2><p>Origin, destination, freight, and when it needs to roll.</p></article>
        <article><span>02</span><h2>Stay local for now</h2><p>The form stores the request on this computer. It does not email a dispatcher yet.</p></article>
        <article><span>03</span><h2>Publish facts later</h2><p>Legal name, MC/DOT, insurance, and terminals wait for operator input.</p></article>
      </section>
      <section class="grid3">
        <article><h2>For shippers</h2><p>A clear front door: what we haul, how to ask for capacity, and no invented “always available” claims.</p></article>
        <article><h2>For brokers</h2><p>Equipment and timing fields that match how loads are actually tendered — without scraping someone else’s rate table.</p></article>
        <article><h2>For operations</h2><p>A professional public site that can grow once authority numbers and photos are supplied.</p></article>
      </section>
      ${profile(facts)}
    `,
  })

  const services = chrome({
    title: 'Services',
    active: 'services.html',
    includeFaq,
    main: `
      <header class="pagehead">
        <p class="eyebrow">Services</p>
        <h1>Capacity descriptions, not a fleet inventory</h1>
        <p class="lead">These offerings use ordinary industry language. They are not a claim that a specific truck is sitting at a yard tonight.</p>
      </header>
      <div class="cards" data-testid="services-list">
        <article><h2>Box truck / straight truck</h2><p>Local and regional moves when a 26-foot or similar box is the right tool. Confirm liftgate, pallet count, and dock vs. residential on the quote form.</p></article>
        <article><h2>Full truckload</h2><p>Point-to-point dry van or similar when the shipment needs the whole trailer. Appointment windows belong in the notes field.</p></article>
        <article><h2>Dedicated lanes</h2><p>Repeating origins and destinations with agreed equipment. Volume commitments wait for a real contract — they are not advertised as facts here.</p></article>
        <article><h2>Expedited windows</h2><p>When a receiver’s dock time is the product. Ask for the required delivery timestamp rather than promising “24/7 anywhere.”</p></article>
      </div>
    `,
  })

  const about = chrome({
    title: 'About',
    active: 'about.html',
    includeFaq,
    main: `
      <header class="pagehead">
        <p class="eyebrow">About</p>
        <h1>A working public identity until the legal name is supplied</h1>
      </header>
      <p class="lead">${esc(WORKING_BRAND)} is a design working title for this website. It is not a substitute for the operator’s registered name, and it does not imply a founding year, headcount, or safety score.</p>
      <blockquote data-testid="about-purpose">We built this presence so customers can understand the work and request a quote without being sold a biography that nobody verified.</blockquote>
      ${profile(facts)}
    `,
  })

  const contact = chrome({
    title: 'Get a quote',
    active: 'contact.html',
    includeFaq,
    main: `
      <header class="pagehead">
        <p class="eyebrow">Quote</p>
        <h1>Request capacity</h1>
        <p class="lead">Required fields match what brokers and shippers usually need to start a conversation. Nothing is sent off this computer.</p>
      </header>
      <form class="quote" data-testid="quote-form" novalidate>
        <div class="pair">
          <label for="origin">Origin city or ZIP <input id="origin" name="origin" required autocomplete="address-level2"></label>
          <label for="destination">Destination city or ZIP <input id="destination" name="destination" required></label>
        </div>
        <div class="pair">
          <label for="freight">Equipment / freight
            <select id="freight" name="freight" required>
              <option value="">Select</option>
              <option>Box truck / straight truck</option>
              <option>Dry van</option>
              <option>Reefer</option>
              <option>Flatbed</option>
              <option>Other / not sure</option>
            </select>
          </label>
          <label for="needed">Needed by <input id="needed" name="needed" type="date" required></label>
        </div>
        <div class="pair">
          <label for="weight">Approximate weight <input id="weight" name="weight" inputmode="numeric" placeholder="Optional"></label>
          <label for="pieces">Pallets or pieces <input id="pieces" name="pieces" placeholder="Optional"></label>
        </div>
        <div class="pair">
          <label for="name">Your name <input id="name" name="name" required autocomplete="name"></label>
          <label for="email">Email <input id="email" name="email" type="email" required autocomplete="email"></label>
        </div>
        <label for="role">I am
          <select id="role" name="role">
            <option value="shipper">A shipper</option>
            <option value="broker">A broker</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label for="notes">Notes <textarea id="notes" name="notes" rows="4" placeholder="Dock hours, liftgate, appointment numbers — skip anything you do not know yet."></textarea></label>
        <button type="submit" data-testid="quote-submit">Save quote locally</button>
        <p class="form-status" data-testid="quote-status" role="status"></p>
      </form>
      <p class="note" data-testid="quote-empty">No quotes stored yet until you submit this form. Production email, CRM sync, and paid dispatch tools are not enabled.</p>
    `,
  })

  const faq = chrome({
    title: 'FAQ',
    active: 'faq.html',
    includeFaq,
    main: `
      <header class="pagehead">
        <p class="eyebrow">FAQ</p>
        <h1>Questions customers usually ask before a quote</h1>
        <p class="lead">Answers stay general. They do not invent coverage maps, insurance limits, or on-time percentages.</p>
      </header>
      <div class="faq" data-testid="faq-list">
        <article><h2>What information do you need for a quote?</h2><p>Origin, destination, equipment type, and the date the freight needs to move. Weight and pallet count help when you have them.</p></article>
        <article><h2>Do you publish live rates?</h2><p>No. Rates depend on lane, timing, and equipment. This site collects the request locally until outbound email is authorized.</p></article>
        <article><h2>Where do you operate?</h2><p>Service area is not listed until the operator provides terminals and lanes. Do not assume nationwide coverage from this page.</p></article>
        <article><h2>Can I see MC, DOT, or insurance certificates?</h2><p>Those documents will be linked here when supplied. Placeholder numbers are not used.</p></article>
        <article><h2>Do you run 24/7?</h2><p>Hours are unpublished until the operator sets them. Use the needed-by date on the quote form instead.</p></article>
      </div>
    `,
  })

  const css = `:root{--navy:#0b1520;--ink:#14202c;--paper:#f4f1ea;--card:#fff;--line:#d9d0c4;--muted:#5b6670;--accent:#c45c26;--focus:#1c6b9a}
*{box-sizing:border-box}html,body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif}
.skip{position:absolute;left:-999px}.skip:focus{left:1rem;top:1rem;background:#fff;padding:.5rem;z-index:2}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:1rem 7vw;background:var(--navy);color:#f4f1ea}
.brand{display:flex;gap:.75rem;align-items:center;color:inherit;text-decoration:none}
.brand small{display:block;color:#c9d0d6;font-size:.75rem}
nav{display:flex;gap:1.1rem;margin-left:auto;font-size:.82rem;letter-spacing:.04em}
nav a{color:#f4f1ea;text-decoration:none;padding:.35rem 0;border-bottom:2px solid transparent}
nav a.is-active,nav a:hover,nav a:focus{border-color:var(--accent)}
nav a[data-cta="nav"]{border:1px solid var(--accent);padding:.35rem .7rem;border-bottom-width:1px}
.menu{display:none;background:transparent;color:#f4f1ea;border:1px solid #c9d0d6;padding:.4rem .7rem}
main{padding:2.75rem 7vw 4rem;max-width:1120px}
.hero{display:grid;gap:2rem;align-items:center}
.hero h1,.pagehead h1{font-size:clamp(2rem,4.6vw,3.35rem);line-height:1.12;letter-spacing:-.02em;max-width:16ch}
.lead{font-size:1.05rem;color:var(--muted);max-width:46rem}
.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:.72rem;color:var(--accent);font-weight:700}
.actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.4rem}
.cta,.quote button{display:inline-block;background:var(--accent);color:#fff;padding:.85rem 1.15rem;text-decoration:none;border:0;font:650 14px/1 "Segoe UI",system-ui,sans-serif}
.ghost{display:inline-block;padding:.85rem 1.15rem;color:var(--navy);text-decoration:none;border:1px solid var(--line)}
.hero-art{margin:0;justify-self:center;opacity:.95}
.strip,.grid3,.cards{display:grid;gap:1rem;margin:2.4rem 0}
.strip article,.grid3 article,.cards article,.profile,blockquote,.faq article{background:var(--card);border:1px solid var(--line);padding:1.25rem 1.3rem}
.strip span{display:block;color:var(--accent);font-weight:700;margin-bottom:.35rem}
blockquote{font-size:1.2rem;border-left:4px solid var(--accent)}
.profile dl{display:grid;gap:.6rem}
.profile div{display:grid;grid-template-columns:minmax(8rem,14rem) 1fr;gap:1rem;border-top:1px solid var(--line);padding-top:.6rem}
.profile dt{font-weight:650}
.profile dd{margin:0;color:var(--muted)}
.note,.fine{color:var(--muted);font-size:.92rem}
.quote{display:grid;gap:.9rem;max-width:42rem}
.quote .pair{display:grid;gap:.9rem}
.quote label{display:grid;gap:.3rem;font:650 14px/1.3 "Segoe UI",system-ui,sans-serif}
.quote input,.quote select,.quote textarea{font:16px/1.4 "Segoe UI",system-ui,sans-serif;padding:.65rem .7rem;border:1px solid var(--line);width:100%;background:#fff}
.quote input:focus,.quote select:focus,.quote textarea:focus,a:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.form-status{min-height:1.4em}
.form-status.is-error{color:#8a1f12}
.form-status.is-ok{color:#215c38}
footer{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;padding:1.6rem 7vw;background:var(--navy);color:#d7dde2}
@media (max-width:760px){
  nav{display:none;width:100%;flex-direction:column;margin:0}
  nav.is-open{display:flex}
  .menu{display:inline-flex;margin-left:auto}
  .hero,.strip,.grid3,.cards,.quote .pair,.profile div{grid-template-columns:1fr}
  main{padding:1.6rem 6vw 3rem}
}
@media (min-width:761px){
  .hero{grid-template-columns:1.3fr .7fr}
  .strip,.grid3{grid-template-columns:repeat(3,1fr)}
  .cards,.faq{grid-template-columns:repeat(2,1fr);display:grid;gap:1rem}
  .quote .pair{grid-template-columns:1fr 1fr}
}
`
  const js = `const nav = document.getElementById('site-nav')
const toggle = document.querySelector('[data-testid="nav-toggle"]')
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open')
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  })
}
const STORAGE_KEY = 'lane-box-quotes'
const form = document.querySelector('[data-testid="quote-form"]')
const status = document.querySelector('[data-testid="quote-status"]')
const empty = document.querySelector('[data-testid="quote-empty"]')
function loadQuotes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
if (empty) {
  const n = loadQuotes().length
  empty.textContent = n ? n + ' quote request(s) stored locally on this computer.' : empty.textContent
}
if (form && status) {
  form.addEventListener('submit', event => {
    event.preventDefault()
    const data = new FormData(form)
    const required = ['origin', 'destination', 'freight', 'needed', 'name', 'email']
    const missing = required.filter(name => !String(data.get(name) || '').trim())
    status.className = 'form-status'
    if (missing.length) {
      status.classList.add('is-error')
      status.textContent = 'Please complete: ' + missing.join(', ')
      return
    }
    const payload = Object.fromEntries(data.entries())
    payload.savedAt = new Date().toISOString()
    const all = loadQuotes()
    all.push(payload)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    status.classList.add('is-ok')
    status.textContent = 'Quote saved on this computer. Nothing was emailed or sent to a CRM.'
    form.reset()
    if (empty) empty.textContent = all.length + ' quote request(s) stored locally on this computer.'
  })
}
`

  const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${WORKING_BRAND} mark">
  <rect width="64" height="64" rx="10" fill="#0b1520"/>
  <path d="M8 38h28l12-14H32l-8 14" fill="none" stroke="#f4f1ea" stroke-width="2.6" stroke-linejoin="round"/>
  <rect x="10" y="24" width="14" height="10" rx="1" fill="#c45c26"/>
  <circle cx="18" cy="46" r="3.4" fill="#c45c26"/>
  <circle cx="40" cy="46" r="3.4" fill="#c45c26"/>
</svg>`

  const port = Number(new URL(input.previewOrigin).port) || 18780
  const server = `import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || ${JSON.stringify(port)})
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' }

export const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, project: ${JSON.stringify(WORKING_BRAND)} }))
    return
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname
  const abs = path.normalize(path.join(root, file))
  if (!abs.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  fs.readFile(abs, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream' })
    res.end(data)
  })
})

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log('lane-box-transport listening on ' + PORT))
}
`

  const tests = `import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const names = ['index.html', 'services.html', 'about.html', 'contact.html'${includeFaq ? ", 'faq.html'" : ''}]
const pages = names.map(name => ({
  name,
  html: readFileSync(path.join(root, name), 'utf8'),
}))
const blob = pages.map(page => page.html).join('\\n')

test('required routes exist with original navigation', () => {
  for (const page of pages) {
    assert.match(page.html, /data-testid="site-nav"/)
    assert.match(page.html, />Home</)
    assert.match(page.html, />Services</)
    assert.match(page.html, />About</)
    assert.match(page.html, /Get a quote/)
  }
})

test('does not invent company-specific facts', () => {
  assert.doesNotMatch(blob, /since 19\\d\\d|since 20\\d\\d|\\b\\d{2,}\\s+years in business/i)
  assert.doesNotMatch(blob, /\\b\\d{3,}\\s+customers\\b/i)
  assert.doesNotMatch(blob, /MC-\\d{4,}|DOT-\\d{4,}|MC\\s*#\\s*\\d+/i)
  assert.doesNotMatch(blob, /24\\/7 availability|always available nationwide/i)
  assert.doesNotMatch(blob, /\"I shipped with them/)
  assert.match(blob, /To be published/)
  assert.match(blob, /data-testid="company-profile"/)
})

test('quote form is present and local-only', () => {
  const contact = pages.find(page => page.name === 'contact.html').html
  assert.match(contact, /data-testid="quote-form"/)
  assert.match(contact, /name="origin"/)
  assert.match(contact, /Nothing is sent off this computer|localStorage|Save quote locally/)
})

test('no engineering fixture chrome in the public UI', () => {
  assert.doesNotMatch(blob, /\\bPASS\\b|Foundry Demo Transport|debug-ui|fixture website/i)
})

test('responsive rules exist for mobile', () => {
  const css = readFileSync(path.join(root, 'styles.css'), 'utf8')
  assert.match(css, /@media \\(max-width:760px\\)/)
})
${includeFaq ? `
test('faq section exists after continuation', () => {
  assert.equal(existsSync(path.join(root, 'faq.html')), true)
  const faq = pages.find(page => page.name === 'faq.html').html
  assert.match(faq, /data-testid="faq-list"/)
  assert.match(faq, /What information do you need for a quote/)
})
` : ''}
`

  const pkg = `{
  "name": "box-truck-transport",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test.mjs",
    "build": "node --check server.mjs && node --check app.js",
    "start": "node server.mjs"
  }
}
`

  const envExample = `# Local-only placeholders. Never put real secrets in this file or in source.
PORT=${port}
# CONTACT_NOTIFY_EMAIL=
# SMTP_URL=
`

  const readme = `# ${WORKING_BRAND}

Persistent Foundry Application Builder project.

- Local server: ${input.previewOrigin}
- Start: \`node server.mjs\`
- Tests: \`node --test test.mjs\`
- Deploy is NOT automatic.
- Legal name, MC/DOT, insurance, terminals, and photos await operator input.
`

  const commanderFacts = JSON.stringify({
    workingBrand: WORKING_BRAND,
    workingBrandKind: 'FOUNDRY_DESIGN_DECISION',
    unknown: facts,
    inventedFactsForbidden: [
      'years_in_business', 'customer_counts', 'locations', 'licenses', 'DOT', 'MC',
      'revenue', 'certifications', 'testimonials', 'partners', 'fleet_size', '24_7', 'rates',
    ],
  }, null, 2)

  const files: Record<string, string> = {
    'index.html': home,
    'services.html': services,
    'about.html': about,
    'contact.html': contact,
    'styles.css': css,
    'app.js': js,
    'logo.svg': logo,
    'server.mjs': server,
    'test.mjs': tests,
    'package.json': pkg,
    '.env.example': envExample,
    'README.md': readme,
    'commander-facts.json': commanderFacts,
  }
  if (includeFaq) files['faq.html'] = faq

  return {
    files,
    assetRequests: [
      {
        id: 'photo-fleet',
        kind: 'photo',
        purpose: 'Photographs of the operator’s actual box trucks or terminals',
        whyUnavailable: 'No governed image generator and no operator photos supplied. Original SVG mark is used; stock competitor photography is not scraped.',
      },
    ],
  }
}
