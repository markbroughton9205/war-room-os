/** Read actual project source and apply the existing Phase 6 reviewers to a build mission. */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { listRepoFiles, readRepoFile } from './repositoryInspector'
import { acceptanceBasis } from './foundryAcceptanceBasis'
import { runSelfReview } from './foundrySelfReview'
import { runIndependentVerification } from './foundryIndependentVerifier'
import { phase6CompletionAllowed } from './foundryPhase6Completion'
import { applicationCompletionMissing, currentApplicationEvidence, duplicatedApplicationFixtureLiterals, existingTopLevelBindings, type ApplicationBuildState } from './foundryApplicationMission'
import type { Phase6Source } from './foundryPhase6Types'

export async function applicationSourceSnapshot(): Promise<{ digest: string; sources: Phase6Source[] }> {
  const files = (await listRepoFiles()).filter(f => /\.(?:[cm]?[jt]sx?|py|html|css|json|toml|ya?ml|md|rs|go)$/.test(f)).sort()
  if (files.length > 400) throw new Error('Application review source budget exceeded; use bounded existing-project review.')
  const sources: Phase6Source[] = []
  let bytes = 0
  const hash = createHash('sha256')
  for (const file of files) {
    const read = await readRepoFile(file)
    if (!read.ok) throw new Error(`Application review cannot read ${file}: ${read.error}`)
    bytes += Buffer.byteLength(read.content)
    if (bytes > 2_000_000) throw new Error('Application review text budget exceeded; use bounded existing-project review.')
    hash.update(JSON.stringify([file, read.content]))
    sources.push({ file, text: read.content, role: /(?:^|[/._-])(tests?|specs?)(?:[/._-]|$)/.test(file) ? 'test' : 'source' })
  }
  return { digest: hash.digest('hex'), sources }
}

export function preferredMissingWebSourcePath(
  sources: Phase6Source[],
  candidates: Array<{ path?: string; content?: string }>,
): string | undefined {
  const product = sources.filter(source => source.role !== 'test')
  const missingRole = !product.some(source => /\.html$/i.test(source.file))
    ? 'document'
    : !product.some(source => /\.css$/i.test(source.file))
      ? 'style'
      : !product.some(source => /\.[cm]?js$/i.test(source.file) && /\b(?:document|localStorage|window)\b/.test(source.text))
        ? 'browser'
        : undefined
  if (!missingRole) return undefined
  return candidates.find(candidate => {
    if (!candidate.path) return false
    if (missingRole === 'document') return /\.html$/i.test(candidate.path)
    if (missingRole === 'style') return /\.css$/i.test(candidate.path)
    return /\.[cm]?js$/i.test(candidate.path)
      && !/(?:^|\/)(?:server|[^/]*(?:test|spec))\.[cm]?js$/i.test(candidate.path)
      && /\b(?:document|localStorage|window)\b/.test(candidate.content ?? '')
  })?.path
}

