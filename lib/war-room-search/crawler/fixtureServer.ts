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

function robotsTxt(): string {
  return [
    'User-agent: WarRoomBot',
    'Disallow: /blocked',
    'Allow: /',
    '',
    'User-agent: *',
    'Disallow:',
  ].join('\n')
}

export type CrawlFixture = {
  baseUrl: string
  port: number
  close: () => Promise<void>
}

export async function startCrawlFixture(): Promise<CrawlFixture> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1`)
    const pathName = url.pathname
    if (pathName === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(robotsTxt())
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
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  }
}
