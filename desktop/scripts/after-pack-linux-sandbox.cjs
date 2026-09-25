/**
 * electron-builder afterPack: record + attempt SUID helper on packaged chrome-sandbox.
 * Does not fail the pack if privileged chown is unavailable. Never stores credentials.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const prepare = require('../workbench-host/prepare-linux-chrome-sandbox.cjs')

module.exports = async function afterPackLinuxSandbox(context) {
  if (context.electronPlatformName !== 'linux') return
  const helper = path.join(context.appOutDir, 'chrome-sandbox')
  const result = fs.existsSync(helper)
    ? prepare.applyHelper(helper)
    : { ok: false, inspect: prepare.inspectHelper(helper), error: 'packaged chrome-sandbox missing' }
  fs.writeFileSync(path.join(context.appOutDir, 'LINUX_CHROME_SANDBOX.json'), `${JSON.stringify({
    at: new Date().toISOString(),
    helper,
    ...result,
  }, null, 2)}\n`)
}
