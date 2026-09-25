import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const STATUS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'label.txt'), 'utf8').trim()
export const PORT = 18779

export function html() {
  return `<!doctype html><html><body><main><h1>Local Coder Fixture</h1><p id="status">${STATUS}</p></main></body></html>`
}

export function createApp() {
  return createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html())
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(PORT, '127.0.0.1', () => console.log(`LOCAL_CODER_ORIGIN=http://127.0.0.1:${PORT}`))
}
