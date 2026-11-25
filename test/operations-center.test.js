'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Operations}=require('../src/operations-center');
const {AuditLogEvent}=require('discord.js');
test('audit counts unique destructive actions per actor and guild, alerts once without punishment',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-ops-'));let now=1000000;const cfg={operations:{enabled:true,threshold:2,channel:'x'}};
 const ops=new Operations({user:{id:'bot'}},{directory:dir,guild:()=>cfg},()=>now);t.after(async()=>{await ops.close();fs.rmSync(dir,{recursive:true,force:true});});
 const alerts=[];ops.alert=async(g,p,msg)=>alerts.push(msg);
 const g={id:'a',ownerId:'owner'},e=(id,actor='mod')=>({id,executorId:actor,action:AuditLogEvent.ChannelDelete,createdTimestamp:now});
 await ops.audit(e('1'),g);await ops.audit(e('1'),g);assert.equal(alerts.length,0);
 await ops.audit(e('2'),{...g,id:'b'});assert.equal(alerts.length,0);
 await ops.audit(e('3'),g);assert.equal(alerts.length,1);
 await ops.audit(e('4'),g);assert.equal(alerts.length,1);assert.equal(ops.summary('a').reports.length,1);
 cfg.staffPolicy={whitelist:['trusted']};await ops.audit(e('5','trusted'),g);await ops.audit(e('6','trusted'),g);assert.equal(alerts.length,1);
});
test('cancellation and report are scoped to guild',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-ops-'));const ops=new Operations({}, {directory:dir});t.after(async()=>{await ops.close();fs.rmSync(dir,{recursive:true,force:true});});
 ops.db().prepare('INSERT INTO announcements VALUES(?,?,?,?,?,?,?,?)').run('id','a','owner','channel','message','',0,'pending');
 assert.throws(()=>ops.cancel('b','id'));ops.cancel('a','id');assert.equal(ops.summary('a').announcements[0].state,'cancelled');
 ops.report('a','owner','mod','warning','Review');assert.equal(ops.summary('b').reports.length,0);
});
