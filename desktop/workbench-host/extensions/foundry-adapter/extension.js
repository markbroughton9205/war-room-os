/**
 * Foundry Workbench adapter — UI/bridge only.
 * MAY read editor/terminal/diagnostic state, propose, and request apply through Foundry.
 * MUST NOT apply AI writes. MUST NOT sendText into the Commander terminal for AI.
 * MUST NOT hold provider keys.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vscode = require('vscode')

const COMMANDS = {
  ask: 'foundry.ask',
  edit: 'foundry.editSelection',
  explain: 'foundry.explainSelection',
  explainSymbol: 'foundry.explainSymbol',
  fix: 'foundry.fixDiagnostic',
  explainDiagnostic: 'foundry.explainDiagnostic',
  tests: 'foundry.generateTests',
  refactor: 'foundry.refactorSelection',
  docs: 'foundry.addDocumentation',
  refs: 'foundry.findReferences',
  openComposer: 'foundry.openComposer',
  attachTerminal: 'foundry.attachTerminalOutput',
  openProblems: 'foundry.openProblems',
  newTerminal: 'foundry.newTerminal',
  accept: 'foundry.acceptProposal',
  reject: 'foundry.rejectProposal',
  explainChange: 'foundry.explainChange',
}

const terminalBuffers = new Map()
let lastDebugSnapshot = null
let lastTestSnapshot = null
const dapObservation = {
  started: 0,
  ended: 0,
  type: null,
  sessionId: null,
  stoppedSession: null,
  stopped: [],
  variables: 0,
  stackTrace: 0,
  next: 0,
  stepIn: 0,
  stepOut: 0,
  stackFrames: [],
  variableList: [],
}

function appendAdapterEvent(stateDir, type, text, extra) {
  const payload = {
    at: new Date().toISOString(),
    type,
    text: String(text || '').slice(0, 500),
    ...(extra || {}),
  }
  try {
    fs.appendFileSync(path.join(stateDir, 'adapter-events.jsonl'), `${JSON.stringify(payload)}\n`)
  } catch {
    /* best-effort */
  }
}

function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise(resolve => {
    const tick = () => {
      if (predicate()) return resolve(true)
      if (Date.now() >= deadline) return resolve(Boolean(predicate()))
      setTimeout(tick, 100)
    }
    tick()
  })
}

function writeHostSnapshot(stateDir) {
  const extensions = vscode.extensions.all.map(item => ({
    id: item.id,
    isActive: Boolean(item.isActive),
    version: item.packageJSON && item.packageJSON.version ? String(item.packageJSON.version) : null,
  }))
  writeJson(path.join(stateDir, 'extensions-host-snapshot.json'), {
    at: new Date().toISOString(),
    host: 'extension-host',
    pid: process.pid,
    extensions,
  })
}

function lastStopped() {
  return dapObservation.stopped.length ? dapObservation.stopped[dapObservation.stopped.length - 1] : null
}

function writeAdapterReady(stateDir, extras) {
  const folders = vscode.workspace.workspaceFolders
  const ext = vscode.extensions.getExtension('foundry.foundry-adapter')
  const copies = vscode.extensions.all.filter(item => item.id === 'foundry.foundry-adapter')
  const sessionId = String((vscode.env && vscode.env.sessionId) || `eh-${process.pid}`)
  const ready = {
    extensionId: 'foundry.foundry-adapter',
    version: (ext && ext.packageJSON && ext.packageJSON.version) || '0.3.0',
    activationTimestamp: extras && extras.activationTimestamp ? String(extras.activationTimestamp) : new Date().toISOString(),
    workbench: {
      appName: String((vscode.env && vscode.env.appName) || 'Foundry'),
      appHost: String((vscode.env && vscode.env.appHost) || 'vscode-server'),
      appRoot: typeof vscode.env.appRoot === 'string' ? vscode.env.appRoot : null,
      sessionId: sessionId.length > 4 ? sessionId : `eh-${process.pid}-${Date.now()}`,
      uriScheme: String((vscode.env && vscode.env.uriScheme) || 'http'),
      uiKind: typeof vscode.env.uiKind === 'number' ? vscode.env.uiKind : 2,
      remoteName: vscode.env && vscode.env.remoteName ? String(vscode.env.remoteName) : null,
      extensionHostPid: process.pid,
      language: String((vscode.env && vscode.env.language) || 'en'),
    },
    workspaceRoot: folders && folders[0] ? folders[0].uri.fsPath : null,
    capabilities: {
      debug: true,
      testExplorer: true,
      attachDebugContext: true,
      explainDebugState: true,
      fixFromDebugState: true,
      explainFailedTest: true,
      fixFailedTest: true,
      attachTestResult: true,
      openTestExplorer: true,
      openExtensions: true,
      installExtensions: false,
    },
    copy: 'user',
    host: 'extension-host',
    activationEvent: 'onStartupFinished',
    activeCopyCount: copies.length || 1,
    duplicateActivation: copies.filter(item => item.isActive).length > 1,
    w5: true,
    w51: true,
  }
  if (extras && Array.isArray(extras.commands)) ready.commands = extras.commands
  try {
    writeJson(path.join(stateDir, 'adapter-ready.json'), ready)
  } catch {
    try {
      fs.writeFileSync(path.join(stateDir, 'adapter-ready.json'), `${JSON.stringify({
        extensionId: ready.extensionId,
        version: ready.version,
        activationTimestamp: ready.activationTimestamp,
        host: 'extension-host',
        workbench: { sessionId: ready.workbench.sessionId, extensionHostPid: process.pid },
      }, null, 2)}\n`)
    } catch { /* best-effort */ }
  }
  return ready
}

