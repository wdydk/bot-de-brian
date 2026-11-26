'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {routeLocal,isMusicCandidateV2,safeProposal}=require('../src/ai-music-actions');
const {Assistant}=require('../src/ai');
test('exact screenshots and mixed Spanish-English controls never become songs',()=>{
    for(const [text,n] of [['volume 19',19],['ponme volume 10',10],['volume 10',10],['vol 0',0],['ponme volumen a 100%',100],['baja el volumen a treinta por ciento',30],['set volume to 55',55],['Puedes poner el volumen a diez por ciento?',10]]){
        assert.deepEqual(routeLocal(text),{command:'volume',args:[String(n)]},text);
        assert.equal(isMusicCandidateV2(text),true);
    }
    for(const input of ['volume 101','ponme volume -1','volume 1.5','volume','ponme volume abc'])assert.ok(routeLocal(input)?.clarify,input);
    assert.deepEqual(routeLocal('ponme KUCHUBURANKO\nPlastic Tree'),{command:'play',args:['KUCHUBURANKO Plastic Tree']});
    assert.deepEqual(routeLocal('ponla para escucharla','KUCHUBURANKO Plastic Tree'),{command:'play',args:['KUCHUBURANKO Plastic Tree']});
    assert.deepEqual(routeLocal('ponla para escucharla'),{missingRecent:true});
    assert.equal(isMusicCandidateV2('ponla para escucharla'),true);
    assert.equal(routeLocal('no cambies el volumen'),null);
    assert.equal(routeLocal('ponme scars\nvolume 10'),null);
    assert.ok(safeProposal({command:'play',args:['volume 10']}).clarify);
});
test('plain Gemini conversation cannot claim the screenshot volume change',async()=>{
    const ai=new Assistant({generate:async()=>({text:'Listo, volumen al 10.'})});
    assert.match(await ai.ask('g:c:u','u','volume 10'),/No ejecuté ningún cambio/);
});
