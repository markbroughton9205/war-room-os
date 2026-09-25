/**
 * Harmless Foundry Mission Controller fixture. The status label starts as FOUNDRY READY
 * until an autonomous mission changes it.
 */
import { createServer } from 'node:http'

export const LABEL = 'FOUNDRY READY'
export const FIXTURE_PORT = 18776

const html = `<!doctype html>
<html>
  <head><title>Foundry Mission Fixture</title></head>
  <body>
    <h1>Foundry Mission Fixture</h1>
    <p>Status:</p>
    <p id="status">${LABEL}</p>
  </body>
</html>`

export function createFixtureServer() {
  return createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, label: LABEL }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mission-fixture/server.mjs')) {
  const server = createFixtureServer()
  server.listen(FIXTURE_PORT, '127.0.0.1', () => {
    console.log(`FOUNDRY_FIXTURE_ORIGIN=http://127.0.0.1:${FIXTURE_PORT}`)
  })
}