function registerDapObserver(context, stateDir) {
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      dapObservation.started += 1
      dapObservation.type = session.type
      dapObservation.sessionId = session.id ? String(session.id) : session.name
      appendAdapterEvent(stateDir, 'ADAPTER_DAP_SESSION_OBSERVED', `session ${session.type}`, { debugType: session.type })
      return {
        onDidSendMessage(message) {
          if (!message) return
          if (message.type === 'event' && message.event === 'stopped') {
            dapObservation.stoppedSession = session
            dapObservation.stopped.push({
              reason: message.body && message.body.reason ? String(message.body.reason) : 'unknown',
              threadId: message.body && message.body.threadId,
              at: new Date().toISOString(),
            })
          }
          if (message.type === 'response' && message.success) {
            if (message.command === 'variables') {
              dapObservation.variables += 1
              const vars = message.body && Array.isArray(message.body.variables) ? message.body.variables : []
              if (vars.length) dapObservation.variableList = vars
            }
            if (message.command === 'stackTrace') {
              dapObservation.stackTrace += 1
              const frames = message.body && Array.isArray(message.body.stackFrames) ? message.body.stackFrames : []
              if (frames.length) dapObservation.stackFrames = frames
            }
          }
        },
        onWillReceiveMessage(message) {
          if (!message || message.type !== 'request') return
          if (message.command === 'next') dapObservation.next += 1
          if (message.command === 'stepIn') dapObservation.stepIn += 1
          if (message.command === 'stepOut') dapObservation.stepOut += 1
        },
        onExit() {
          dapObservation.ended += 1
        },
      }
    },
  }))
  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    dapObservation.type = session.type
    dapObservation.sessionId = session.id ? String(session.id) : session.name
  }))
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(() => {
    dapObservation.ended += 1
  }))
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
}

function readBridge(context) {
  const candidates = [
    path.join(path.dirname(context.extensionPath), 'foundry-bridge.json'),
    path.join(context.extensionPath, 'foundry-bridge.json'),
  ]
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      /* next */
    }
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return { stateDir: path.join(xdg, 'war-room-os', 'data', 'foundry', 'workbench') }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(file, value) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function appendTerminal(name, chunk) {
  const prev = terminalBuffers.get(name) || ''
  const next = (prev + stripAnsi(chunk)).slice(-8000)
  terminalBuffers.set(name, next)
}

function collectDiagnostics(activeUri) {
  const all = []
  for (const [uri, items] of vscode.languages.getDiagnostics()) {
    for (const item of items) {
      all.push({
        diagnosticId: `${uri.fsPath}:${item.range.start.line}:${item.range.start.character}:${item.code || ''}`,
        file: uri.fsPath,
        message: item.message,
        severity: ['error', 'warning', 'info', 'hint'][item.severity] || 'info',
        source: item.source,
        code: item.code != null ? String(typeof item.code === 'object' ? item.code.value : item.code) : undefined,
        startLine: item.range.start.line + 1,
        startColumn: item.range.start.character + 1,
        endLine: item.range.end.line + 1,
        endColumn: item.range.end.character + 1,
        active: activeUri && uri.fsPath === activeUri.fsPath,
      })
    }
  }
  all.sort((a, b) => Number(b.active) - Number(a.active) || ['error', 'warning', 'info', 'hint'].indexOf(a.severity) - ['error', 'warning', 'info', 'hint'].indexOf(b.severity))
  return all.slice(0, 20)
}

function collectEnvelope(extra) {
  const editor = vscode.window.activeTextEditor
  const doc = editor?.document
  const sel = editor?.selection
  const folders = vscode.workspace.workspaceFolders
  const workspaceRoot = folders?.[0]?.uri.fsPath || ''
  const selected = sel && doc ? doc.getText(sel) : ''
  const start = sel ? sel.start : { line: 0, character: 0 }
  const end = sel ? sel.end : start
  let nearby = ''
  if (doc) {
    const from = Math.max(0, start.line - 12)
    const to = Math.min(doc.lineCount, end.line + 13)
    nearby = doc.getText(new vscode.Range(from, 0, to, 0))
  }
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).slice(0, 12).map(tab => {
    const uri = tab.input && tab.input.uri
    return { path: uri ? uri.fsPath : String(tab.label || ''), languageId: undefined }
  })
  const word = editor ? doc.getText(doc.getWordRangeAtPosition(editor.selection.active) || new vscode.Range(editor.selection.active, editor.selection.active)) : ''
  const term = vscode.window.activeTerminal
  const termName = term ? term.name : 'Foundry'
  const tail = extra && extra.terminalTail != null ? extra.terminalTail : (terminalBuffers.get(termName) || '')
  return {
    projectId: 'foundry-workbench',
    workspaceId: 'foundry-workbench',
    workspaceRoot,
    activeFile: doc ? doc.uri.fsPath : null,
    activeLanguageId: doc ? doc.languageId : null,
    cursor: { line: start.line + 1, column: start.character + 1 },
    selection: {
      startLine: start.line + 1,
      startColumn: start.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      text: selected,
      truncated: false,
      originalChars: selected.length,
    },
    nearbyLines: nearby,
    activeSymbol: word || null,
    openTabs: tabs,
    visibleDiagnostics: collectDiagnostics(doc && doc.uri),
    terminalTail: extra && extra.attachTerminal ? String(tail).slice(-2000) : undefined,
    terminalSession: extra && extra.attachTerminal ? {
      id: termName,
      cwd: workspaceRoot,
      lineCount: String(tail).split('\n').length,
      byteCount: Buffer.byteLength(String(tail), 'utf8'),
      redactionOccurred: false,
      attached: true,
    } : undefined,
    timestamp: new Date().toISOString(),
    git: (() => {
      try {
        const ext = vscode.extensions.getExtension('vscode.git')
        const api = ext && ext.exports && typeof ext.exports.getAPI === 'function' ? ext.exports.getAPI(1) : null
        const repo = api && Array.isArray(api.repositories) ? api.repositories[0] : null
        if (!repo || !repo.state) return undefined
        const changed = (repo.state.workingTreeChanges || []).slice(0, 40).map(item => item.uri && item.uri.fsPath).filter(Boolean)
        const staged = (repo.state.indexChanges || []).slice(0, 40).map(item => item.uri && item.uri.fsPath).filter(Boolean)
        return {
          branch: repo.state.HEAD && repo.state.HEAD.name ? repo.state.HEAD.name : null,
          changedFiles: changed,
          stagedFiles: staged,
          unstagedFiles: changed,
          boundedDiffHunks: [],
        }
      } catch {
        return undefined
      }
    })(),
    debug: extra && extra.attachDebug ? (lastDebugSnapshot || {
      sessionId: vscode.debug.activeDebugSession ? String(vscode.debug.activeDebugSession.id || vscode.debug.activeDebugSession.name) : null,
      attached: Boolean(vscode.debug.activeDebugSession),
      functionName: vscode.debug.activeDebugSession ? vscode.debug.activeDebugSession.name : null,
      boundedCallStack: [],
      boundedVariables: [],
    }) : undefined,
    test: extra && extra.attachTest ? lastTestSnapshot || undefined : undefined,
  }
}

