'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MusicSafety,sourced,typed,errorSource}=require('../src/music-safety');
const {Music}=require('../src/music');
const {MusicCatalog}=require('../src/music-catalog');
const {RemoteLookupGate}=require('../src/music-lookup-gate');
test('shared rate limit does not extend the same restriction and preserves source',()=>{
    let now=0;const s=new MusicSafety(()=>now),error=sourced(typed('RATE_LIMIT'),'YTDLP_METADATA');
    s.observeRestriction(error);now=5000;s.record('g',error);
    assert.equal(s.snapshot('g').cooldownSeconds,895);
    assert.equal(s.snapshot('g').lastSource,'YTDLP_METADATA');
    assert.equal(s.snapshot('other').globalSource,'YTDLP_METADATA');
    assert.throws(()=>s.check(),e=>e.musicSource==='YTDLP_METADATA');
    assert.equal(errorSource({musicSource:'secret URL'}),null);
    now=900001;s.check();
});
test('remote gate records the restriction before another queued lookup can start',async()=>{
    const m=new Music({},{});let now=0,calls=0;
    m.safety=new MusicSafety(()=>now);
    m.lookupGate=new RemoteLookupGate({clock:()=>now,wait:async ms=>{now+=ms;}});
    const first=m.remoteLookup(async()=>{calls++;throw sourced(typed('RATE_LIMIT'),'YTDLP_METADATA');});
    const second=m.remoteLookup(async()=>{calls++;return true;});
    await Promise.all([assert.rejects(first,/429/),assert.rejects(second,/pausa temporal/)]);
    assert.equal(calls,1);
    assert.equal(m.safety.snapshot('g').globalSource,'YTDLP_METADATA');
    assert.equal(m.safety.snapshot('g').cooldownSeconds,900);
});
test('official API failure is distinguished from extractor and does not expose key or response',async()=>{
    const c=new MusicCatalog({}, {YOUTUBE_API_KEY:'secret-key'},async()=>({ok:false,status:429}));
    await assert.rejects(c.video('505'),e=>e.musicSource==='YOUTUBE_DATA_API'&&e.musicCode==='RATE_LIMIT'&&!e.message.includes('secret-key'));
});
