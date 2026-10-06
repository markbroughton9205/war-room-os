'use strict'
const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const net=require('node:net');const {once}=require('node:events');const {ownHttpDrain}=require('./ownedHttpDrain.cjs');
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port}
test('accepted request finishes, queued keep-alive polls are refused, server closes after accepted response writes finish',async()=>{
 let calls=0,completed=0;let release;const ready=new Promise(r=>release=r);
 const server=http.createServer((req,res)=>{calls++;release();setTimeout(()=>{completed++;res.end('accepted')},80)});const drain=ownHttpDrain(server);const port=await listen(server);
 const client=net.connect(port,'127.0.0.1');client.on('error',()=>{});let output='';client.on('data',b=>output+=b);await once(client,'connect');
 client.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');await ready;drain.begin();const close=new Promise(r=>server.close(r));
 client.write('GET /poll HTTP/1.1\r\nHost: localhost\r\n\r\n');await close;await new Promise(r=>setTimeout(r,20));
 assert.equal(calls,1);assert.equal(completed,1);assert.match(output,/accepted/);assert.match(output,/Connection: close/i);assert.equal(server.listening,false);assert.equal(drain.snapshot().activeResponses,0);client.end();
})
test('incomplete HTTP request closes while client retains its writable half', {timeout:2000}, async()=>{
 const server=http.createServer((req,res)=>res.end('ok'));const drain=ownHttpDrain(server);const port=await listen(server);const socketClosed=new Promise(r=>server.once('connection',socket=>socket.once('close',r)));const client=net.connect({port,host:'127.0.0.1',allowHalfOpen:true});client.resume();await once(client,'connect');client.write('GET / HTTP/1.1\r\nHost: localhost\r\n');await new Promise(r=>setTimeout(r,10));const ended=once(client,'end');drain.begin();await new Promise(r=>server.close(r));await ended;await socketClosed;assert.equal(server.listening,false);assert.equal(client.writableEnded,false);assert.equal(drain.snapshot().connections,0);client.end()
})
test('in-flight write completes before shutdown; unrelated listener stays healthy',async()=>{
 let written=false;let started;const requestStarted=new Promise(r=>started=r);const server=http.createServer((req,res)=>{started();setTimeout(()=>{written=true;res.end('saved')},40)});const drain=ownHttpDrain(server);const port=await listen(server);const unrelated=http.createServer((req,res)=>res.end('untouched'));const other=await listen(unrelated);
 try{const response=fetch('http://127.0.0.1:'+port,{method:'POST',body:'data'});await requestStarted;drain.begin();await new Promise(r=>server.close(r));assert.equal(await (await response).text(),'saved');assert.equal(written,true);assert.equal(await (await fetch('http://127.0.0.1:'+other)).text(),'untouched')}finally{await new Promise(r=>unrelated.close(r))}
})

test('accepted response fully flushes to a half-open peer before server exit', {timeout:4000}, async()=>{
 let release;const entered=new Promise(r=>release=r);let finishResponse;
 const body='saved-data-'.repeat(100000);
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':Buffer.byteLength(body)});res.write(body.slice(0,100));finishResponse=()=>res.end(body.slice(100));release()});
 const drain=ownHttpDrain(server);const port=await listen(server);
 const client=net.connect({port,host:'127.0.0.1',allowHalfOpen:true});let output='';client.on('data',b=>output+=b);const eof=once(client,'end');await once(client,'connect');
 client.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');await entered;drain.begin();let closed=false;const done=new Promise(r=>server.close(()=>{closed=true;r()}));
 await new Promise(r=>setTimeout(r,40));assert.equal(closed,false,'accepted response must finish first');finishResponse();await done;await eof;
 assert.equal(output.slice(output.indexOf('\r\n\r\n')+4),body);assert.equal(client.writableEnded,false);assert.equal(drain.snapshot().connections,0);client.end();
})
