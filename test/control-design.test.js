'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {design,validateDesign,simulateCustom}=require('../src/dashboard-design');
test('design validates fixed presets and restricts banner origin',()=>{
 assert.equal(design({}).revision,0);
 assert.equal(validateDesign({accent:'ocean',theme:'dark',banner:'https://cdn.discordapp.com/icons/123/abc.png'}).accent,'ocean');
 for(const banner of ['javascript:alert(1)','https://evil.example/a.png','https://cdn.discordapp.com.evil.example/a.png'])assert.throws(()=>validateDesign({accent:'ocean',theme:'auto',banner}));
 assert.throws(()=>validateDesign({accent:'x',theme:'dark'}));
});
test('preview is pure text and never performs a timeout',()=>{
 assert.match(simulateCustom({name:'obliterar',type:'timeout',minutes:10}).result,/Ninguna sanción aplicada/);
 assert.deepEqual(simulateCustom({name:'hola',type:'text',text:'hola'}),{command:'>hola',result:'hola'});
});
