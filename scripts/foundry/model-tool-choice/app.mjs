import { createServer } from 'node:http'

export const STATUS = 'OMEGA'
export const PORT = 18777

export function html() {
  return `<!doctype html><html><body><main><h1>Model Tool Choice Fixture</h1><p id="status">${STATUS}</p></main></body></html>`
}

export function createApp() {
  return createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html())
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(PORT, '127.0.0.1', () => console.log(`MODEL_TOOL_CHOICE_ORIGIN=http://127.0.0.1:${PORT}`))
}
