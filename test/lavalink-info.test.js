'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lavalinkInfo,formatLavalinkInfo}=require('../src/lavalink-info');
const env={LAVALINK_HOST:'lavalink.railway.internal',LAVALINK_PORT:'2333',LAVALINK_PASSWORD:'secret-test',LAVALINK_SECURE:'false'};
test('reports private v4 API info without exposing credentials',async()=>{
 const result=await lavalinkInfo({env,request:async(url,options)=>{
  assert.equal(url.href,'http://lavalink.railway.internal:2333/v4/info');
  assert.equal(options.headers.Authorization,env.LAVALINK_PASSWORD);
  assert.equal(options.redirect,'error');
  return Response.json({version:{semver:'4.2.2'},sourceManagers:['spotify','http'],plugins:[{name:'lavasrc-plugin',version:'4.8.3'}]});
 }});
 assert.equal(result.status,'ok');assert.match(formatLavalinkInfo(result),/lavasrc-plugin/);assert.doesNotMatch(formatLavalinkInfo(result),/secret-test/);
});
test('missing, invalid, unauthorized and unreachable configuration are safe',async()=>{
 assert.equal((await lavalinkInfo({env:{},request:()=>assert.fail()})).status,'missing');
 assert.equal((await lavalinkInfo({env:{...env,LAVALINK_HOST:'https://other/path'},request:()=>assert.fail()})).status,'config');
 assert.equal((await lavalinkInfo({env,request:async()=>new Response(null,{status:401})})).status,'auth');
 assert.equal((await lavalinkInfo({env,request:async()=>{throw Error('secret-test');}})).status,'network');
});
