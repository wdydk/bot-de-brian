'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Engagement,parse}=require('../src/engagement-center');
test('poll, application and event inputs are bounded',()=>{
 const f=new URLSearchParams({title:'Test',items:'A\nB'});
 assert.deepEqual(parse('poll',f).items,['A','B']);f.set('items','A\nA');assert.throws(()=>parse('poll',f));
 f.set('items','A');assert.equal(parse('application',f).items.length,1);assert.throws(()=>parse('event',f));
});
test('responses and decisions are scoped to a server, and restart preserves votes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'timmy-eng-'));let e=new Engagement({},{directory:dir});t.after(async()=>{await e.close();fs.rmSync(dir,{recursive:true,force:true});});
 const db=e.db();db.prepare('INSERT INTO panels(id,g,kind,channel,actor,data,state) VALUES(?,?,?,?,?,?,?)').run('id','a','application','channel','owner',JSON.stringify({items:['Question']}),'open');
 const user='123456789012345678';db.prepare('INSERT INTO responses(panel,user,value,at) VALUES(?,?,?,?)').run('id',user,'["answer"]',1);
 assert.throws(()=>e.review('b','id',user,'accepted'));e.review('a','id',user,'accepted');await e.close();e=new Engagement({},{directory:dir});assert.equal(e.responses('a','id')[0].status,'accepted');assert.throws(()=>e.responses('b','id'));
});
