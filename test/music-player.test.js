'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseControl,assertCurrentPanel,nextVolume,nextLoop,playerPayload}=require('../src/music-player');
const token='12345678-1234-1234-1234-123456789abc';
function session(){
    return {guildId:'g',volume:.65,loop:'off',queue:[{title:'Next'}],player:{state:{status:'playing'}},
        current:{token,track:{title:'Song',duration:123,requester:'123456789012345678',url:'https://www.youtube.com/watch?v=abcdefghijk'},panel:{id:'msg',channelId:'ch'}}};
}
test('accepts only supported control IDs and validates exact current panel',()=>{
    assert.deepEqual(parseControl('tm:music:'+token+':skip'),{token,action:'skip'});
    assert.throws(()=>parseControl('tm:music:'+token+':ban'));
    const s=session(), panel={token,messageId:'msg',channelId:'ch'};
    assert.doesNotThrow(()=>assertCurrentPanel(s,panel));
    assert.throws(()=>assertCurrentPanel(s,{...panel,token:'old'}));
    assert.throws(()=>assertCurrentPanel(s,{...panel,messageId:'other'}));
    assert.throws(()=>assertCurrentPanel(s,{...panel,channelId:'other'}));
    s.destroyed=true;assert.throws(()=>assertCurrentPanel(s,panel));
});
test('volume clamps to 0–100 and repeat modes cycle',()=>{
    assert.equal(nextVolume(.65,10),75);
    assert.equal(nextVolume(.65,-10),55);
    assert.equal(nextVolume(.95,10),100);
    assert.equal(nextVolume(.05,-10),0);
    assert.deepEqual(['off','song','queue'].map(nextLoop),['song','queue','off']);
});
test('player renders eight controls, swaps pause/resume and removes ended buttons',()=>{
    const s=session();
    const first=playerPayload(s,s.current);
    assert.equal(first.components.length,2);
    assert.equal(first.components.flatMap(r=>r.toJSON().components).length,8);
    assert.equal(first.components[0].toJSON().components[0].label,'Pause');
    assert.match(first.embeds[0].toJSON().fields.find(f=>f.name==='Volumen').value,/65%/);
    s.player.state.status='paused';s.volume=1;
    const paused=playerPayload(s,s.current);
    assert.equal(paused.components[0].toJSON().components[0].label,'Resume');
    assert.equal(paused.components[1].toJSON().components[1].disabled,true);
    assert.deepEqual(playerPayload(s,s.current,true).components,[]);
});

test('panel actions reuse DJ authorization and reject stale clicks under the session lock',async()=>{
    const {Music}=require('../src/music');
    const m=new Music({},{}), s=session(), ctx={guild:{id:'g'},channel:{id:'ch'},user:{id:'u'}};
    let edits=0, volume=0, checks=0;
    s.current.panel.edit=async()=>{edits++;};
    s.current.resource={volume:{setVolume:v=>{volume=v;}}};
    m.control=async()=>{checks++;return s;};
    const message={id:'msg'};
    await Promise.all([
        m.panelAction(ctx,'tm:music:'+token+':up',message),
        m.panelAction(ctx,'tm:music:'+token+':up',message)
    ]);
    assert.equal(s.volume,.85);assert.equal(volume,.85);assert.equal(edits,2);assert.equal(checks,2);
    await assert.rejects(m.panelAction(ctx,'tm:music:'+token+':down',{id:'old'}),/ya no está activo/);
    m.control=async()=>{throw Error('DJ denied');};
    await assert.rejects(m.panelAction(ctx,'tm:music:'+token+':stop',message),/DJ denied/);
    assert.equal(s.volume,.85);
});

test('retired player reports failure, skip and stop without active controls',()=>{
    const s=session();
    for(const [reason,label] of [['error','Error de reproducción'],['skip','Canción saltada'],['stop','Detenida']]){
        const payload=playerPayload(s,s.current,reason);
        assert.match(payload.embeds[0].toJSON().description,new RegExp(label));
        assert.deepEqual(payload.components,[]);
    }
});
