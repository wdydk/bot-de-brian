'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SocialCenter}=require('../src/social-center');const {VoiceMaster,config}=require('../src/voice-master');
test('social requests require recipient consent, stay scoped and divorce clears both',()=>{
 const data={},store={guild:g=>data[g]||={socialEnabled:true},patchGuild:(g,p)=>Object.assign(data[g],p)},s=new SocialCenter(store);
 const id=s.request('g','a','b','marry');assert.equal(s.pair('g','a'),null);assert.throws(()=>s.respond('g','c',id,true));assert.throws(()=>s.respond('other','b',id,true));
 s.respond('g','b',id,true);assert.equal(s.pair('g','a'),'b');assert.equal(s.pair('g','b'),'a');s.divorce('g','b');assert.equal(s.pair('g','a'),null);
});
test('voice configuration is disabled by default and cannot be edited by other admins',async()=>{
 assert.equal(config({}).enabled,false);const v=new VoiceMaster({guild:()=>({})});
 await assert.rejects(v.configure({ownerId:'owner'},{id:'other'},new URLSearchParams()));
 await assert.rejects(v.command({guild:{id:'g',members:{fetch:async()=>({id:'u',voice:{channelId:'unknown'}})}},user:{id:'u'}},['lock']));
});