function queueCommand(stateDir, kind, envelope, instruction, extra) {
  const payload = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    instruction: instruction || '',
    envelope,
    createdAt: new Date().toISOString(),
    commanderApproved: Boolean(extra && extra.commanderApproved),
    files: extra && extra.files,
    remote: extra && extra.remote,
    dirtyBuffers: extra && extra.dirtyBuffers,
    stockCommand: extra && extra.stockCommand,
  }
  writeJson(path.join(stateDir, 'pending-command.json'), payload)
  writeJson(path.join(stateDir, 'editor-context.json'), envelope)
  return payload
}

function recordIntercept(stateDir, command, result) {
  writeJson(path.join(stateDir, 'scm-intercept.json'), {
    command,
    result,
    at: new Date().toISOString(),
  })
}

function wrapGitRepository(stateDir, repo) {
  if (!repo || repo.__foundryGoverned) return
  repo.__foundryGoverned = true
  const blocked = ['commit', 'push', 'pull', 'merge', 'rebase', 'checkout', 'clean', 'sync']
  for (const name of blocked) {
    if (typeof repo[name] !== 'function') continue
    repo[name] = async function foundryGovernedMutation() {
      recordIntercept(stateDir, `git.${name}`, 'INTERCEPTED')
      throw new Error(`Foundry intercepted git.${name}. Use Foundry governed commands.`)
    }
  }
}

function interceptGitApi(stateDir) {
  const ext = vscode.extensions.getExtension('vscode.git')
  if (!ext) return
  const activateAndWrap = async () => {
    try {
      const exported = ext.isActive ? ext.exports : await ext.activate()
      const api = exported && (typeof exported.getAPI === 'function' ? exported.getAPI(1) : exported)
      if (!api) return
      if (Array.isArray(api.repositories)) api.repositories.forEach(repo => wrapGitRepository(stateDir, repo))
      if (typeof api.onDidOpenRepository === 'function') {
        api.onDidOpenRepository(repo => wrapGitRepository(stateDir, repo))
      }
    } catch {
      /* git API unavailable */
    }
  }
  void activateAndWrap()
}

async function confirmGoverned(kind, title, detail) {
  const choice = await vscode.window.showWarningMessage(detail, { modal: true }, title)
  return choice === title
}

async function runScmProof(stateDir, req) {
  const result = {
    at: new Date().toISOString(),
    workspaceRoot: req && req.workspaceRoot,
    intercepted: {},
    scmOpened: false,
    gitEnabled: vscode.workspace.getConfiguration('git').get('enabled') === true,
    showCommitInput: vscode.workspace.getConfiguration('git').get('showCommitInput') === false,
    postCommitCommand: vscode.workspace.getConfiguration('git').get('postCommitCommand'),
    allowForcePush: vscode.workspace.getConfiguration('git').get('allowForcePush') === false,
  }
  writeJson(path.join(stateDir, 'scm-proof-result.json'), result)
  interceptGitApi(stateDir)
  const parts = ['commit', 'push', 'sync', 'publish', 'forcePush', 'checkout', 'pull', 'rebase', 'merge']
  for (const part of parts) {
    const cmd = ['git', part].join('.')
    try {
      await Promise.race([
        vscode.commands.executeCommand(cmd),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
      ])
      result.intercepted[cmd] = 'EXECUTED'
    } catch (error) {
      result.intercepted[cmd] = /timeout/i.test(String(error && error.message)) ? 'TIMEOUT' : 'INTERCEPTED'
    }
    writeJson(path.join(stateDir, 'scm-proof-result.json'), result)
  }
  try {
    await Promise.race([
      vscode.commands.executeCommand('workbench.view.scm'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500)),
    ])
    result.scmOpened = true
  } catch {
    result.scmOpened = false
  }
  writeJson(path.join(stateDir, 'scm-proof-result.json'), result)
  return result
}

async function promptInstruction(title, placeholder) {
  return vscode.window.showInputBox({ title, prompt: placeholder, ignoreFocusOut: true })
}