export function applicationTestDefects(sources: Phase6Source[], runtime: string, projectType?: string): string[] {
  if (runtime !== 'node') return []
  const tests = sources.filter(s => s.role === 'test')
  if (!tests.length) return ['No application test files exist.']
  const lifecycleOnly = tests.find(s => /\b(?:spawn|before|after)\s*\(/.test(s.text) && !/(?:\btest|\bit|\bdescribe)\s*\(/.test(s.text))
  if (lifecycleOnly) return [`The application test file ${lifecycleOnly.file} starts lifecycle work but registers no executable tests. Every test file that starts a process or hook must contain at least one real test(...) case so cleanup runs and node --test can exit.`]
  if (!tests.some(s => /(?:\btest|\bit|\bdescribe)\s*\(/.test(s.text))) {
    return ['The application test files do not register executable tests. Exported helper functions and printed messages cannot establish behavior.']
  }
  if (tests.some(s => /(?:assert\.(?:match|equal|strictEqual)[^\n]*Identifying Body Content|\/Identifying Body Content\/|Adjust (?:the )?(?:regex|assertion|expected)|TODO:\s*(?:adjust|replace|update).*(?:assert|expect|match))/i.test(s.text))) {
    return ['Application tests contain a placeholder expected value or an instruction to adjust the assertion later. Assert identifying content that actually exists in the current product source.']
  }
  const productExports = new Map<string, string>()
  for (const source of sources) {
    if (source.role === 'test') continue
    for (const match of source.text.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      productExports.set(match[1], source.file)
    }
  }
  for (const source of tests) {
    const bound = new Set(existingTopLevelBindings(source.text))
    for (const [name, file] of productExports) {
      if (bound.has(name)) continue
      if (new RegExp(`\\b${name}\\s*\\(`).test(source.text)) {
        return [`The test ${source.file} calls ${name}( but never imports ${name}; it is exported from the product module ${file}. PATCH the existing import line from ${file.startsWith('.') || file.startsWith('/') ? file : `./${file}`} in ${source.file} to add the named import ${name}; do not redeclare any other already-bound name.`]
      }
    }
  }
  const normalizeFn = [...productExports.keys()].find(name => /normalize/i.test(name))
  if (normalizeFn) {
    for (const source of tests) {
      if (!new Set(existingTopLevelBindings(source.text)).has(normalizeFn)) continue
      for (const match of source.text.matchAll(/\btest\s*\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*async[^{]*\{([\s\S]*?)\n\}\);/g)) {
        const [, , name, body] = match
        if (new RegExp(`\\b${normalizeFn}\\s*\\(`).test(body)) continue
        const upperLiteralCompare = new RegExp(`(?:===|assert\\.(?:strictEqual|equal))\\s*\\(?[^,\\n]*?,?\\s*['"]([A-Za-z0-9_-]*[A-Z][A-Za-z0-9_-]*)['"]`).exec(body)
        if (upperLiteralCompare) {
          return [`The test named exactly '${name}' in ${source.file} compares against the literal '${upperLiteralCompare[1]}' without applying ${normalizeFn}(...), but other test( blocks in this same file already show the product normalizes this kind of value through ${normalizeFn} before storing or returning it. PATCH only the test whose matchText begins with the exact literal test('${name}', so every comparison against that posted value wraps it in ${normalizeFn}(...), matching the pattern other tests in this file already use; do not change product source.`]
        }
      }
    }
  }
  if (projectType === 'api') {
    const defects: string[] = []
    const afterBodies = tests.flatMap(source => [...source.text.matchAll(/\bafter\s*\(\s*async\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\);/g)].map(match => match[1]))
    const beforeCount = tests.reduce((count, source) => count + [...source.text.matchAll(/\bbefore\s*\(/g)].length, 0)
    const afterCount = tests.reduce((count, source) => count + [...source.text.matchAll(/\bafter\s*\(/g)].length, 0)
    if (tests.some(s => /import\s*\{[^}]*\b(?:assert|expect)\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text))) defects.push('API tests import assertions from node:test. Import test, before, and after from node:test, and import assert from node:assert/strict.')
    if (!tests.some(s => /import\s+assert\s+from\s*['"]node:assert\/strict['"]/.test(s.text))) defects.push('API tests do not import the real strict assertion module. Import assert from node:assert/strict and make concrete assertions on every HTTP result.')
    if (tests.some(s => /\bprocess\.chdir\s*\(/.test(s.text))) defects.push('API tests change the shared test-runner working directory. Pass an isolated DATA_FILE to the child environment and leave process.cwd() unchanged.')
    if (!tests.some(s => /import\s*\{[^}]*\bbefore\b[^}]*\bafter\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text))) defects.push('API tests do not import the registered before and after lifecycle hooks from node:test.')
    if (!tests.some(s => /\bspawn\s*\(/.test(s.text) && /\bprocess\.execPath\b/.test(s.text))) defects.push('API integration tests do not spawn the real server entrypoint asynchronously with process.execPath and an argument array.')
    if (tests.some(s => /\bspawnSync\s*\(|\bexec(?:Sync)?\s*\(/.test(s.text))) defects.push('API tests use blocking or shell process execution. Spawn the real long-running server asynchronously without a shell.')
    if (tests.some(s => /import\s*\(\s*['"]node:(?:fetch|http)['"]\s*\)/.test(s.text))) defects.push("API tests dynamically import fetch from a nonexistent Node built-in export. Patch the exact current line containing await import('node:fetch') or await import('node:http') and replace the destructuring assignment with direct use of the supported global fetch; do not search for a static import statement that is not present.")
    else if (tests.some(s => /import\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*['"]node:(?:fetch|http)['"]/.test(s.text) || /import\s+fetch\s+from\s*['"]node:(?:fetch|http)['"]/.test(s.text))) defects.push('API tests import fetch from a nonexistent Node built-in export. Remove the exact current static import and use the supported global fetch for real HTTP requests.')
    if (!tests.some(s => /\bmkdtemp(?:Sync)?\s*\(/.test(s.text) && /\btmpdir\s*\(/.test(s.text) && /process\.env[\s\S]{0,300}(?:DATA_FILE|DATA_PATH|STORAGE_PATH)|env\s*:[\s\S]{0,300}(?:DATA_FILE|DATA_PATH|STORAGE_PATH)/.test(s.text))) defects.push('API tests must create a real temporary data directory outside reviewed source and pass its isolated DATA_FILE to the owned server. If mkdtemp currently uses sourceDir, replace that argument with join(tmpdir(), a prefix), import tmpdir from node:os, and keep the existing data-path env key so restart proof never mutates reviewed source.')
    if (!tests.some(s => /\.listen\s*\(\s*0\s*,\s*['"]127\.0\.0\.1['"]/.test(s.text) && /\.address\s*\(\s*\)/.test(s.text) && /\.close\s*\(/.test(s.text))) defects.push('API tests do not reserve and release a real dynamic loopback port before spawning the server.')
    if (beforeCount !== 1) defects.push('API tests must use exactly one before() startup hook. Remove one complete duplicate hook at a time; start one owned server with one isolated DATA_FILE before the suite and perform restart persistence inside a test.')
    if (afterCount !== 1) defects.push('API tests must use exactly one after() cleanup hook. Remove one complete duplicate hook at a time with replacementText empty; do not invent a combined adjacent match across hooks with different bodies.')
    if (tests.some(source => /^const\s+([A-Za-z_$][\w$]*)\s*=[^;]+;[\s\S]{0,5000}\b\1\s*=(?!=)/m.test(source.text))) defects.push('API tests reassign a top-level const binding at runtime. PATCH the exact declaration from const to let; preserve the before() assignment and do not append another declaration.')
    if (beforeCount === 1 && afterCount === 1 && !tests.some(s => /\bbefore\s*\(/.test(s.text) && /\bafter\s*\(/.test(s.text) && /\.kill\s*\(\s*['"]SIGTERM['"]/.test(s.text) && /Promise\.race\s*\(/.test(s.text))) defects.push('API tests do not register owned startup and bounded graceful-shutdown hooks. PATCH the one complete existing after() hook so it creates the exit event before SIGTERM and immediately awaits a rejecting bounded Promise.race.')
    if (tests.some(s => /\bbefore\s*\([\s\S]*?\bconst\s+tempDir\b/.test(s.text) && /\bafter\s*\([\s\S]*?\btempDir\b/.test(s.text))) defects.push('API cleanup references tempDir outside the before() hook where it is declared. Declare let tempDir in outer suite scope and assign it inside before(); do not add a second tempDir binding.')
    if (tests.some(s => /\bmkdtemp(?:Sync)?\s*\(/.test(s.text)) && !afterBodies.some(body => /\brm\s*\(\s*tempDir\b/.test(body))) defects.push('API tests create a temporary persistence directory but never remove it. Keep let tempDir in outer scope, assign it in before(), and await rm(tempDir, { recursive: true, force: true }) in the one after() hook after the child exits.')
    if (afterBodies.some(body => /\bspawn\s*\(/.test(body))) defects.push('API cleanup restarts the server inside after(). Restart and persisted-read assertions belong in a registered test; after() must only stop the current child and remove temporary data after exit.')
    if (afterBodies.some(body => /Promise\.race\s*\(/.test(body) && !/new\s+Promise\s*\(\s*\([^)]*reject/.test(body))) defects.push('API shutdown race does not include a rejecting bounded timeout. Race the child exit against a locally-created Promise that rejects after the deadline.')
    if (!tests.some(s => (s.text.match(/\bspawn\s*\(/g) ?? []).length >= 2 && /DATA_FILE/.test(s.text) && /(?:restart|persist)/i.test(s.text))) {
      const incompleteRestart = tests.some(s => /test\s*\([^\n]*(?:restart|persist)/i.test(s.text) && /\.kill\s*\(\s*['"]SIGTERM['"]/.test(s.text))
      defects.push(incompleteRestart
        ? 'An existing restart/persistence test stops the owned child but never spawns the replacement server. PATCH that complete existing test block instead of appending another test: create and await the exit event, send SIGTERM, spawn process.execPath again on the same port with the same DATA_FILE, await readiness, then assert the persisted read.'
        : 'API tests do not perform a real owned server restart against the same DATA_FILE and verify persisted data afterward. Add one bounded test that stops the child, awaits exit, spawns process.execPath again on the same port with the same DATA_FILE, awaits readiness, and asserts a persisted read.')
    }
    if (tests.some(s => /test\s*\([^\n]*(?:restart|persist)[\s\S]{0,3000}\bdata\s*\[\s*0\s*\]/i.test(s.text))) defects.push('The restart persistence test asserts whichever item happens to be data[0], so earlier update tests can make it fail for the wrong reason. Create or capture one note ID before restart, then GET /notes/{{that id}} after restart and assert that exact created or updated record.')
    if (tests.some(s => /\bwhile\s*\(\s*true\s*\)/.test(s.text))) defects.push('API readiness uses an unbounded while(true) loop. Poll health only until a fixed deadline, catching transient connection failures, then throw from the awaited readiness function.')
    if (tests.some(s => /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{?\s*throw\b/.test(s.text))) defects.push('API tests throw from an independent timer. Use a deadline in readiness and a rejecting Promise only inside the awaited cleanup Promise.race.')
    if (tests.some(s => /^(?:const|let|var)\s+\w*(?:timeout|deadline)\w*\s*=\s*new\s+Promise/im.test(s.text))) defects.push('API tests create a timeout Promise at module scope. Create bounded timeout promises only where they are immediately awaited.')
    if (!tests.some(s => {
      const hasRealFetch = /\bfetch\s*\(/.test(s.text)
      const hasPost = /method\s*:\s*['"]POST['"]/.test(s.text) || /\b\w+\s*\([^\n]*['"]POST['"]/.test(s.text)
      const hasUpdate = /method\s*:\s*['"](?:PUT|PATCH)['"]/.test(s.text) || /\b\w+\s*\([^\n]*['"](?:PUT|PATCH)['"]/.test(s.text)
      return hasRealFetch && hasPost && hasUpdate
    })) defects.push('API tests do not exercise real create and update requests over HTTP.')
    if (!tests.some(s => /(?:status|statusCode)[^\n]*(?:400|422)/.test(s.text))) defects.push('API tests do not assert malformed or missing-input handling with a real 400 or 422 HTTP status. Add one bounded real-request test for this missing client-error status.')
    if (!tests.some(s => /(?:status|statusCode)[^\n]*404/.test(s.text))) defects.push('API tests do not assert invalid-ID or unknown-resource handling with a real 404 HTTP status. Add one bounded real-request test for this missing not-found status.')
    if (!tests.some(s => /body\s*:\s*['"]not-json['"]/.test(s.text))) defects.push("API tests do not send genuinely malformed JSON. Send the raw request body 'not-json' with application/json and assert the real 400 response; JSON.stringify('invalid json') is valid JSON.")
    if (!tests.some(s => /title\s*:\s*['"]\s{2,}['"]/.test(s.text))) defects.push('API tests do not exercise whitespace-only title validation over real HTTP. Send a title containing only spaces and assert the real 400 or 422 response.')
    if (tests.some(s => /\b(?:mock|stub|fake)(?:Implementation|ReturnValue|ResolvedValue)?\s*\(|\b(?:jest|vi|sinon)\s*\./i.test(s.text))) defects.push('API tests replace real server, HTTP, or persistence behavior with mocks, stubs, or fakes.')
    const duplicatedFixtureLiterals = [...new Set(tests.flatMap(source => duplicatedApplicationFixtureLiterals(source.text)))]
    if (duplicatedFixtureLiterals.length && tests.some(s => /assert\.(?:strictEqual|equal|deepStrictEqual)\s*\([^\n;]*\.(?:length|count)\b/.test(s.text))) {
      defects.push(`Test fixture values ${duplicatedFixtureLiterals.join(', ')} are reused across more than one test( block, but every test in this suite shares one persistent server and data file created by a single before() hook, so earlier tests' matching fixture data accumulates rather than resetting. PATCH the test that asserts an exact count or length tied to one of these values so its own fixture data uses a value not used by any other test( block in this file; do not edit server logic for this.`)
    }
    for (const source of tests) {
      for (const match of source.text.matchAll(/\btest\s*\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*async[^{]*\{([\s\S]*?)\n\}\);/g)) {
        const [, , name, body] = match
        if (/assert\.(?:strictEqual|equal)\s*\(\s*\w+\.length\s*,\s*\d+\s*\)/.test(body) && /\[\s*0\s*\]\s*\.\w+/.test(body)) {
          defects.push(`The test named exactly '${name}' in ${source.file} asserts the exact total .length of an aggregate or summary endpoint response and then indexes entries positionally (response[0], response[1], ...). Every test in this suite shares one persistent data file, so other test( blocks that create their own fixture data before this one can add further distinct entries to that same aggregate, making an exact total length and a fixed position unreliable regardless of which fixture values this test uses. PATCH only the test whose matchText begins with the exact literal test('${name}', so its own fixture's identifying value locates the one entry with .find(...), and assert only that entry's fields; remove the exact total-length assertion and the positional indexing.`)
        }
      }
    }
    return defects
  }
  if (projectType === 'web') {
    const defects: string[] = []
    const webProduct = sources.filter(source => source.role !== 'test')
    const webDocumentText = webProduct.filter(source => /\.html$/i.test(source.file) && /<!doctype\s+html|<html\b/i.test(source.text)).map(source => source.text).join('\n')
    const assertedWebIdentities = tests.flatMap(source =>
      [...source.text.matchAll(/assert\.match\s*\(\s*[^,\n]+,\s*\/([^/\n\\]{3,})\/[gimsuy]*\s*\)/g)].map(match => match[1]),
    ).filter(identity => !/\d/.test(identity))
    const missingWebIdentity = assertedWebIdentities.find(identity => webDocumentText && !webDocumentText.includes(identity))
    if (missingWebIdentity) {
      const currentTitle = /<title>([^<]+)<\/title>/.exec(webDocumentText)?.[1] ?? /<h1[^>]*>([^<]+)<\/h1>/.exec(webDocumentText)?.[1]
      const testFile = tests.find(source => new RegExp(`/${missingWebIdentity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(source.text))?.file
      if (currentTitle && testFile) {
        return [`The test named exactly the pattern /${missingWebIdentity}/ in ${testFile} does not match the real application document's existing title or heading "${currentTitle}". PATCH only that one regular expression literal in ${testFile}, replacing /${missingWebIdentity}/ with a pattern matching the literal text "${currentTitle}" exactly; do not edit index.html, and do not edit server.mjs.`]
      }
    }
    for (const source of tests) {
      for (const match of source.text.matchAll(/\bassert\.match\s*\(\s*body\s*,\s*\/([^/\n]+)\/[gimsuy]*\s*\)/g)) {
        const [whole, pattern] = match
        if (webDocumentText.includes(pattern)) continue
        const labelPrefix = pattern.replace(/(?:\\d\+?|\\d\{[\d,]+\}|\s*\d+)\s*$/, '')
        if (labelPrefix === pattern || !labelPrefix.trim()) continue
        const prefixIndex = webDocumentText.indexOf(labelPrefix)
        if (prefixIndex < 0) continue
        const afterPrefix = webDocumentText.slice(prefixIndex + labelPrefix.length)
        if (/^\s*</.test(afterPrefix)) {
          return [`The test in ${source.file} asserts ${whole} against the static server response body, but the real document only has "${labelPrefix}" followed immediately by an HTML tag, not a literal number; the actual number is rendered later at runtime by client-side JavaScript (for example inside a <span> the server sends empty or with a placeholder). A plain GET / request returns the unrendered static HTML, so this exact assertion can never pass no matter what the server sends. PATCH this one assert.match call to check only "${labelPrefix}" (the static label actually present in the server-rendered HTML, without the dynamic number), and verify the dynamic rendered value separately through real browser interaction instead.`]
        }
      }
    }
    if (tests.some(s => /\bexec(?:Sync)?\s*\(/.test(s.text))) defects.push('Web tests execute shell command strings. Use child_process.spawn with process.execPath and an argument array.')
    if (tests.some(s => /\bcreateServer\s*\(/.test(s.text) && !/import\s*\{[^}]*\bcreateServer\b[^}]*\}\s*from\s*['"]node:(?:net|http)['"]/.test(s.text))) defects.push('Web tests call createServer without importing it from node:net or node:http. Import createServer explicitly before reserving a real ephemeral port.')
    if (tests.some(s => /\b(?:new\s+DOMParser\s*\(|localStorage\.|document\.|window\.)/.test(s.text))) defects.push('Node integration tests use browser-only APIs. Keep node:test focused on the real spawned server and HTTP responses; the executor owns real Playwright UI interaction and browser localStorage acceptance.')
    if (!tests.some(s => /\bspawn\s*\(/.test(s.text) && /\bprocess\.execPath\b/.test(s.text))) defects.push('Web application tests do not start the real server entrypoint with asynchronous spawn and process.execPath.')
    if (tests.some(s => /\bspawnSync\s*\(/.test(s.text))) defects.push('Web tests use spawnSync for a long-running server or request, which blocks the test process. Use asynchronous spawn for the server and Node HTTP for requests.')
    if (tests.some(s => /\/health/.test(s.text) && /(?:deepEqual|deepStrictEqual)\s*\([^\n]*\{\s*success\s*:\s*true\s*\}/.test(s.text))) defects.push('Web tests assert a noncanonical health payload { success: true }. The generic server contract is GET /health returning { ok: true }; assert that exact real JSON response so tests cannot drive the server away from its runtime contract.')
    if (tests.some(s => /(?:^|[;\n])\s*await\s+(?:test|it)\s*\(/m.test(s.text))) defects.push('Web tests await top-level test(...) registration. Register each test synchronously with test(...); await only operations inside the async test callback so shared before/after lifecycle cannot close the server between registrations.')
    if (tests.some(s => /\bjoin\s*\(\s*dirname\s*\(\s*fileURLToPath\s*\(\s*import\.meta\.url\s*\)\s*\)\s*,\s*['"]\.\.['"]/.test(s.text))) defects.push("Web tests resolve the real server entrypoint from the parent of the project. Use fileURLToPath(new URL('./server.mjs', import.meta.url)) so the spawned entrypoint is the server beside the test file.")
    if (tests.some(s => /promisify\s*\(\s*spawn\s*\)/.test(s.text))) defects.push('Web tests promisify child_process.spawn even though spawn is event-based, not callback-based. Use the returned ChildProcess directly and await readiness events.')
    if (tests.some(s => /spawn(?:Sync)?\s*\(\s*['"]curl['"]/.test(s.text))) defects.push('Web tests delegate HTTP behavior to curl. Use Node fetch or node:http against the real spawned server.')
    if (!tests.some(s => /(?:\bfetch\s*\(|\bhttp\.(?:get|request)\s*\(|\brequest\s*\()/.test(s.text) && (!/\brequest\s*\(/.test(s.text) || /from\s*['"]node:http['"]/.test(s.text)))) defects.push('Web application tests do not send real HTTP requests from Node to the running server.')
    const hasDocumentAssertion = tests.some(s =>
      /content-type/i.test(s.text)
      && /text\\?\/html/i.test(s.text)
      && /(?:assert\.(?:equal|strictEqual)\s*\([^\n]*(?:\.status|status)[^\n]*200|(?:\.status|status)[^\n]*===?\s*200)/i.test(s.text)
      && /assert\.match\s*\([^\n]*(?:\.text\s*\(|body|html|text)[\s\S]{0,300}\/[^/\n]{3,}\//i.test(s.text),
    )
    if (!hasDocumentAssertion) defects.push('Web application tests exercise health only or weaken the document contract. Send a separate real GET / request and assert response.status equals 200, Content-Type matches /text\\/html/i, and the response body matches the concrete product name or heading.')
    if (tests.some(s => /import\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*['"]node:(?:http|https|fetch)['"]/.test(s.text))) defects.push('Web tests import fetch from a nonexistent Node built-in export. On supported Node runtimes, call the global fetch directly without importing it; otherwise use node:http request.')
    if (tests.some(s => /import\s*\{[^}]*\b(?:assert|expect)\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text))) defects.push('Application tests import assertions from node:test. Import assert from node:assert/strict and lifecycle hooks directly from node:test.')
    if (tests.some(s => /\btest\.(?:beforeAll|afterAll|beforeEach|afterEach)\s*\(|\bt\.(?:beforeAll|afterAll|beforeEach|afterEach)\s*\(/.test(s.text))) defects.push('Application tests call Jest-style lifecycle methods. Import before, after, beforeEach, or afterEach directly from node:test, or use TestContext after().')
    if (tests.some(s => /import\s*\{[^}]*(?:beforeAll|afterAll)[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text))) defects.push('node:test does not export beforeAll or afterAll. Use before and after, beforeEach and afterEach, or TestContext after().')
    if (tests.some(s => /\bspawn\s*\(/.test(s.text) && (!/import(?:\s+\w+\s*,)?\s*\{[^}]*\bbefore\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text) || !/import(?:\s+\w+\s*,)?\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text) || !/\bbefore\s*\(/.test(s.text) || !/\bafter\s*\(/.test(s.text)))) defects.push('Web tests do not register real node:test before/after lifecycle hooks. Import before and after from node:test and call before(async () => ...) and after(async () => ...); exported functions named before or after are not hooks.')
    if (tests.some(s => /export\s+(?:const|let|var|function)\s+(?:before|after)\b/.test(s.text))) defects.push('Web tests export functions named before/after instead of registering lifecycle hooks. Remove those exports and call the node:test before(...) and after(...) functions directly.')
    if (tests.some(s => /^(?:const|let|var)\s+\w*(?:timeout|deadline)\w*\s*=\s*new\s+Promise\s*\([^\n]*setTimeout/im.test(s.text))) defects.push('Web tests create a rejecting timeout Promise at module scope. Create the bounded shutdown timeout inside after() so it cannot reject before cleanup begins.')
    if (tests.some(s => /(?:const|let|var)\s+port\s*=\s*18765\b|port\s*:\s*(?:process\.env\.PORT\s*\|\|\s*)?\d{4,5}\b/i.test(s.text))) defects.push('Web tests hard-code or scan from a shared preview port. Reserve an ephemeral port by listening with a temporary node:net server on port 0 at 127.0.0.1, read server.address().port, close that reservation, then pass the exact port through the child PORT environment variable.')
    if (!tests.some(s => /await\s+(?:\w+\s*\([^)]*\)|new\s+Promise\s*\()[\s\S]{0,1800}\bspawn\s*\(/m.test(s.text) && /new\s+Promise\s*\([\s\S]{0,1200}\.listen\s*\(\s*0\s*,\s*['"]127\.0\.0\.1['"][\s\S]{0,1200}(?:\.address\s*\(\s*\)\s*\.port|const\s*\{\s*port\s*\}\s*=\s*\w+\.address\s*\(\s*\))[\s\S]{0,1200}\.close\s*\(/m.test(s.text))) defects.push('Web tests do not await a complete ephemeral-port reservation. Wrap temporary node:net listen(0, "127.0.0.1"), address().port, and close() in a Promise, await that reservation before spawning the server, and return the exact port; a listen callback that mutates a later-used variable races child startup.')
    if (tests.some(s => /\bspawn\s*\(/.test(s.text) && /\.(?:stdout|stderr)\.toString\s*\(/.test(s.text))) defects.push('Web tests treat the asynchronous ChildProcess returned by spawn like a spawnSync result. Capture stdout/stderr from data events, await readiness over real HTTP, and use exit/close events for termination status.')
    if (tests.some(s => /(?:async\s+function|(?:const|let|var)\s+\w+\s*=\s*async)[\s\S]{0,500}new\s+Promise[\s\S]{0,800}\bspawn\s*\([\s\S]{0,800}(?:\.on|\.once)\s*\(\s*['"](?:exit|close)['"][\s\S]{0,500}resolve\s*\(/m.test(s.text))) defects.push('Web test startup waits for the spawned server to exit before it can run readiness checks. Return the ChildProcess immediately after spawn, then poll /health; await exit only during cleanup.')
    if (!tests.some(s => /(?:for\s*\(|setTimeout\s*\(|setInterval\s*\(|Promise\.race\s*\()[\s\S]{0,1800}(?:\bfetch\s*\(|\bhttp\.(?:get|request)\s*\(|\brequest\s*\()/m.test(s.text))) defects.push('Web tests do not wait for the spawned server to become ready. Poll its real /health endpoint with a bounded timeout before running assertions.')
    if (tests.some(s => /(?:async\s+function\s+waitFor(?:Health|Ready)|(?:const|let)\s+waitFor(?:Health|Ready)\s*=\s*async)[\s\S]{0,1800}\bfetch\s*\(/m.test(s.text) && !/(?:async\s+function\s+waitFor(?:Health|Ready)|(?:const|let)\s+waitFor(?:Health|Ready)\s*=\s*async)[\s\S]{0,1200}\btry\s*\{[\s\S]{0,600}\bfetch\s*\(/m.test(s.text))) defects.push('Web test readiness does not catch transient connection failures. Put each startup fetch inside try/catch within the bounded retry loop so the expected initial ECONNREFUSED retries until health succeeds or the deadline expires.')
    if (tests.some(s => /(?:waitForHealth|waitForReady)[\s\S]{0,1800}\bwhile\s*\(\s*true\s*\)/m.test(s.text))) defects.push('Web test readiness uses an unbounded while(true) loop. Use a deadline-controlled for/while loop that throws synchronously from the awaited readiness function when the deadline expires.')
    if (tests.some(s => /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{?\s*throw\b/m.test(s.text))) defects.push('Web tests throw from an independent setTimeout callback. Track a deadline inside the awaited readiness loop or reject a timeout Promise used in Promise.race so failure and cleanup stay owned by the test.')
    if (tests.some(s => /test\s*\(\s*['"][^'"]*(?:stop|shutdown)[^'"]*['"][\s\S]{0,500}\.kill\s*\(/i.test(s.text))) defects.push('Web tests terminate the shared server inside a test case. Stop the exact owned child once in lifecycle cleanup after all behavior assertions.')
    if (tests.some(s => /\bafter\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>[\s\S]{0,800}\1\.kill\s*\(/m.test(s.text))) defects.push('Web test cleanup mistakes the node:test hook context parameter for the spawned child. Store the actual ChildProcess in outer scope and terminate that exact process from after().')
    if (tests.some(s => /\bafter\s*\([\s\S]{0,800}(?:once\s*\(\s*child\s*,|child\.kill\s*\()/m.test(s.text) && !/\bafter\s*\([\s\S]{0,300}\bif\s*\(\s*!?child\s*\)/m.test(s.text))) defects.push('Web test cleanup assumes the child exists even when startup fails. Guard cleanup when no child was assigned so the original readiness or import failure remains the actionable error.')
    if (tests.some(s => /\bt\.pass\s*\(/.test(s.text))) defects.push('node:test TestContext has no t.pass assertion. Import assert from node:assert/strict and assert real response status, headers, and body behavior.')
    if (!tests.some(s => /\bafter\s*\([\s\S]{0,1600}\.kill\s*\(\s*['"]SIGTERM['"]\s*\)[\s\S]{0,1200}Promise\.race\s*\(/m.test(s.text) && /(?:\bonce\s*\(\s*[^,]+\s*,\s*['"](?:exit|close)['"]|\.once\s*\(\s*['"](?:exit|close)['"])/m.test(s.text))) defects.push('Web tests do not prove clean owned-process shutdown. In after() cleanup create an exit/close event promise, send SIGTERM to the exact child, and await that event with Promise.race and a bounded fallback.')
    if (tests.some(s => /\bmkdtemp(?:Sync)?\s*\(\s*['"][^/]/.test(s.text))) defects.push('Web tests create relative temporary directories inside the source workspace. Prefix mkdtemp with join(tmpdir(), ...).')
    if (tests.some(s => /\b(?:mock|stub|fake)(?:Implementation|ReturnValue|ResolvedValue)?\s*\(|\b(?:jest|vi|sinon)\s*\./i.test(s.text))) defects.push('Application tests replace product behavior with mocks, stubs, or fakes.')
    if (tests.some(s => /(?:placeholder for browser|for demonstration|const\s+getBrowser\s*=|goto:\s*async\s*\([^)]*\)\s*=>\s*\{\s*\}|evaluate:\s*async\s*\([^)]*\)\s*=>\s*\{\s*\})/i.test(s.text))) defects.push('Application tests contain fake or placeholder browser automation. Remove the fake helper; the executor owns real Playwright browser acceptance after Node integration tests pass.')
    if (!tests.some(s => /(?:\bassert(?:\.[A-Za-z_]+)?\s*\(|\bthrow\s+)/.test(s.text))) defects.push('The application tests have no real assertions or throwing checks.')
    return defects
  }
  if (tests.some(s => /\bexec(?:Sync)?\s*\(/.test(s.text))) {
    return ['Application tests invoke shell command strings. Execute the real program with spawn/spawnSync, process.execPath, and an argument array in a temporary directory.']
  }
  if (projectType === 'cli' && !tests.some(s => /\bspawn(?:Sync)?\s*\(/.test(s.text) && /\bprocess\.execPath\b/.test(s.text))) {
    return ['CLI tests do not execute the real entrypoint with spawn/spawnSync, process.execPath, and an argument array.']
  }
  if (projectType === 'cli' && !tests.some(s => /\bmkdtemp(?:Sync)?\s*\(/.test(s.text))) {
    return ['CLI tests do not create real temporary working directories. Each behavior test must isolate its persistence files in a temporary cwd.']
  }
  if (projectType === 'web' && !tests.some(s => /\bspawn(?:Sync)?\s*\(/.test(s.text) && /\bprocess\.execPath\b/.test(s.text))) {
    return ['Web application tests do not start the real server entrypoint in a child process. Run the actual server with process.execPath, an argument array, and an isolated dynamic PORT.']
  }
  if (projectType === 'web' && tests.some(s => /\bspawnSync\s*\(/.test(s.text))) {
    return ['Web tests use spawnSync for a long-running server, which blocks the test process before requests can run. Start the real server with asynchronous spawn, wait for readiness, send real requests, and stop that exact child in test cleanup.']
  }
  if (projectType === 'web' && tests.some(s => /spawn(?:Sync)?\s*\(\s*['"]curl['"]/.test(s.text))) {
    return ['Web tests delegate HTTP behavior to curl. Use Node fetch or node:http against the real spawned server so tests remain native, portable, and able to assert status, headers, and body directly.']
  }
  if (projectType === 'web' && !tests.some(s => /(?:\bfetch\s*\(|\bhttp\.(?:get|request)\s*\()/.test(s.text))) {
    return ['Web application tests do not send real HTTP requests to the running server. Exercise health, document, and malformed-request behavior over loopback.']
  }
  if (tests.some(s => /\b(?:mock|stub|fake)(?:Implementation|ReturnValue|ResolvedValue)?\s*\(|\b(?:jest|vi|sinon)\s*\./i.test(s.text))) {
    return ['Application tests replace product behavior with mocks, stubs, or fakes. Phase 7 requires the real entrypoint, real HTTP, real storage, and real child processes.']
  }
  if (projectType === 'cli' && tests.some(s => /\bmkdtemp(?:Sync)?\s*\(\s*['"][^/]/.test(s.text))) {
    return ['CLI tests create relative temporary directories inside the source workspace. Build the prefix from node:os tmpdir() and node:path join() so test data cannot pollute or change the reviewed application source.']
  }
  if (projectType === 'cli' && tests.some(s => /\bspawnSync\s*\(/.test(s.text) && /\.[Ee]xitCode\b/.test(s.text))) {
    return ['CLI tests read exitCode from spawnSync results, but Node child-process results expose the numeric exit status as status. Assert result.status so a real failing process cannot be mistaken for undefined test metadata.']
  }
  if (projectType === 'cli' && tests.some(s => /\bspawn(?:Sync)?\s*\(/.test(s.text) && /['"]\d{10,}['"]/.test(s.text) && !/(?:readFile(?:Sync)?|JSON\.parse)\s*\(/.test(s.text))) {
    return ['CLI tests hard-code a generated identifier without reading it from real process output or persisted data. Discover generated IDs from the application result, then use that exact value in later update/read invocations.']
  }
  if (tests.some(s => /import\s*\{[^}]*\b(?:assert|expect)\b[^}]*\}\s*from\s*['"]node:test['"]/.test(s.text))) {
    return ["Application tests import assertion helpers from node:test, but node:test has no export literally named assert, strict, or expect; only test, before, after, beforeEach, and afterEach exist there. Use exactly these two separate import statements instead: import { test, before, after } from 'node:test'; and import assert from 'node:assert/strict'; (a default import, not a named one). Then call assert.strictEqual, assert.match, and other methods on that default import."]
  }
  if (tests.some(s => /\btest\.(?:beforeAll|afterAll|beforeEach|afterEach)\s*\(|\bt\.(?:beforeAll|afterAll|beforeEach|afterEach)\s*\(/.test(s.text))) {
    return ['Application tests call Jest-style lifecycle methods on node:test functions or contexts. Import before, after, beforeEach, or afterEach directly from node:test, or use the supported TestContext after() cleanup hook.']
  }
  if (tests.some(s => /\bprocess\.chdir\s*\(/.test(s.text))) {
    return ['Application tests change the test runner working directory. Create an isolated temporary directory per test and pass it as the child process cwd; never use process.chdir in the test runner.']
  }
  if (tests.some(s => /import\s*\{[^}]*\bchdir\b[^}]*\}\s*from\s*['"]node:process['"]/.test(s.text) || /(?<![.\w])chdir\s*\(/.test(s.text))) {
    return ['Application tests change the test runner working directory through chdir. Pass the temporary directory as each child process cwd and leave the test runner cwd unchanged.']
  }
  if (tests.some(s => {
    const registrations = s.text.match(/(?:^|\s)test\s*\(/gm)?.length ?? 0
    return registrations > 1 && /^const\s+\w+\s*=\s*await\s+[^\n]*mkdtemp\s*\(/m.test(s.text) && !/\bbeforeEach\s*\(/.test(s.text)
  })) {
    return ['Application tests share one top-level temporary data directory across multiple cases. Create a fresh temporary working directory for each test so persistence checks do not contaminate later assertions.']
  }
  if (!tests.some(s => /(?:\bassert(?:\.[A-Za-z_]+)?\s*\(|\bexpect\s*\(|\bthrow\s+)/.test(s.text))) {
    return ['The application tests have no assertions or throwing checks. Printed pass/fail messages cannot fail the test runner. Write actual behavior assertions.']
  }
  return []
}

export function applicationValidationPreflightDefects(sources: Phase6Source[], runtime: string, projectType?: string, commanderGoal?: string) {
  const sourceDefects = applicationSourceDefects(sources, projectType, commanderGoal)
  const testDefects = [...applicationTestDefects(sources, runtime, projectType), ...applicationContractTestDefects(sources, projectType, commanderGoal)]
  return { sourceDefects, testDefects, all: [...sourceDefects, ...testDefects] }
}

export function applicationContractTestDefects(sources: Phase6Source[], projectType?: string, commanderGoal = ''): string[] {
  if (projectType !== 'api') return []
  const testText = sources.filter(source => source.role === 'test').map(source => source.text).join('\n')
  if (/\b(?:duplicate|unique|uniqueness)\b/i.test(commanderGoal)) {
    const duplicatedFixtureLiterals = new Set(duplicatedApplicationFixtureLiterals(testText))
    if (duplicatedFixtureLiterals.size) {
      const owners = new Map<string, string[]>()
      for (const match of testText.matchAll(/\btest\s*\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*,\s*async[^{]*\{([\s\S]*?)\n\}\);/g)) {
        const [, , name, body] = match
        for (const value of duplicatedFixtureLiterals) {
          if (body.includes(`'${value}'`) || body.includes(`"${value}"`)) {
            const list = owners.get(value) ?? []
            list.push(name)
            owners.set(value, list)
          }
        }
      }
      const stillColliding = [...owners.entries()].filter(([, names]) => names.length > 1)
      if (stillColliding.length) {
        const detail = stillColliding.map(([value, names]) => `'${value}' is still used by: ${names.map(n => `test('${n}', ...)`).join(', ')}`).join('; ')
        return [`A new uniqueness requirement is being added, and these specific test( blocks still collide on the same fixture value: ${detail}. Every test in this suite shares one persistent server and data file, so once uniqueness is enforced, these sibling tests will now be incorrectly rejected as duplicates of each other. PATCH exactly one of the still-colliding tests named above at a time, giving it a distinct value for the field the new uniqueness rule applies to, until none of the listed tests share a value; do not re-patch a test( block that is not named in this list, since it has already been fixed.`]
      }
    }
  }
  if (!/(?:strengthen|add|extend)[^.\n]{0,80}(?:real\s+HTTP\s+)?integration tests/i.test(commanderGoal)) return []
  const defects: string[] = []
  const routes = [...commanderGoal.matchAll(/\/(?:[A-Za-z0-9_.:-]+)(?:\/[A-Za-z0-9_.:?=<>{}-]+)*(?:\?[A-Za-z0-9_.:?=<>{}&-]+)?/g)].map(match => match[0])
  for (const route of [...new Set(routes)]) {
    const needle = route.replace(/<[^>]+>/g, '').replace(/[?=]+$/, '')
    if (needle && !testText.includes(needle)) defects.push(`The real integration tests do not exercise the explicit Commander route ${route}. Add a registered HTTP test against the owned spawned server and preserve all existing cases.`)
  }
  if (/invalid\s+tag/i.test(commanderGoal) && !/invalid[^\n]{0,80}tag|tag[^\n]{0,80}invalid/i.test(testText)) defects.push('The real integration tests do not exercise invalid tag input required by the Commander contract.')
  return defects
}

export function prioritizeApplicationSourceRepair(projectType: string | undefined, sourceDefects: string[]): boolean {
  return projectType === 'api' && sourceDefects.length > 0
}

export function applicationSourceDefects(sources: Phase6Source[], projectType?: string, commanderGoal = ''): string[] {
  const product = sources.filter(source => source.role !== 'test')
  const defects: string[] = []
  for (const source of product) {
    for (const match of source.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source.file), match[2]))
      const target = product.find(candidate => candidate.file === resolved || candidate.file === `${resolved}.mjs` || candidate.file === `${resolved}.js`)
      if (!target) {
        defects.push(`Product source ${source.file} imports missing local module ${match[2]}. Use the exact path of an existing product module and its actual exported names.`)
        continue
      }
      const exported = new Set([...target.text.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(item => item[1]))
      for (const item of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
        const imported = item.split(/\s+as\s+/)[0].trim()
        if (!exported.has(imported)) defects.push(`Product source ${source.file} imports ${imported} from ${target.file}, but that local module does not export it. Patch the import and call sites to an actual current export; do not invent a second API name.`)
      }
    }
  }
  if (projectType === 'api' && /separate\s+(?:product\s+)?(?:source\s+)?module|integration mismatch[^.\n]{0,100}(?:module|server)/i.test(commanderGoal)) {
    const localImports = product.flatMap(source => [...source.text.matchAll(/(?:import[^'"\n]+from\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(match => ({ source, specifier: match[1] })))
    if (!localImports.length) defects.push('The Commander requires integration through the existing separate product module, but no product source imports a local module. Integrate the server with the actual exports from that module instead of duplicating its logic inline.')
  }
  if (projectType === 'web') {
    const documentSources = product.filter(source => /\.html$/i.test(source.file) && /<!doctype\s+html|<html\b/i.test(source.text))
    const styleSources = product.filter(source => /\.css$/i.test(source.file))
    const browserSources = product.filter(source => /\.[cm]?js$/i.test(source.file) && /\b(?:document|localStorage|window)\b/.test(source.text))
    if (!documentSources.length) defects.push('Web product source is missing a separate real HTML document. Create the application document as an .html source file; do not embed it in the server.')
    if (!styleSources.length) defects.push('Web product source is missing a separate real stylesheet. Create a .css source file and load it from the application document.')
    if (!browserSources.length) defects.push('Web product source is missing separate real browser JavaScript. Create a browser .js source file with the required UI behavior and load it from the application document.')
    const assertedDocumentIdentities = sources.filter(source => source.role === 'test').flatMap(source =>
      [...source.text.matchAll(/assert\.match\s*\(\s*[^,\n]+,\s*\/([^/\n\\]{3,})\/[gimsuy]*\s*\)/g)].map(match => match[1]),
    ).filter(identity => !/\d/.test(identity))
    const documentText = documentSources.map(source => source.text).join('\n')
    const missingIdentity = assertedDocumentIdentities.find(identity => !documentText.includes(identity))
    if (missingIdentity) defects.push(`The real application document does not contain the concrete product identity asserted by integration tests: ${missingIdentity}. Update the HTML title/heading to match the Commander product; do not rewrite the working server or weaken the assertion.`)
    if (product.some(source => /\.listen\s*\(\s*18765\b|(?:const|let|var)\s+port\s*=\s*18765\b/i.test(source.text))) {
      defects.push('Web product source hard-codes the preview port. Read process.env.PORT and let the owned runtime allocate a free loopback port dynamically.')
    }
    if (product.some(source => /\.listen\s*\(/.test(source.text)) && !product.some(source => /process\.env\.PORT/.test(source.text) && /127\.0\.0\.1/.test(source.text))) {
      defects.push('Web product source must read process.env.PORT and bind explicitly to 127.0.0.1 so the executor can own, restart, and release a dynamic local port.')
    }
    const serverSources = product.filter(source => /(?:createServer\s*\(|\.listen\s*\()/.test(source.text))
    const surfaceFilesAreBesideServer = [...documentSources, ...styleSources, ...browserSources].every(source => !source.file.includes('/'))
    if (surfaceFilesAreBesideServer && serverSources.some(source => /\bjoin\s*\(\s*sourceDir\s*,\s*['"]public['"]\s*\)/.test(source.text))) {
      defects.push("Web server source serves an invented public directory, but the actual HTML, CSS, and browser JavaScript files are beside the server entrypoint. Serve from sourceDir, or move every referenced asset into the real matching directory; routing must match the reviewed source layout.")
    }
    if (serverSources.some(source => /req\.url\.slice\(\s*1\s*\)/.test(source.text) && /(?:pathname|path)\s*===?\s*['"]\/health['"]/.test(source.text))) {
      defects.push("Web server source strips the request's leading slash and then compares the normalized value to '/health'. Handle req.url === '/health' before static-file normalization, then map '/' to 'index.html' and other static paths with req.url.slice(1).")
    }
    if (serverSources.some(source => /req\.url\s*===?\s*['"]\/['"]\s*\?\s*['"]\/[A-Za-z0-9_.-]+['"]/.test(source.text))) {
      defects.push("Web server source maps GET / to a static filename that still begins with '/'. Map it to 'index.html' without a leading slash before joining it to the source directory.")
    }
    if (serverSources.some(source => /\b(?:join|resolve)\s*\(\s*import\.meta\.url\b/.test(source.text))) {
      defects.push('Web server source treats import.meta.url as a filesystem path. Convert it with fileURLToPath(import.meta.url), derive the directory with dirname(), and join static file paths from that real directory so GET / can serve the document.')
    }
    if (serverSources.some(source => {
      const readIndex = source.text.search(/\breadFile|import\s*\(\s*['"]node:fs/)
      if (readIndex < 0) return false
      const beforeRead = source.text.slice(0, readIndex)
      const writeIndex = beforeRead.lastIndexOf('res.writeHead')
      if (writeIndex < 0 || /\breturn\s*;/.test(beforeRead.slice(writeIndex))) return false
      return /res\.writeHead\s*\(/.test(source.text.slice(readIndex, readIndex + 800))
    })) {
      defects.push('Web server source writes a success response before static-file I/O and then writes headers again after the read. Read the file first; write exactly one 200 response on success or one 404 response on failure so the process cannot crash with headers-already-sent.')
    }
    if (serverSources.some(source => /const\s+([A-Za-z_$][\w$]*)\s*=[^;]+;[\s\S]{0,1600}\b\1\s*=(?!=)/.test(source.text))) {
      defects.push('Web server source reassigns a const binding at runtime. Declare a reassigned local with let or compute the final value without reassignment before serving requests.')
    }
    if (serverSources.some(source => /<!doctype\s+html|<html\b/i.test(source.text))) {
      defects.push('The Node server embeds the application document. Keep server source limited to health, static-file routing, and graceful shutdown; put the real document, styles, and browser behavior in separate source files.')
    }
    if (browserSources.some(source => /(?:from\s+['"]node:|require\s*\(\s*['"]node:)/.test(source.text))) {
      defects.push('Browser JavaScript imports Node built-ins. Files executed by the page must use browser APIs only; keep node:fs, node:path, node:url, and other Node modules in the server or tests.')
    }
    const nodeOnlyGlobal = browserSources.find(source => /\bfs\.(?:readFile|writeFile|existsSync)|process\.env\b|\brequire\s*\(|\b__dirname\b|\b__filename\b/.test(source.text))
    if (nodeOnlyGlobal) {
      defects.push(`Browser JavaScript in ${nodeOnlyGlobal.file} references a Node-only global (fs, process.env, require, __dirname, or __filename) that does not exist when this file runs in a real browser page; the page will throw instead of working. PATCH only the one or two function bodies inside ${nodeOnlyGlobal.file} that reference that Node-only global, replacing them with localStorage.getItem/setItem exactly as other functions already in this same file already use. This is a small same-file fix, not an architecture change: do not add any server route, endpoint, or REST API for this, and do not touch the server entrypoint file at all; the page already had working browser storage for this before this regression. The browser's localStorage is a separate, persistent store owned by the browser itself; restarting or stopping the server process does not clear it and does not require any file-based or server-side storage to survive a restart, so that is never a valid reason to move this away from localStorage.`)
    }
    if (browserSources.length && !documentSources.some(source => /<script\b[^>]*\bsrc=['"][^'"]+\.js(?:[?'"#])/i.test(source.text))) {
      defects.push('Browser JavaScript exists but the application document does not load it. Reference the real browser source with a script src so UI behavior runs in the page.')
    }
    if (styleSources.length && !documentSources.some(source => /<link\b[^>]*\bhref=['"][^'"]+\.css(?:[?'"#])/i.test(source.text))) {
      defects.push('Application CSS exists but the application document does not load it. Reference the real stylesheet with a link href so the built UI is styled.')
    }
    const hasExternalAssets = product.some(source => /<(?:script|link)\b[^>]*(?:src|href)=['"][^'"]+\.(?:js|css)/i.test(source.text))
    if (hasExternalAssets && serverSources.length && !serverSources.some(source => /(?:text\/css|javascript|\.css|\.js)/i.test(source.text) && /req\.url|URL\s*\(/.test(source.text))) {
      defects.push('The page references external CSS or JavaScript, but the Node server does not route and serve those real assets with appropriate content types. Serve requested application files instead of returning index.html for every path.')
    }
    if (serverSources.some(source => /\blocalStorage\b/.test(source.text))) {
      defects.push('Web server source uses browser localStorage in the Node process. Keep persistence code in browser JavaScript served to the page; the Node server must only serve real files and health responses.')
    }
    if (serverSources.some(source => /\bserver\.(?:on|once)\s*\(\s*['"]SIGTERM['"]/.test(source.text))) {
      defects.push("Web server attaches SIGTERM to the HTTP server, but SIGTERM is a process signal. Register process.on('SIGTERM', ...) and call server.close(...) inside that handler.")
    }
    if (serverSources.some(source => /\.listen\s*\(/.test(source.text)) && !serverSources.some(source => /process\.(?:on|once)\s*\(\s*['"]SIGTERM['"]/.test(source.text) && /\.close\s*\(/.test(source.text))) {
      defects.push('Web server source does not implement graceful owned-process shutdown. Handle SIGTERM and close the listening server before exiting so restart and port-release receipts are trustworthy.')
    }
    return defects
  }
  if (projectType === 'api') {
    const serverSources = product.filter(source => /(?:createServer\s*\(|\.listen\s*\()/.test(source.text))
    if (serverSources.some(source => /from\s+['"]uuid['"]|require\s*\(\s*['"]uuid['"]\s*\)|\buuidv4\s*\(/.test(source.text))) defects.push("API server uses uuid/uuidv4 even though Node provides randomUUID. Import randomUUID from node:crypto and call randomUUID() so the empty-directory application has no undeclared external dependency; patch both the import and call instead of removing only the import.")
    if (!serverSources.some(source => /process\.env\.PORT/.test(source.text) && /127\.0\.0\.1/.test(source.text))) defects.push('API server must read process.env.PORT and bind explicitly to 127.0.0.1 for owned dynamic runtime execution.')
    if (!serverSources.some(source => /process\.(?:on|once)\s*\(\s*['"]SIGTERM['"]/.test(source.text) && /\.close\s*\(/.test(source.text))) defects.push("API server must register SIGTERM on process with process.on(\'SIGTERM\', ...) or process.once(\'SIGTERM\', ...), then close its listening server for graceful shutdown and port release. server.on(\'SIGTERM\', ...) is invalid because HTTP servers do not receive operating-system signals; replace that handler rather than adding more server signal handlers.")
    if (serverSources.some(source => /\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\b/.test(source.text)) && !serverSources.some(source => /process\.env\.(?:DATA_FILE|DATA_PATH|STORAGE_PATH)/.test(source.text))) defects.push('File-backed API persistence is fixed inside the source directory. Accept an explicit DATA_FILE, DATA_PATH, or STORAGE_PATH environment variable so tests and runtime can own a real isolated data file across restarts without mutating reviewed source.')
    return defects
  }
  if (projectType !== 'cli') return defects
  if (product.some(source => /(?:from\s+['"]node:child_process['"]|require\s*\(\s*['"]node:child_process['"]\s*\))/.test(source.text))) {
    defects.push('CLI product source imports child_process even though process execution is not a Commander requirement. Child processes belong in the acceptance tests, not the product.')
  }
  if (product.some(source => /(?:from\s+['"]node:os['"]|require\s*\(\s*['"]node:os['"]\s*\))/.test(source.text) && /\btmpdir\s*\(/.test(source.text))) {
    defects.push('CLI product source stores application data in a shared OS temporary path. Resolve persistence from the invocation working directory (or an explicit data-path configuration) so separate workspaces are isolated and restartable.')
  }
  if (product.some(source => /process\.argv\.slice\(\s*2\s*\)/.test(source.text) && /(?:const|let|var)\s+command\s*=\s*args\s*\[\s*1\s*\]/.test(source.text))) {
    defects.push('CLI argument indexing is shifted: after process.argv.slice(2), the command is args[0] and command arguments begin at args[1].')
  }
  if (product.some(source => /parseArgs\s*\(\s*process\.argv\s*\)/.test(source.text) && /(?:const|let|var)\s+command\s*=\s*args\s*\[\s*1\s*\]/.test(source.text))) {
    defects.push('CLI argument indexing is shifted: when parseArgs receives the full process.argv array, args[1] is the script path, the command is args[2], and command arguments begin at args[3].')
  }
  if (product.some(source => /console\.error\s*\(/.test(source.text) && !/process\.exit\s*\(\s*[1-9]/.test(source.text) && !/process\.exitCode\s*=\s*[1-9]/.test(source.text))) {
    defects.push('CLI product source calls console.error for usage errors, unknown commands, and failures, but never calls process.exit with a nonzero code or sets a nonzero process.exitCode anywhere in the file, so every error path still exits 0 like success. Add process.exit(1) (or set process.exitCode = 1 before returning) on every error path that currently only logs to stderr.')
  }
  if (product.some(source => /process\.argv\[\s*2\s*\]/.test(source.text) && /process\.argv\.slice\(\s*2\s*\)/.test(source.text) && /\.\.\.args\s*\)/.test(source.text))) {
    defects.push('CLI reads the command name from process.argv[2], but also builds the array it spreads into the command handler from process.argv.slice(2), which still starts with that same command name. Every handler therefore receives its real arguments shifted one position late (the first real argument lands where the command name should be). Build that argument array from process.argv.slice(3) instead, so it begins right after the command name.')
  }
  if (product.some(source => /\b(?:finish|complete|update|remove|delete|find|mark)[A-Za-z0-9_]*\s*\(\s*parseInt\s*\(/i.test(source.text))) {
    defects.push('CLI parses an identifier before the command handler can validate the raw user input. Pass the original argument to the handler, reject blank, non-integer, and partially numeric values there, then compare using the persisted identifier type so clear errors retain the submitted value.')
  }
  return defects
}

export async function reviewApplicationBuild(state: ApplicationBuildState, testsPassed: boolean, touchedFiles: string[]) {
  const snapshot = await applicationSourceSnapshot()
  if (state.sourceDigest !== snapshot.digest) {
    state.generation += 1
    state.sourceDigest = snapshot.digest
    state.phase6 = undefined
  }
  const testDefects = [...applicationTestDefects(snapshot.sources, state.contract.runtime, state.contract.projectType), ...applicationContractTestDefects(snapshot.sources, state.contract.projectType, state.contract.commanderGoal)]
  const sourceDefects = applicationSourceDefects(snapshot.sources, state.contract.projectType, state.contract.commanderGoal)
  const testsGreenNow = testsPassed && state.testedDigest === snapshot.digest && testDefects.length === 0
  const basis = acceptanceBasis({ request: state.contract.commanderGoal, acceptance: state.contract.acceptanceCriteria, contracts: [] })
  // Every directly generated product component is reviewed, including tests/configuration.
  const primaryFiles = snapshot.sources.map(s => s.file)
  const required = state.contract.runtimeRequirements.includes('restart')
  const currentEvidence = currentApplicationEvidence(state)
  const survived = currentEvidence.some(e => e.kind === 'restart')
  const persistence = { required, survived }
  const selfReview = runSelfReview({ missionId: state.contract.missionId, generation: state.generation, basis, sources: snapshot.sources, primaryFiles, touchedFiles, testsGreenNow, restartEvidence: persistence })
  const runtimeComplete = state.contract.acceptanceCriteria.every(c => currentEvidence.some(e => e.criteria.includes(c)))
  const independentVerdict = runIndependentVerification({ missionId: state.contract.missionId, generation: state.generation, basis, sources: snapshot.sources, primaryFiles, testsGreenNow, filesMeetCriteria: runtimeComplete })
  state.phase6 = phase6CompletionAllowed({ missionId: state.contract.missionId, generation: state.generation, selfReview, independentVerdict, disagreement: null, persistence })
  state.missing = [...sourceDefects, ...testDefects, ...applicationCompletionMissing(state, testsGreenNow)]
  return { state, selfReview, independentVerdict }
}
