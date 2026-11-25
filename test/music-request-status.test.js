'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {requestStatus} = require('../src/music');

test('reports a request as started only if its own track is current', () => {
    assert.equal(requestStatus({current:{track:{requestId:'a'}},queue:[]},'a'),'started');
    assert.equal(requestStatus({current:{track:{requestId:'b'}},queue:[]},'a'),'failed');
});
test('reports queued requests separately from failed starts', () => {
    assert.equal(requestStatus({current:{track:{requestId:'b'}},queue:[{requestId:'a'}]},'a'),'queued');
    assert.equal(requestStatus({current:null,queue:[]},'a'),'failed');
    assert.equal(requestStatus({destroyed:true,current:{track:{requestId:'a'}},queue:[]},'a'),'failed');
});
