'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { stopOwnedChild, installQuitBarrier } = require('./ownedProcessLifecycle.cjs')
const bootstrap = path.join(__dirname, 'uiProcessLifecycle.cjs')
const fixture = `
require(${JSON.stringify(bootstrap)}).installUiProcessLifecycle();
// Match Next's error logger; an unhandled broken stderr otherwise loops forever.
process.on('uncaughtException', e => console.error(e));
const server = require('node:http').createServer((req,res)=>res.end('ok'));
process.on('SIGTERM',()=>{
  console.error('UI graceful cleanup');
  server.close(()=>setTimeout(()=>process.exit(0), 80));
});
server.listen(0,'127.0.0.1',()=>process.send({ready:true, port:server.address().port}));
`
async function ui() {
  const child = spawn(process.execPath, ['-e',fixture], {stdio:['ignore','pipe','pipe','ipc']})
  child.stdout.resume(); child.stderr.resume()
  const [ready] = await once(child,'message')
  child.port = ready.port
  return child
}
async function free(port) {
  const server = require('node:net').createServer()
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  await new Promise(resolve=>server.close(resolve))
}
function appHarness(child) {
  const app = new EventEmitter(); app.exited=false; app.log=[]; app.stopCount=0
  app.quit = () => {
    let prevented=false
    app.emit('before-quit',{preventDefault(){prevented=true}})
    if (!prevented) { app.exited=true; child.stdout.destroy();child.stderr.destroy();app.emit('quit') }
  }
  installQuitBarrier(app,{stop:()=>{app.stopCount++;return stopOwnedChild(child)},closeWindows:()=>{},log:x=>app.log.push(x)})
  return app
}

test('normal quit waits for real UI exit and releases port; repeated restart cycles need no recovery', async()=>{
  for (let i=0;i<3;i++) {
    const child=await ui(); const app=appHarness(child)
    const exited=once(child,'exit'); const quit=once(app,'quit')
    app.quit(); app.quit()
    assert.equal(app.exited,false)
    await quit; await exited
    assert.equal(child.exitCode,0);assert.equal(child.signalCode,null)
    assert.equal(app.stopCount,1);assert.ok(app.log.includes('SHUTDOWN_CONFIRMED'))
    await free(child.port)
  }
})

test('only the owned UI is signaled; a sibling server remains running',async()=>{
  const child=await ui();const sibling=await ui()
  try {await stopOwnedChild(child);assert.equal(sibling.exitCode,null);assert.equal(sibling.signalCode,null);assert.equal((await fetch(`http://127.0.0.1:${sibling.port}`)).status,200)}
  finally {await stopOwnedChild(sibling)}
})

test('parent crash disconnect closes UI despite broken output pipes, permitting rollback start',async()=>{
  const child=await ui();const exited=once(child,'exit')
  child.stdout.destroy();child.stderr.destroy();child.disconnect()
  const [code,signal]=await exited;assert.equal(code,0);assert.equal(signal,null);await free(child.port)
  const rollback=await ui();await stopOwnedChild(rollback);await free(rollback.port)
})

test('failed startup leaves no owned child; existing rollback server is untouched',async()=>{
  const rollback=await ui()
  try {
    const failed=spawn('/nonexistent-war-room-test-executable',[],{stdio:'ignore'})
    await new Promise(resolve=>failed.once('error',resolve))
    await stopOwnedChild(failed)
    assert.equal((await fetch(`http://127.0.0.1:${rollback.port}`)).status,200)
  } finally {await stopOwnedChild(rollback)}
})

test('timeout refuses to quit or escalate, retains child for a later clean exit',async()=>{
  const child=await ui()
  const fakeApp=appHarness(child)
  // Shorter than the fixture's asynchronous cleanup, so timeout must fail honestly.
  await assert.rejects(stopOwnedChild(child,{timeoutMs:5}),/did not exit/)
  assert.equal(child.killed,true);assert.equal(child.exitCode,null)
  await stopOwnedChild(child)
  assert.equal(child.exitCode,0);assert.equal(fakeApp.exited,false)
})

test('quit barrier retains parent on rejected cleanup and allows a retry',async()=>{
  const app=new EventEmitter();let allow=false;let exited=false;let errors=0
  app.quit=()=>{let prevented=false;app.emit('before-quit',{preventDefault(){prevented=true}});if(!prevented)exited=true}
  installQuitBarrier(app,{stop:()=>allow?Promise.resolve():Promise.reject(new Error('timeout')),closeWindows(){},log(x){if(x.startsWith('SHUTDOWN_FAILED'))errors++}})
  app.quit();await new Promise(r=>setImmediate(r));assert.equal(exited,false);assert.equal(errors,1)
  allow=true;app.quit();await new Promise(r=>setImmediate(r));assert.equal(exited,true)
})


test('late child exit resumes the original quit after a recorded deadline failure, without another signal', async()=>{
 const child=await ui();const app=new EventEmitter();const events=[];let requests=0,signals=0;
 const kill=child.kill.bind(child);child.kill=signal=>{signals++;return kill(signal)};
 app.quit=()=>{requests++;let prevented=false;app.emit('before-quit',{preventDefault(){prevented=true}});if(!prevented){events.push('parent_exit');app.emit('quit')}};
 installQuitBarrier(app,{
  closeWindows(){events.push('windows_closed')},
  log:message=>events.push(message),
  stop:async()=>{
   await stopOwnedChild(child,{timeoutMs:10,onTimeout:error=>events.push('SHUTDOWN_FAILED '+error.message)});
   events.push('child_exit_observed');events.push('core_cleanup');
  },
 });
 const quit=once(app,'quit');app.quit();await quit;
 assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);assert.equal(signals,1);
 assert.equal(requests,2,'only initial quit and final confirmed app.quit');
 const deadline=events.findIndex(e=>e.startsWith('SHUTDOWN_FAILED'));
 assert.ok(deadline>=0,'late shutdown remains a failed deadline, never a clean-stop proof');
 assert.ok(deadline<events.indexOf('child_exit_observed'));
 assert.ok(events.indexOf('child_exit_observed')<events.indexOf('core_cleanup'));
 assert.ok(events.indexOf('core_cleanup')<events.indexOf('parent_exit'));
 await free(child.port);
})
