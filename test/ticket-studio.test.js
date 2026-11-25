'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {optionsFromText,ticketSettings}=require('../src/ticket-studio');
test('ticket categories validate keys, labels, duplicate and button limits',()=>{
 assert.deepEqual(optionsFromText('soporte | Soporte | ¿Qué necesitas?','buttons'),[{key:'soporte',label:'Soporte',question:'¿Qué necesitas?'}]);
 assert.throws(()=>optionsFromText('a | A | Q\na | B | Q','select'));
 assert.throws(()=>optionsFromText(Array.from({length:6},(_,i)=>'a'+i+' | A | Q').join('\n'),'buttons'));
 assert.throws(()=>optionsFromText('a | '+ 'x'.repeat(46)+' | Q','select'));
 assert.equal(ticketSettings({ticketPanelMessage:'x'}).ticketPanelMessage,'x');
});
