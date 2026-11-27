'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Assistant}=require('../src/ai');
const {ExpiringCache}=require('../src/core');
const {isMusicCandidate,localMusicIntent,validateCall,MusicApprovals}=require('../src/ai-music-actions');
const call=args=>({functionCalls:[{name:'music_action',args}]});
test('Gemini music proposals are opt-in for plausible requests and validate strict arguments',()=>{
    for(const s of ['Ponme scars de Novulent','Deja el volumen en treinta por ciento','Mezcla las canciones pendientes','Repite esta canción','Enséñame qué está sonando'])assert.equal(isMusicCandidate(s),true,s);
    for(const s of ['hola','no pongas música','cómo funciona la música','crea un canal','si te digo pon esa música'])assert.equal(isMusicCandidate(s),false,s);
    assert.deepEqual(validateCall(call({action:'volume',volume:30})),{command:'volume',args:['30']});
    assert.deepEqual(validateCall(call({action:'play_recent'}),'Luna Cielo'),{command:'play',args:['Luna Cielo']});
    assert.deepEqual(validateCall(call({action:'play_recent'})),{missingRecent:true});
    assert.deepEqual(validateCall(call({action:'loop',loop:'song'})),{command:'loop',args:['song']});
    for(const a of [{action:'ban'},{action:'volume',volume:101},{action:'volume',volume:'30'},{action:'volume',volume:1.5},{action:'play',query:'local:secret'},{action:'pause',query:'extra'},{action:'loop',loop:'invalid'}])assert.equal(validateCall(call(a)),null);
    assert.equal(validateCall({functionCalls:[{name:'ban',args:{}}]}),null);
    assert.equal(validateCall({functionCalls:[...call({action:'skip'}).functionCalls,...call({action:'stop'}).functionCalls]}),null);
});
test('one-time confirmations are bound to original guild, channel and user',()=>{
    const cache=new ExpiringCache(120000,10), approvals=new MusicApprovals(cache);
    const ctx={guild:{id:'g'},channel:{id:'c'},user:{id:'u'}};
    const token=approvals.create(ctx,{command:'volume',args:['30']});
    for(const dimension of ['guild','channel','user'])assert.throws(()=>approvals.take({...ctx,[dimension]:{id:'other'}},token));
    assert.deepEqual(approvals.take(ctx,token),{command:'volume',args:['30']});
    assert.throws(()=>approvals.take(ctx,token));
    const second=approvals.create(ctx,{command:'skip',args:[]});assert.equal(approvals.take(ctx,second,true),null);
    assert.throws(()=>approvals.take(ctx,second));
});
test('native function calling only proposes; normal conversation keeps tools disabled',async()=>{
    const requests=[];
    const ai=new Assistant({generate:async req=>{requests.push(req);return req.config.tools?call({action:'volume',volume:30}):{text:'Hola'};}});
    assert.deepEqual(await ai.proposeMusic('u','Deja el volumen en treinta por ciento'),{command:'volume',args:['30']});
    assert.equal(requests[0].config.tools[0].functionDeclarations[0].name,'music_action');
    assert.equal(requests[0].config.automaticFunctionCalling.disable,true);
    assert.equal(ai.active,0);
    await ai.ask('g:c:v','v','hola');
    assert.equal(requests[1].config.tools,undefined);
    assert.equal(await ai.proposeMusic('other','hola'),null);
    assert.equal(requests.length,2);
});

test('common requests work without a Gemini response',()=>{
    const samples=[
        ['Ponme scars de Novulent','play',['scars de Novulent']],
        ['Deja el volumen en treinta por ciento','volume',['30']],
        ['Puedes poner el volumen a diez por ciento','volume',['10']],
        ['Ajusta el volumen a veinticinco%','volume',['25']],
        ['Mezcla las canciones pendientes','shuffle',[]],
        ['Repite esta canción','loop',['song']],
        ['Enséñame qué está sonando','nowplaying',[]],
        ['Pausa la música','pause',[]],
        ['Continúa la música','resume',[]]
    ];
    for(const [text,command,args] of samples)assert.deepEqual(localMusicIntent(text),{command,args},text);
    for(const text of ['No pongas música','Ponme un ejemplo','Cambia el volumen a 150','Ponme local:secret','Ponme scars y baja el volumen','hola'])assert.equal(localMusicIntent(text),null,text);
});
test('raw Gemini parts are supported and explicit abstention never executes',()=>{
    assert.deepEqual(validateCall({candidates:[{content:{parts:[{functionCall:{name:'music_action',args:{action:'volume',volume:10}}}]}}]}),{command:'volume',args:['10']});
    assert.deepEqual(validateCall(call({action:'no_action'})),{conversational:true});
    assert.equal(validateCall(call({action:'no_action',query:'extra'})),null);
});
