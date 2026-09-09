import http from 'node:http'
import type { AddressInfo } from 'node:net'

const ALLOWED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reuters — Chip export controls widen</title>
  <link rel="canonical" href="ALLOWED_CANONICAL">
  <meta name="description" content="Governments expand semiconductor export rules in East Asia.">
  <meta property="article:published_time" content="2026-09-01T00:00:00.000Z">
  <meta name="author" content="Reuters Staff">
</head>
<body>
  <article>
    <h1>Chip export controls widen</h1>
    <p>Reuters reports that governments expand semiconductor export rules in East Asia for advanced lithography tools.</p>
    <p>The policy covers foundries, packaging, and freight brokerage compliance for dual-use equipment.</p>
  </article>
</body>
</html>`

const DUPLICATE_HTML = `<!doctype html>
<html lang="en">
<head><title>Duplicate body</title></head>
<body><article><p>Identical sovereign crawler duplicate content about lithium batteries and freight lanes.</p></article></body>
</html>`

const BLOCKED_HTML = `<!doctype html><html><head><title>Blocked</title></head><body><p>Should not be crawled.</p></body></html>`
const MALFORMED = `<html><title>Broken page<body><p>Still extractable semiconductor text without a closing title`

function lifecycleHtml(title: string, canonical: string, body: string, extra = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <link rel="canonical" href="${canonical}">
</head>
<body>
  <article>
    <h1>${title}</h1>
    <p>${body}</p>
    ${extra}
  </article>
</body>
</html>`
}

export type LifecycleFixtureState = {
  changesVersion: 1 | 2
  nowBlocked: boolean
  transientError: boolean
  notFound: boolean
  gone: boolean
  identityRedirectsTo: string | null
  redirectChangeTarget: '/stable' | '/changes'
}

function defaultLifecycleState(): LifecycleFixtureState {
  return {
    changesVersion: 1,
    nowBlocked: false,
    transientError: false,
    notFound: false,
    gone: false,
    identityRedirectsTo: null,
    redirectChangeTarget: '/stable',
  }
}

export type CrawlFixture = {
  baseUrl: string
  port: number
  close: () => Promise<void>
  state: LifecycleFixtureState
  setLifecycle: (patch: Partial<LifecycleFixtureState>) => LifecycleFixtureState
  hits: Record<string, number>
}

export async function startCrawlFixture(): Promise<CrawlFixture> {
  const state = defaultLifecycleState()
  const hits: Record<string, number> = {}
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1`)
    const pathName = url.pathname
    hits[pathName] = (hits[pathName] ?? 0) + 1
    if (pathName === '/robots.txt') {
      const lines = [
        'User-agent: WarRoomBot',
        'Disallow: /blocked',
        ...(state.nowBlocked ? ['Disallow: /now-blocked'] : []),
        'Allow: /',
        '',
        'User-agent: *',
        'Disallow:',
      ]
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(lines.join('\n'))
      return
    }
    if (pathName === '/allowed') {
      const html = ALLOWED_HTML.replace('ALLOWED_CANONICAL', `http://127.0.0.1:${(server.address() as AddressInfo).port}/allowed`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (pathName === '/blocked') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(BLOCKED_HTML)
      return
    }
    if (pathName === '/redirect') {
      res.writeHead(302, { location: '/allowed' })
      res.end()
      return
    }
    if (pathName === '/duplicate-a' || pathName === '/duplicate-b') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(DUPLICATE_HTML)
      return
    }
    if (pathName === '/large') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(2_000_000) })
      res.end(`<html><body>${'x'.repeat(1_200_000)}</body></html>`)
      return
    }
    if (pathName === '/plain') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Plaintext sovereign crawler note about freight brokerage regulation.')
      return
    }
    if (pathName === '/unsupported') {
      res.writeHead(200, { 'content-type': 'application/pdf' })
      res.end('%PDF-fake')
      return
    }
    if (pathName === '/malformed') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(MALFORMED)
      return
    }
    if (pathName === '/empty') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><head><title></title></head><body></body></html>')
      return
    }
    if (pathName === '/server-error') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('upstream failed')
      return
    }
    if (pathName === '/with-links') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><html><head><title>WRBATCHLINKHUB</title></head><body>
        <p>Link hub page about hydrazine-free crawler batch isolation unique token WRBATCHLINKHUB.</p>
        <a href="/allowed">allowed</a>
        <a href="/blocked">blocked</a>
        <a href="/never-auto-added">secret</a>
        <a href="https://example.com">example</a>
      </body></html>`)
      return
    }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (pathName === '/stable') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle stable',
        `${origin}/stable`,
        'Lifecycle stable unique token WRSTABLEOMEGA remains the same on every crawl.',
      ))
      return
    }
    if (pathName === '/changes') {
      const version = state.changesVersion
      const token = version === 1 ? 'WRCHANGEALPHA' : 'WRCHANGEBRAVO'
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        `Lifecycle changes v${version}`,
        `${origin}/changes`,
        `Lifecycle version ${version} unique token ${token}.`,
        '<a href="/never-auto-added">do not follow</a>',
      ))
      return
    }
    if (pathName === '/now-blocked') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle now blocked',
        `${origin}/now-blocked`,
        'Lifecycle now-blocked unique token WRNOWBLOCKED was allowed then later robots-disallowed.',
      ))
      return
    }
    if (pathName === '/transient-error') {
      if (state.transientError) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('transient upstream failure')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle transient',
        `${origin}/transient-error`,
        'Lifecycle transient unique token WRTRANSIENTOK before the later 500.',
      ))
      return
    }
    if (pathName === '/not-found') {
      if (state.notFound) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle not found later',
        `${origin}/not-found`,
        'Lifecycle not-found unique token WRNOTFOUNDBEFORE later returns 404.',
      ))
      return
    }
    if (pathName === '/gone') {
      if (state.gone) {
        res.writeHead(410, { 'content-type': 'text/plain' })
        res.end('gone')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle gone later',
        `${origin}/gone`,
        'Lifecycle gone unique token WRGONEBEFORE later returns 410.',
      ))
      return
    }
    if (pathName === '/redirect-change') {
      res.writeHead(302, { location: state.redirectChangeTarget })
      res.end()
      return
    }
    if (pathName === '/redirect-ssrf') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
      res.end()
      return
    }
    if (pathName === '/identity') {
      if (state.identityRedirectsTo) {
        res.writeHead(302, { location: state.identityRedirectsTo })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Lifecycle identity',
        `${origin}/identity`,
        'Lifecycle identity unique token WRIDENTITYKEEP should keep canonical identity.',
      ))
      return
    }
    if (pathName === '/never-auto-added') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(lifecycleHtml(
        'Should not ingest',
        `${origin}/never-auto-added`,
        'This page must not be ingested merely because another document linked to it.',
      ))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    state,
    setLifecycle: (patch) => {
      Object.assign(state, patch)
      return state
    },
    hits,
  }
}
