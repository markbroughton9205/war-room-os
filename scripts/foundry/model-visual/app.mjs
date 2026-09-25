import { createServer } from 'node:http'

export const PORT = 18779
export const STATUS_STYLE = 'opacity:1'
export const html = () => `<!doctype html><html><body style="background:#020617;color:#e2e8f0"><h1>War Room Visual Acceptance Fixture</h1><p id="status" style="${STATUS_STYLE}">SYSTEM NOMINAL</p></body></html>`

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html())
  }).listen(PORT, '127.0.0.1', () => console.log(`MODEL_VISUAL_ORIGIN=http://127.0.0.1:${PORT}`))
}
