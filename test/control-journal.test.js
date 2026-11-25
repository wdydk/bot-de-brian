'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/core');
const {Journal,hash,snapshot,changedKeys}=require('../src/control-journal');
test('journal isolates guilds, aggregates messages and restores only selected settings',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-journal-'));const store=new Store(dir),j=new Journal(store);
 t.after(()=>{j.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.patchGuild('a',{custom:{hello:'hola'},bansEnabled:false});const id=j.backup('a','owner');
 store.patchGuild('a',{custom:{hello:'new'},bansEnabled:true});
 assert.throws(()=>j.read('b',id));assert.throws(()=>j.restore('a','owner',id,'stale',[]));
 j.restore('a','owner',id,hash(snapshot(store.guild('a'))),[]);
 assert.equal(store.guild('a').custom.hello,'hola');assert.equal(store.guild('a').bansEnabled,true);
 assert.equal(j.backups('a').length,2);
 j.metric('a','messages',20);j.metric('a','messages',21);j.metric('b','commands',1);
 assert.equal(j.metrics('a')[0].messages,2);assert.equal(j.metrics('a')[0].members,21);
 assert.equal(j.events('b').length,0);assert.deepEqual(changedKeys({x:1},{x:2}),['x']);
});