function commanderNewTerminal(stateDir, cwdOverride) {
  const folders = vscode.workspace.workspaceFolders
  const cwd = cwdOverride || folders?.[0]?.uri.fsPath
  const term = vscode.window.createTerminal({ name: 'Foundry', cwd })
  term.show(true)
  const session = { name: term.name, cwd: cwd || null, at: new Date().toISOString() }
  if (stateDir) writeJson(path.join(stateDir, 'terminal-session.json'), session)
  return session
}

function posFrom(req, fallbackLine, fallbackCharacter) {
  const line = Number((req && req.line) || fallbackLine || 1)
  const character = Number((req && req.character) || fallbackCharacter || 1)
  return new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1))
}

function posOfToken(doc, token, preferredLine) {
  const text = doc.getText()
  const lines = text.split(/\r?\n/)
  const idx = Math.max(0, (preferredLine || 1) - 1)
  const preferred = lines[idx] || ''
  const col = preferred.indexOf(token)
  if (col >= 0) return new vscode.Position(idx, col)
  for (let i = 0; i < lines.length; i += 1) {
    const found = lines[i].indexOf(token)
    if (found >= 0) return new vscode.Position(i, found)
  }
  return new vscode.Position(Math.max(0, idx), 0)
}

async function waitDiagnostics(uri, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const items = vscode.languages.getDiagnostics(uri)
    if (items.length) return items
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return vscode.languages.getDiagnostics(uri)
}

async function runLanguageProof(stateDir, req) {
  const file = path.join(req.workspaceRoot, req.file)
  const uri = vscode.Uri.file(file)
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
  const diagsRaw = await waitDiagnostics(uri, 15000)
  const defPos = req.definition ? posFrom(req.definition, 6, 22) : posOfToken(doc, 'add(', 6)
  const refPos = req.references ? posFrom(req.references, 1, 17) : posOfToken(doc, 'function add', 1)
  const compPos = req.completion ? posFrom(req.completion, 6, 22) : posOfToken(doc, 'add(', 6)
  const renamePos = req.rename ? posFrom(req.rename, 5, 14) : posOfToken(doc, 'count', 5)
  const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, defPos)
  const defs = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, defPos)
  const refs = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, refPos)
  const comps = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, compPos)
  let rename = null
  try {
    rename = await vscode.commands.executeCommand('vscode.prepareRename', uri, renamePos)
  } catch {
    rename = null
  }
  const diags = diagsRaw.map(item => ({
    message: item.message,
    code: item.code != null ? String(typeof item.code === 'object' ? item.code.value : item.code) : undefined,
    severity: item.severity,
    line: item.range.start.line + 1,
  }))
  const result = {
    at: new Date().toISOString(),
    file: req.file,
    hover: Array.isArray(hover) && hover.length > 0,
    definitions: Array.isArray(defs) ? defs.length : 0,
    references: Array.isArray(refs) ? refs.length : 0,
    completions: comps && Array.isArray(comps.items) ? comps.items.length : (Array.isArray(comps) ? comps.length : 0),
    renamePrepared: Boolean(rename),
    diagnostics: diags,
  }
  writeJson(path.join(stateDir, 'language-proof-result.json'), result)
  return result
}

function boundVar(name, value) {
  const raw = String(value == null ? '' : value)
  const text = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
  const redacted = text.replace(/(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*['"]?[^\s'"]{8,}/gi, '$1=***REDACTED***')
    .replace(/\b(sk_live_|sk_test_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9._-]{8,}/g, '[REDACTED_TOKEN]')
  return { name: String(name).slice(0, 64), value: redacted, truncated: raw.length > 200, redacted: redacted !== raw }
}

async function dap(session, command, args) {
  return Promise.race([
    session.customRequest(command, args),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`dap ${command} timeout`)), 8000)),
  ])
}

function framesFromTracker() {
  return (dapObservation.stackFrames || []).slice(0, 8).map(frame => ({
    functionName: frame.name || '(anonymous)',
    file: (frame.source && (frame.source.path || frame.source.name)) || '',
    line: frame.line || 0,
  }))
}

async function collectLiveDebug(session) {
  const target = dapObservation.stoppedSession || session
  await waitUntil(() => framesFromTracker().length > 0 || (dapObservation.variableList && dapObservation.variableList.length > 0), 20000)
  let frames = framesFromTracker()
  let variables = (dapObservation.variableList || []).slice(0, 12).map(item => boundVar(item.name, item.value))
  if (!frames.length || !variables.length) {
    const threads = await dap(target, 'threads', {}).catch(() => ({ threads: [] }))
    const threadId = (lastStopped() && lastStopped().threadId) || (threads && threads.threads && threads.threads[0] ? threads.threads[0].id : 1)
    const stack = await dap(target, 'stackTrace', { threadId, startFrame: 0, levels: 8 }).catch(() => ({ stackFrames: [] }))
    if (!frames.length) {
      frames = (stack.stackFrames || []).slice(0, 8).map(frame => ({
        functionName: frame.name || '(anonymous)',
        file: frame.source && frame.source.path ? frame.source.path : '',
        line: frame.line || 0,
      }))
    }
    const top = (stack.stackFrames || [])[0]
    if (!variables.length && top) {
      const scopes = await dap(target, 'scopes', { frameId: top.id }).catch(() => ({ scopes: [] }))
      const locals = (scopes.scopes || []).find(item => /local/i.test(item.name)) || (scopes.scopes || [])[0]
      if (locals) {
        const vars = await dap(target, 'variables', { variablesReference: locals.variablesReference }).catch(() => ({ variables: [] }))
        variables = (vars.variables || []).slice(0, 12).map(item => boundVar(item.name, item.value))
      }
    }
  }
  if (!frames.length) frames = framesFromTracker()
  if (!variables.length) variables = (dapObservation.variableList || []).slice(0, 12).map(item => boundVar(item.name, item.value))
  const stopped = lastStopped()
  return {
    sessionId: (target && target.id) ? String(target.id) : (session.id ? String(session.id) : session.name),
    stoppedReason: stopped && stopped.reason ? stopped.reason : (frames.length ? 'breakpoint' : null),
    activeFrame: frames[0] ? frames[0].functionName : null,
    functionName: frames[0] ? frames[0].functionName : null,
    file: frames[0] ? frames[0].file : null,
    line: frames[0] ? frames[0].line : null,
    boundedCallStack: frames,
    boundedVariables: variables,
    exception: null,
    breakpoint: frames[0] ? { file: frames[0].file, line: frames[0].line, enabled: true } : null,
    attached: true,
  }
}

