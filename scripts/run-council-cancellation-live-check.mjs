// Real route/executor/Ollama cancellation regression. No provider or response mocks.
// Run with the repository TS loader. --serve exposes a loopback-only browser harness.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'

// Keep this proof independent of production persistence and external providers.
process.env.SUPABASE_SERVICE_ROLE_KEY = ''
process.env.NEXT_PUBLIC_SUPABASE_URL = ''
process.env.COUNCIL_ROUTING_MODE = 'LOCAL_ONLY'
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const context = new AsyncLocalStorage()
const records = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Live proof forbids external network access')
  }
  const record = context.getStore()
  if (record && url.pathname === '/api/generate') {
    const body = JSON.parse(init.body)
    record.calls.push({ at: Date.now(), prompt: body.prompt, model: body.model })
  }
  return realFetch(input, init)
}
const { executeCouncilChatRequest } = await import('../app/api/chat/execute.ts')
const { createCouncilStreamPostHandler } = await import('../app/api/chat/stream/route.ts')
const handler = createCouncilStreamPostHandler(async (req, options) => {
  const body = await req.clone().json()
  const record = { id: body.councilLogicalRequestId, decree: body.message, calls: [], started: Date.now(), ended: null, aborted: null, outcome: null }
  records.push(record)
  const effectiveSignal = options.signal ?? req.signal
  effectiveSignal.addEventListener('abort', () => { record.aborted = Date.now() }, { once: true })
  return context.run(record, async () => {
    try {
      const response = await executeCouncilChatRequest(req, options)
      record.outcome = 'returned'
      return response
    } catch (error) {
      record.outcome = error.name
      throw error
    } finally { record.ended = Date.now() }
  })
})
function bodyFor(message, id, family = false) {
  return {
    message, raelDirectiveText: message, mode: 'continue', councilSingleFamily: 'claude',
    councilFlowMode: 'stable_group', councilLogicalRequestId: id,
    councilLogicalExpectedFamilies: ['claude', 'gemini', 'chatgpt'],
    councilLogicalTurnIndex: 0, councilLogicalTurnTotal: 3,
    councilCommand: { mode: 'normal', directInvocation: false, targetFamilies: [] },
    councilIntentKind: 'general', councilActiveScope: 'general', threadHistory: [],
    activeTopic: 'Name the capital of France.',
    ...(family ? { councilDeliberationMode: 'family_to_family_v1' } : {}),
  }
}
function request(body, signal) {
  return new Request('http://127.0.0.1/api/chat/stream', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  })
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, timeout = 90000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Live proof timed out')
    await delay(50)
  }
}
if (process.argv.includes('--serve')) {
  const html = `<!doctype html><meta charset="utf-8"><title>Council real Ollama cancellation proof</title>
  <h1>Council real Ollama cancellation proof</h1><p>Actual stream route and executor. Local Ollama. Persistence unavailable. This is a transport harness, not the War Room UI.</p>
  <label>Decree <input id="decree" value="Council, give me a short status summary of War Room."></label>
  <label><input id="family" type="checkbox" checked>Family to family</label>
  <button id="send">Send / supersede</button><button id="stop">Cancel</button><button id="refresh">Refresh evidence</button>
  <pre id="output"></pre><h2>Server evidence</h2><pre id="evidence"></pre>
  <script>
  let active; let generation = 0;
  document.querySelector('#stop').onclick = () => active?.abort();
  document.querySelector('#refresh').onclick = async () => { document.querySelector('#evidence').textContent = JSON.stringify((await (await fetch('/evidence')).json()).map(r=>({...r,calls:r.calls.map(c=>({at:c.at,model:c.model}))})), null, 2); };
  document.querySelector('#send').onclick = async () => {
    active?.abort(); active = new AbortController(); const mine = ++generation;
    const message = document.querySelector('#decree').value;
    const body = (${bodyFor.toString()})(message, crypto.randomUUID(), document.querySelector('#family').checked);
    const output = document.querySelector('#output'); output.textContent = 'Decree: ' + message + '\\n';
    try {
      const response = await fetch('/api/chat/stream', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:active.signal});
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '';
      while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value); let end;
        while ((end = buffer.indexOf('\\n\\n')) >= 0) { const frame = buffer.slice(0,end); buffer = buffer.slice(end+2); const line = frame.split('\\n').find(l=>l.startsWith('data: ')); if(!line) continue; const event = JSON.parse(line.slice(6));
          if(mine !== generation) continue;
          if(event.envelopeType === 'final') output.textContent += JSON.stringify({identity:event.finalResponse.councilProgress?.logicalRequestId,answer:event.finalResponse.councilSingleResponse,turns:event.finalResponse.familyDeliberation?.turns.map(t=>({family:t.provider_family,text:t.full_response}))},null,2);
          if(event.envelopeType === 'progress' && event.progressEvent?.payload?.diagnostic?.code === 'TEXT_DELTA') output.textContent += '.';
        }
      }
    } catch(error) { if(mine === generation) output.textContent += '\\n' + error.name; }
  };
  </script>`
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.url === '/evidence') {
      outgoing.setHeader('content-type', 'application/json')
      outgoing.end(JSON.stringify(records)); return
    }
    if (incoming.method !== 'POST' || incoming.url !== '/api/chat/stream') {
      outgoing.setHeader('content-type', 'text/html'); outgoing.end(html); return
    }
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    // Exercise response-body cancellation separately from incoming Request abort.
    const response = await handler(request(JSON.parse(Buffer.concat(chunks).toString())))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    const reader = response.body.getReader()
    outgoing.on('close', () => { void reader.cancel().catch(() => {}) })
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; outgoing.write(value) }
      outgoing.end()
    } catch { outgoing.end() }
  })
  server.listen(3013, '127.0.0.1', () => console.log('REAL OLLAMA HARNESS http://127.0.0.1:3013'))
} else {
  const preAborted = new AbortController(); preAborted.abort()
  const pre = await handler(request(bodyFor('Do not execute.', 'pre-aborted'), preAborted.signal))
  await pre.text()
  assert.equal(records.length, 0, 'Pre-aborted transport must never dispatch execution')
  for (const family of [false, true]) {
    const id = `cancel-${family ? 'family' : 'stable'}-${Date.now()}`
    const controller = new AbortController()
    const response = await handler(request(bodyFor('Council, give me a short status summary of War Room.', id, family), controller.signal))
    const reader = response.body.getReader()
    let text = ''
    const decoder = new TextDecoder()
    while (!text.includes('TEXT_DELTA')) {
      const chunk = await reader.read()
      assert.equal(chunk.done, false, 'Real Ollama must produce a token before cancellation')
      text += decoder.decode(chunk.value)
    }
    if (family) controller.abort()
    else await reader.cancel()
    const record = records.find(item => item.id === id)
    await waitFor(() => record.ended, 10000)
    assert.ok(record.calls.length > 0, 'Must reach real Ollama')
    assert.ok(record.aborted, 'Cancellation must reach executor')
    assert.equal(record.outcome, 'AbortError', 'Abandoned execution must not return a normal response')
    assert.ok(record.ended - record.aborted < 5000, 'Abandoned execution must unwind promptly')
    assert.equal(record.calls.filter(call => call.at > record.aborted).length, 0, 'No later seat, retry, or fallback after cancellation')
    console.log(`PASS ${id}: real tokens, cancellation propagated, no later dispatch (${record.ended - record.aborted}ms)`)
  }
  const fresh = await handler(request(bodyFor('What is 17 multiplied by 23? Reply with only the number.', 'fresh-after-cancel')))
  const freshText = await fresh.text()
  const finals = freshText.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).filter(event => event.envelopeType === 'final')
  assert.equal(finals.length, 1)
  assert.match(finals[0].finalResponse.councilSingleResponse, /391/)
  console.log('PASS fresh decree after cancellation: real Ollama answered 391')
  const familyResponse = await handler(request(bodyFor('Name the capital of Japan in one word.', 'family-identity-after-cancel', true)))
  const familyFrames = (await familyResponse.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
  const familyFinal = familyFrames.find(event => event.envelopeType === 'final')
  assert.ok(familyFinal, 'Family path must complete')
  assert.equal(familyFinal.finalResponse.councilProgress.logicalRequestId, 'family-identity-after-cancel')
  for (const event of familyFrames.filter(event => event.envelopeType === 'progress')) {
    assert.equal(event.snapshot.logicalRequestId, 'family-identity-after-cancel', 'Every live snapshot must carry decree identity')
  }
  const turns = familyFinal.finalResponse.familyDeliberation.turns
  assert.match(turns.find(turn => turn.turn_id === familyFinal.finalResponse.familyDeliberation.synthesis_turn_id).full_response, /Tokyo/i)
  console.log('PASS family decree identity on every snapshot and final; real Ollama answered Tokyo')
  mkdirSync('work/build3', { recursive: true })
  writeFileSync('work/build3/cancellation-live.json', JSON.stringify(records, null, 2))
}
