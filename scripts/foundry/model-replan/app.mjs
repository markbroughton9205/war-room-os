import { createServer } from 'node:http'
import { ACTUAL_STATUS } from './status-source.mjs'

export const PORT = 18778
export const html = () => `<!doctype html><html><body><h1>Hypothesis Fixture</h1><p id="status">${ACTUAL_STATUS}</p></body></html>`

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html())
  }).listen(PORT, '127.0.0.1', () => console.log(`MODEL_REPLAN_ORIGIN=http://127.0.0.1:${PORT}`))
}