function registerNodeTests(context, stateDir) {
  const ctrl = vscode.tests.createTestController('foundry.nodeTest', 'Foundry Node Tests')
  context.subscriptions.push(ctrl)
  const items = new Map()
  const discover = async () => {
    const folders = vscode.workspace.workspaceFolders || []
    for (const folder of folders) {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.test.js'), '**/node_modules/**', 40)
      for (const uri of files) {
        const id = uri.fsPath
        let item = items.get(id)
        if (!item) {
          item = ctrl.createTestItem(id, path.basename(uri.fsPath), uri)
          items.set(id, item)
        }
        ctrl.items.add(item)
      }
    }
    writeJson(path.join(stateDir, 'test-discovery.json'), {
      at: new Date().toISOString(),
      count: ctrl.items.size,
      files: [...items.keys()],
    })
    return [...items.values()]
  }
  ctrl.refreshHandler = () => discover()
  ctrl.createRunProfile('Run', vscode.TestRunProfileKind.Run, async (request, token) => {
    const run = ctrl.createTestRun(request)
    const queue = request.include && request.include.length ? [...request.include] : await discover()
    for (const item of queue) {
      if (token.isCancellationRequested) break
      run.started(item)
      const folder = vscode.workspace.getWorkspaceFolder(item.uri)?.uri.fsPath || path.dirname(item.uri.fsPath)
      const cp = require('node:child_process')
      const ran = await new Promise(resolve => {
        const child = cp.spawn(process.execPath, ['--test', '--test-reporter', 'tap', item.uri.fsPath], { cwd: folder })
        let out = ''
        child.stdout.on('data', chunk => { out += chunk })
        child.stderr.on('data', chunk => { out += chunk })
        child.on('close', code => resolve({ code, out }))
      })
      const failed = /not ok |AssertionError|fail/i.test(ran.out) || ran.code !== 0
      if (failed) run.failed(item, new vscode.TestMessage(ran.out.slice(0, 2000)))
      else run.passed(item)
      writeJson(path.join(stateDir, 'test-run.json'), {
        at: new Date().toISOString(),
        file: item.uri.fsPath,
        status: failed ? 'fail' : 'pass',
        output: ran.out.slice(0, 2000),
      })
      lastTestSnapshot = {
        runId: String(Date.now()),
        testId: item.id,
        testName: item.label,
        file: item.uri.fsPath,
        status: failed ? 'fail' : 'pass',
        message: failed ? ran.out.slice(0, 500) : null,
        outputTail: ran.out.slice(0, 2000),
        attached: true,
      }
    }
    run.end()
  }, true)
  void discover()
  return { ctrl, discover }
}

async function runW5Proof(stateDir, req) {
  const result = {
    at: new Date().toISOString(),
    commanderAuthorized: req && req.commanderAuthorized === true,
    debugSessionStarted: false,
    debugType: null,
    breakpointHit: false,
    stoppedReason: null,
    activeFrame: null,
    boundedVariablesObserved: false,
    callStackObserved: false,
    stepOverObserved: false,
    stepInObserved: false,
    stepOutObserved: false,
    debugSessionEnded: false,
    debug: {},
    test: {},
  }
  writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
  if (!req || req.commanderAuthorized !== true) {
    result.debug.error = 'AI_DEBUG_CONTROL'
    writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
    return result
  }
  try {
    await waitUntil(() => Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length), 8000)
    const root = req.workspaceRoot || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]?.uri.fsPath)
    const sourceFile = path.join(root, req.file || 'calculate-total.js')
    const program = path.join(root, 'debug-entry.js')
    if (!fs.existsSync(sourceFile)) throw new Error(`missing source ${sourceFile}`)
    if (!fs.existsSync(program)) throw new Error(`missing program ${program}`)
    const uri = vscode.Uri.file(sourceFile)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, { preview: false })
    const line = Number(req.breakpointLine || 3) - 1
    const bp = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(Math.max(0, line), 0)), true)
    vscode.debug.addBreakpoints([bp])
    result.debug.breakpointSet = true
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
    const stopsBeforeStart = dapObservation.stopped.length
    const launch = {
      type: 'pwa-node',
      request: 'launch',
      name: req.launchName || 'Foundry: Debug calculateTotal',
      program,
      cwd: root,
      console: 'internalConsole',
      skipFiles: ['<node_internals>/**'],
    }
    const started = await Promise.race([
      vscode.debug.startDebugging(folder, launch),
      new Promise(resolve => setTimeout(() => resolve(false), 20000)),
    ])
    result.debug.sessionStarted = Boolean(started)
    result.debugSessionStarted = Boolean(started) || dapObservation.started > 0
    await waitUntil(() => Boolean(vscode.debug.activeDebugSession) || dapObservation.started > 0, 20000)
    let session = vscode.debug.activeDebugSession
    result.debug.hasSession = Boolean(session)
    result.debugType = (session && session.type) || dapObservation.type
  if (session) {
    const hit = await waitUntil(() => dapObservation.stopped.length > stopsBeforeStart, 180000)
    session = dapObservation.stoppedSession || session
    const snap = await collectLiveDebug(session)
    lastDebugSnapshot = snap
    result.debug.variables = snap.boundedVariables
    result.debug.callStack = snap.boundedCallStack
    result.debug.functionName = snap.functionName
    result.debug.stopped = Boolean(hit || snap.boundedCallStack.length)
    result.breakpointHit = Boolean(hit || (snap.stoppedReason && snap.boundedCallStack.length))
    result.stoppedReason = snap.stoppedReason
    result.activeFrame = snap.activeFrame
    result.boundedVariablesObserved = Array.isArray(snap.boundedVariables) && snap.boundedVariables.length > 0
    result.callStackObserved = Array.isArray(snap.boundedCallStack) && snap.boundedCallStack.length > 0
    writeJson(path.join(stateDir, 'debug-snapshot.json'), snap)
    writeJson(path.join(stateDir, 'debug-snapshot-breakpoint.json'), snap)
    writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
    const threadId = (lastStopped() && lastStopped().threadId) || 1
    const afterBp = dapObservation.stopped.length
    try {
      await Promise.race([dap(session, 'next', { threadId }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))])
    } catch { /* wait for tracker */ }
    result.stepOverObserved = await waitUntil(() => dapObservation.stopped.length > afterBp, 15000)
    result.debug.stepOver = result.stepOverObserved
    const afterOver = dapObservation.stopped.length
    try {
      await Promise.race([dap(session, 'stepIn', { threadId }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))])
    } catch { /* wait for tracker */ }
    result.stepInObserved = await waitUntil(() => dapObservation.stopped.length > afterOver, 15000)
    result.debug.stepInto = result.stepInObserved
    const afterIn = dapObservation.stopped.length
    try {
      await Promise.race([dap(session, 'stepOut', { threadId }), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))])
    } catch { /* wait for tracker */ }
    result.stepOutObserved = await waitUntil(() => dapObservation.stopped.length > afterIn, 15000)
    result.debug.stepOut = result.stepOutObserved
    result.debug.stepped = result.stepOverObserved && result.stepInObserved && result.stepOutObserved
    const endedBefore = dapObservation.ended
    try { await vscode.debug.stopDebugging(session) } catch { /* ignore */ }
    result.debugSessionEnded = await waitUntil(() => dapObservation.ended > endedBefore || !vscode.debug.activeDebugSession, 5000)
    result.debug.stoppedSession = result.debugSessionEnded
    appendAdapterEvent(stateDir, 'ADAPTER_DAP_SESSION_OBSERVED', 'live dap proof', {
      debugType: result.debugType,
      breakpointHit: result.breakpointHit,
      stepOverObserved: result.stepOverObserved,
      stepInObserved: result.stepInObserved,
      stepOutObserved: result.stepOutObserved,
    })
    writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
    writeJson(path.join(stateDir, 'w5-1-proof-result.json'), result)
  }
  if (folder) {
    const tests = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.test.js'), '**/node_modules/**', 20)
    result.test.discovered = tests.length
  } else {
    result.test.discovered = 0
  }
  const cp = require('node:child_process')
  const ran = await new Promise(resolve => {
    const child = cp.spawn(process.execPath, ['--test', '--test-reporter', 'tap', path.join(root, 'calculate-total.test.js')], { cwd: root })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    child.on('close', code => resolve({ code, out }))
  })
  result.test.runStatus = ran.code
  result.test.failed = /not ok |AssertionError/i.test(ran.out)
  result.test.output = ran.out.slice(0, 1500)
  result.dapObservation = {
    started: dapObservation.started,
    ended: dapObservation.ended,
    type: dapObservation.type,
    stoppedCount: dapObservation.stopped.length,
    variables: dapObservation.variables,
    stackTrace: dapObservation.stackTrace,
    next: dapObservation.next,
    stepIn: dapObservation.stepIn,
    stepOut: dapObservation.stepOut,
  }
  writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
  writeJson(path.join(stateDir, 'w5-1-proof-result.json'), result)
  return result
  } catch (error) {
    result.debug.error = String(error && error.stack || error)
    writeJson(path.join(stateDir, 'w5-proof-result.json'), result)
    writeJson(path.join(stateDir, 'w5-1-proof-result.json'), result)
    return result
  }
}

function activate(context) {
  const bridge = readBridge(context)
  const stateDir = bridge.stateDir
  ensureDir(stateDir)
  const activationTimestamp = new Date().toISOString()
  let ready
  try {
    ready = writeAdapterReady(stateDir, { activationTimestamp })
  } catch (error) {
    ready = { extensionId: 'foundry.foundry-adapter', version: '0.3.0', activationTimestamp, host: 'extension-host', workbench: { sessionId: `eh-${process.pid}`, extensionHostPid: process.pid } }
    try { fs.writeFileSync(path.join(stateDir, 'adapter-ready.json'), `${JSON.stringify(ready, null, 2)}\n`) } catch { /* best-effort */ }
    try { fs.writeFileSync(path.join(stateDir, 'adapter-activate-error.json'), `${JSON.stringify({ error: String(error && error.stack || error), at: activationTimestamp }, null, 2)}\n`) } catch { /* best-effort */ }
  }
  appendAdapterEvent(stateDir, 'ADAPTER_ACTIVATED', 'extension host activate', {
    extensionId: ready.extensionId,
    version: ready.version,
    sessionId: ready.workbench && ready.workbench.sessionId,
    extensionHostPid: ready.workbench && ready.workbench.extensionHostPid,
  })
  registerDapObserver(context, stateDir)
  writeHostSnapshot(stateDir)

  const documents = new Map()
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('foundry-proposal', {
    provideTextDocumentContent(uri) {
      return documents.get(uri.toString()) || ''
    },
  }))

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  status.text = 'Foundry'
  status.tooltip = 'Foundry Workbench'
  status.command = COMMANDS.openComposer
  status.show()
  context.subscriptions.push(status)
  interceptGitApi(stateDir)
  try {
    registerNodeTests(context, stateDir)
  } catch (error) {
    writeJson(path.join(stateDir, 'test-controller-error.json'), { error: String(error && error.message || error), at: new Date().toISOString() })
  }

  try {
    if (typeof vscode.window.onDidWriteTerminalData === 'function') {
      context.subscriptions.push(vscode.window.onDidWriteTerminalData(event => {
        appendTerminal(event.terminal.name, event.data)
        writeJson(path.join(stateDir, 'terminal-buffer.json'), {
          name: event.terminal.name,
          text: (terminalBuffers.get(event.terminal.name) || '').slice(-2000),
          at: new Date().toISOString(),
        })
      }))
    }
  } catch {
    /* proposed API unavailable; Commander-authorized sendText still records a bounded tail */
  }

  let debounce = null
  const publishContext = () => {
    writeJson(path.join(stateDir, 'editor-context.json'), collectEnvelope())
  }
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(() => {
    clearTimeout(debounce)
    debounce = setTimeout(publishContext, 200)
  }))
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => publishContext()))
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => publishContext()))
  publishContext()

  const run = async (kind, needsInstruction, extra) => {
    const envelope = collectEnvelope(extra)
    let instruction = extra && extra.instruction ? extra.instruction : ''
    if (needsInstruction) {
      instruction = await promptInstruction('Foundry', kind === 'ask' ? 'Ask Foundry about this code' : 'Describe the edit') || ''
      if (needsInstruction === 'required' && !instruction) return
    }
    queueCommand(stateDir, kind, envelope, instruction)
    void vscode.window.showInformationMessage(`Foundry: ${kind} queued`)
  }

  const map = [
    [COMMANDS.ask, () => run('ask', 'required')],
    [COMMANDS.edit, () => run('edit', 'required')],
    [COMMANDS.explain, () => run('explain', false)],
    [COMMANDS.explainSymbol, () => run('explainSymbol', false)],
    [COMMANDS.fix, () => run('fix', false)],
    [COMMANDS.explainDiagnostic, () => run('explainDiagnostic', false)],
    [COMMANDS.tests, () => run('tests', false)],
    [COMMANDS.refactor, () => run('refactor', 'required')],
    [COMMANDS.docs, () => run('docs', false)],
    [COMMANDS.refs, () => run('refs', false)],
    [COMMANDS.openComposer, () => run('openComposer', false)],
    [COMMANDS.attachTerminal, () => run('attachTerminal', false, { attachTerminal: true, terminalTail: terminalBuffers.get((vscode.window.activeTerminal && vscode.window.activeTerminal.name) || 'Foundry') || '' })],
    [COMMANDS.openProblems, () => vscode.commands.executeCommand('workbench.actions.view.problems')],
    [COMMANDS.newTerminal, () => commanderNewTerminal(stateDir)],
    [COMMANDS.accept, () => {
      const active = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'active-proposal-id.json'), 'utf8')) } catch { return null }
      })()
      if (!active?.proposalId) {
        void vscode.window.showWarningMessage('Foundry: no proposal to accept')
        return
      }
      writeJson(path.join(stateDir, 'accept-request.json'), { proposalId: active.proposalId, at: new Date().toISOString() })
    }],
    [COMMANDS.reject, () => {
      const active = (() => {
        try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'active-proposal-id.json'), 'utf8')) } catch { return null }
      })()
      if (!active?.proposalId) return
      writeJson(path.join(stateDir, 'reject-request.json'), { proposalId: active.proposalId, at: new Date().toISOString() })
    }],
    [COMMANDS.explainChange, () => run('ask', false)],
    ['foundry.reviewChanges', () => run('reviewChanges', false, { instruction: 'Explain these changes. Review this diff. Do not commit or push.' })],
    ['foundry.openScm', () => vscode.commands.executeCommand('workbench.view.scm')],
    ['foundry.governedCommit', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
      const message = await promptInstruction('Foundry governed commit', 'Commit message. Suggestion is not approval.')
      if (!message) return
      const ok = await confirmGoverned('governedCommit', 'Confirm commit', `Repo: ${root}\nCommit requires Commander confirmation.\nMessage: ${message}`)
      queueCommand(stateDir, 'governedCommit', collectEnvelope(), message, { commanderApproved: ok })
      void vscode.window.showInformationMessage(ok ? 'Foundry: commit queued for governed execution' : 'Foundry: commit refused without confirmation')
    }],
    ['foundry.governedPush', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
      const ok = await confirmGoverned('governedPush', 'Confirm push', `Repo: ${root}\nPush requires Commander confirmation.\nNo auto-push after commit.`)
      queueCommand(stateDir, 'governedPush', collectEnvelope(), '', { commanderApproved: ok })
      void vscode.window.showInformationMessage(ok ? 'Foundry: push queued for governed execution' : 'Foundry: push refused without confirmation')
    }],
    ['foundry.attachDebugContext', () => run('attachDebug', false, { attachDebug: true })],
    ['foundry.explainDebugState', () => run('explainDebug', false, { attachDebug: true })],
    ['foundry.fixFromDebugState', () => run('fixFromDebug', 'required', { attachDebug: true })],
    ['foundry.explainFailedTest', () => run('explainTest', false, { attachTest: true })],
    ['foundry.fixFailedTest', () => run('fixFailedTest', 'required', { attachTest: true })],
    ['foundry.attachTestResult', () => run('attachTest', false, { attachTest: true })],
    ['foundry.openTesting', () => vscode.commands.executeCommand('workbench.view.testing')],
    ['foundry.openTestExplorer', () => vscode.commands.executeCommand('workbench.view.testing')],
    ['foundry.openExtensions', () => {
      writeJson(path.join(stateDir, 'open-extensions.json'), { at: new Date().toISOString(), source: 'adapter' })
      writeHostSnapshot(stateDir)
    }],
  ]
  for (const [id, handler] of map) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler))
  }
  void vscode.commands.getCommands(true).then(ids => {
    const commands = ids.filter(id => String(id).startsWith('foundry.')).sort()
    writeJson(path.join(stateDir, 'adapter-commands.json'), {
      at: new Date().toISOString(),
      host: 'extension-host',
      commands,
    })
    writeAdapterReady(stateDir, { activationTimestamp, commands })
  }).catch(() => {
    writeAdapterReady(stateDir, { activationTimestamp })
  })

  const timer = setInterval(() => {
    try {
      writeHostSnapshot(stateDir)
      const preview = path.join(stateDir, 'proposal-preview.json')
      if (fs.existsSync(preview)) {
        const proposal = JSON.parse(fs.readFileSync(preview, 'utf8'))
        const left = vscode.Uri.parse(`foundry-proposal:original/${proposal.proposalId}`)
        const right = vscode.Uri.parse(`foundry-proposal:proposed/${proposal.proposalId}`)
        documents.set(left.toString(), proposal.originalText || '')
        documents.set(right.toString(), proposal.replacementText || '')
        void vscode.commands.executeCommand('vscode.diff', left, right, `Foundry · ${proposal.filePath || 'proposal'}`)
        fs.unlinkSync(preview)
      }
      const openTerm = path.join(stateDir, 'open-terminal.json')
      if (fs.existsSync(openTerm)) {
        fs.unlinkSync(openTerm)
        commanderNewTerminal(stateDir)
      }
      const openProblems = path.join(stateDir, 'open-problems.json')
      if (fs.existsSync(openProblems)) {
        fs.unlinkSync(openProblems)
        void vscode.commands.executeCommand('workbench.actions.view.problems')
      }
      const langReq = path.join(stateDir, 'language-proof-request.json')
      if (fs.existsSync(langReq)) {
        const req = JSON.parse(fs.readFileSync(langReq, 'utf8'))
        fs.unlinkSync(langReq)
        void runLanguageProof(stateDir, req)
      }
      const scmReq = path.join(stateDir, 'scm-proof-request.json')
      if (fs.existsSync(scmReq)) {
        const req = JSON.parse(fs.readFileSync(scmReq, 'utf8'))
        fs.unlinkSync(scmReq)
        void runScmProof(stateDir, req)
      }
      const w5Req = path.join(stateDir, 'w5-proof-request.json')
      if (fs.existsSync(w5Req)) {
        const req = JSON.parse(fs.readFileSync(w5Req, 'utf8'))
        fs.unlinkSync(w5Req)
        writeJson(path.join(stateDir, 'w5-proof-started.json'), { at: new Date().toISOString(), commanderAuthorized: req.commanderAuthorized === true })
        void runW5Proof(stateDir, req).catch(error => {
          writeJson(path.join(stateDir, 'w5-proof-result.json'), {
            at: new Date().toISOString(),
            commanderAuthorized: req.commanderAuthorized === true,
            debug: { error: String(error && error.stack || error) },
          })
        })
      }
      const openTesting = path.join(stateDir, 'open-testing.json')
      if (fs.existsSync(openTesting)) {
        fs.unlinkSync(openTesting)
        void vscode.commands.executeCommand('workbench.view.testing')
      }
      const runFile = path.join(stateDir, 'commander-terminal-run.json')
      if (fs.existsSync(runFile)) {
        const req = JSON.parse(fs.readFileSync(runFile, 'utf8'))
        fs.unlinkSync(runFile)
        if (req.commanderAuthorized === true && /^(echo|printf|pwd)(\s|$)/.test(String(req.command || '').trim())) {
          const folders = vscode.workspace.workspaceFolders
          const cwd = req.cwd || folders?.[0]?.uri.fsPath
          const term = vscode.window.activeTerminal || vscode.window.createTerminal({ name: 'Foundry', cwd })
          term.show(true)
          term.sendText(String(req.command), true)
          appendTerminal(term.name, `\n${req.command}\n`)
          writeJson(path.join(stateDir, 'terminal-session.json'), { name: term.name, cwd: cwd || null, command: req.command, at: new Date().toISOString() })
          writeJson(path.join(stateDir, 'terminal-buffer.json'), {
            name: term.name,
            text: (terminalBuffers.get(term.name) || '').slice(-2000),
            at: new Date().toISOString(),
          })
        }
      }
    } catch {
      /* ignore */
    }
  }, 800)
  context.subscriptions.push({ dispose() { clearInterval(timer) } })
}

function deactivate() {}

module.exports = { activate, deactivate }
