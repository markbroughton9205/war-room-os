'use strict'

// Keep the ChildProcess handle and its log pipes until the OS reports exit.
// `killed` means a signal was sent; it does NOT mean the child has exited.
function stopOwnedChild(child, { timeoutMs = 10000, onTimeout } = {}) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve()
  if (!child.pid) return Promise.resolve() // spawn failed; no process to signal
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      error ? reject(error) : resolve()
    }
    const onExit = () => finish()
    const onError = error => finish(error)
    const timer = setTimeout(() => {
      const error = new Error(`Owned child ${child.pid} did not exit within ${timeoutMs}ms`)
      if (!onTimeout) return finish(error)
      // Record the failed deadline, but keep observing this same child. A late
      // exit must resume core cleanup; it must not strand a windowless parent.
      // No second signal, longer acceptance window, or forced exit is introduced.
      try { onTimeout(error) } catch (callbackError) { finish(callbackError) }
    }, timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
    // Signal only this explicit child, never a shared process group or port owner.
    try { child.kill('SIGTERM') } catch (error) { finish(error) }
  })
}

function installQuitBarrier(app, { stop, closeWindows, log = () => {} }) {
  let stopping = null
  let finished = false
  app.on('before-quit', event => {
    if (finished) return
    event.preventDefault()
    if (stopping) return
    log('BEFORE_QUIT_WAIT')
    // Close renderer connections before asking Next to drain HTTP requests.
    closeWindows()
    stopping = Promise.resolve().then(stop).then(() => {
      finished = true
      log('SHUTDOWN_CONFIRMED')
      app.quit()
    }, error => {
      // Do not orphan a live child or turn a timeout into a successful quit.
      log(`SHUTDOWN_FAILED ${error.stack || error}`)
      stopping = null
    })
  })
}
module.exports = { stopOwnedChild, installQuitBarrier }
