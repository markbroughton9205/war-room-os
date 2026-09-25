/**
 * W1–W6 workbench user policy: Foundry branding.
 * W6: governed extensions. Auto-update stays off. OpenVSX is not default-on.
 * W5: native Debug UI + Test Explorer. js-debug builtin only.
 * W3: Commander integrated terminal enabled.
 * W4: Git UI enabled for status/diff/stage; mutation commands unbound and
 * intercepted. Stock commit/push/sync/publish/force stay ungated-impossible.
 * OpenVSX/Marketplace remain off.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SETTINGS = {
  'window.title': '${dirty}${activeEditorShort}${separator}${rootName}${separator}Foundry Workbench',
  'window.titleSeparator': ' - ',
  'telemetry.telemetryLevel': 'off',
  'git.enabled': true,
  'git.allowForcePush': false,
  'git.autofetch': false,
  'git.autoStash': false,
  'git.confirmSync': true,
  'git.postCommitCommand': 'none',
  'git.rebaseWhenSync': false,
  'git.enableSmartCommit': false,
  'git.showCommitInput': false,
  'git.terminalAuthentication': false,
  'git.fetchOnPull': false,
  'git.autoRepositoryDetection': true,
  'git.openRepositoryInParentFolders': 'never',
  'git.ignoredRepositories': ['nested'],
  'git.detectSubmodules': false,
  'git.allowNoVerifyCommit': false,
  'git.closeDiffOnOperation': false,
  'scm.alwaysShowProviders': true,
  'scm.defaultViewMode': 'list',
  'scm.diffDecorations': 'all',
  'terminal.integrated.enablePersistentSessions': false,
  'terminal.integrated.hideOnStartup': 'never',
  'terminal.integrated.enableFileLinks': true,
  'terminal.integrated.defaultLocation': 'view',
  'terminal.integrated.cwd': '${workspaceFolder}',
  'terminal.integrated.inheritEnv': true,
  'javascript.validate.enable': true,
  'typescript.validate.enable': true,
  'typescript.check.npmIsInstalled': false,
  'problems.showCurrentInStatus': true,
  'chat.enabled': false,
  'chat.disableAIFeatures': true,
  'github.copilot.enable': { '*': false },
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'workbench.enableExperiments': false,
  'workbench.startupEditor': 'none',
  'files.autoSave': 'off',
  'security.workspace.trust.enabled': false,
  'debug.openDebug': 'openOnDebugBreak',
  'debug.toolBarLocation': 'docked',
  'debug.console.closeOnEnd': true,
  'debug.javascript.autoAttachFilter': 'disabled',
  'debug.allowBreakpointsEverywhere': true,
  'testing.automaticallyOpenPeekView': 'never',
  'testing.automaticallyOpenTestResults': 'neverOpen',
  'testing.followRunningTest': false,
  'testing.openTesting': 'neverOpen',
  'testing.saveBeforeTestRun': 'never',
  'update.mode': 'none',
}

const KEYBINDINGS = [
  { key: 'ctrl+`', command: 'workbench.action.terminal.toggleTerminal' },
  { key: 'ctrl+shift+`', command: 'workbench.action.terminal.new' },
  { key: 'ctrl+shift+g', command: 'workbench.view.scm' },
  { key: 'ctrl+enter', command: '-git.commit' },
  { key: 'ctrl+enter', command: 'foundry.governedCommit', when: 'gitOpenRepositoryCount != 0' },
  { key: 'ctrl+shift+enter', command: '-git.commitAll' },
  { key: 'ctrl+shift+p', command: '-git.publish' },
  { key: 'ctrl+shift+u', command: '-git.pushTo' },
  { command: '-git.push' },
  { command: '-git.pull' },
  { command: '-git.pullFrom' },
  { command: '-git.sync' },
  { command: '-git.syncRebase' },
  { command: '-git.publish' },
  { command: '-git.forcePush' },
  { command: '-git.rebase' },
  { command: '-git.merge' },
  { command: '-git.checkout' },
  { command: '-git.checkoutDetached' },
  { command: '-git.deleteBranch' },
  { command: '-git.clean' },
  { command: '-git.cleanAll' },
  { command: '-git.undoCommit' },
  { command: '-git.commit' },
  { command: '-git.commitAll' },
  { command: '-git.commitStaged' },
  { command: '-git.commitEmpty' },
  { command: '-git.commitAmend' },
  { command: '-git.commitSigned' },
]

const DISABLED_EXTENSIONS = []

function writePolicy(userDataDir) {
  const userDir = path.join(userDataDir, 'User')
  fs.mkdirSync(userDir, { recursive: true })
  fs.writeFileSync(path.join(userDir, 'settings.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`)
  fs.writeFileSync(path.join(userDir, 'keybindings.json'), `${JSON.stringify(KEYBINDINGS, null, 2)}\n`)
  return { settings: path.join(userDir, 'settings.json'), keybindings: path.join(userDir, 'keybindings.json') }
}

function disableExtensionArgs() {
  return DISABLED_EXTENSIONS.flatMap(id => ['--disable-extension', id])
}

module.exports = { SETTINGS, KEYBINDINGS, DISABLED_EXTENSIONS, writePolicy, disableExtensionArgs }
