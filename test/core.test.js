'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, duration, integer, tokenize, Serial, render } = require('../src/core');

test('persiste al reiniciar y separa servidores sin tocar el JSON antiguo', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-store-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'bot_memory.json'), '{"legacy":true}');
    const first = new Store(directory);
    first.guild('a').welcome = { channelId: '123', text: 'Hola' };
    first.warn('a', 'u', 'm', 'motivo');
    first.guild('b').prefix = '!'; first.save();
    const restarted = new Store(directory);
    assert.equal(restarted.guild('a').welcome.text, 'Hola');
    assert.equal(restarted.guild('b').welcome, null);
    assert.equal(restarted.guild('a').warnings.u.length, 1);
    assert.equal(fs.readFileSync(path.join(directory, 'bot_memory.json'), 'utf8'), '{"legacy":true}');
    assert.ok(fs.existsSync(first.file + '.bak'));
    assert.ok(!fs.existsSync(first.file + '.tmp'));
});
test('memoria corrupta no se borra ni se reinicializa', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-bad-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'timmy-v3.json'); fs.writeFileSync(file, 'broken');
    assert.throws(() => new Store(dir));
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
});
test('validación de duración, enteros y frases entre comillas', () => {
    assert.equal(duration('10m'), 600000);
    for (const input of ['0m', '-2m', '29d', 'Infinity', '1.5h']) assert.throws(() => duration(input));
    assert.equal(integer('0', 0, 100), 0);
    for (const input of ['1.5', '-1', '999', '10a']) assert.throws(() => integer(input, 0, 100));
    assert.deepEqual(tokenize('add "hola bro" 👋'), ['add', 'hola bro', '👋']);
    assert.equal(render('{user} {server}', { id: '42', user: { username: 'x' }, guild: { name: 'G', memberCount: 2 } }), '<@42> G');
});
test('cola serial conserva orden incluso si una operación falla y limpia claves', async () => {
    const serial = new Serial(), seen = [];
    const a = serial.run('g', async () => { await new Promise(r => setTimeout(r, 10)); seen.push(1); throw Error('expected'); });
    const b = serial.run('g', () => { seen.push(2); });
    await Promise.allSettled([a, b]);
    assert.deepEqual(seen, [1, 2]); assert.equal(serial.jobs.size, 0);
});

test('completa los campos de módulos v3 antiguos y conserva los ajustes al guardar', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-v3-'));
    t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
    const before = {prefix:'!', levels:{enabled:true, template:'mi anuncio'}, birthday:{enabled:false,hour:'08:30'},
        verification:{questions:['¿Cuál es tu nick?']}, staffPolicy:{mode:'audit',whitelist:['miembro']}, extra:'conservado'};
    fs.writeFileSync(path.join(directory,'timmy-v3.json'), JSON.stringify({version:3, guilds:{a:before}, tickets:{}}));
    const store = new Store(directory), cfg = store.guild('a');
    assert.equal(cfg.levels.revision, 0);
    assert.equal(cfg.birthday.timezone, 'UTC');
    assert.equal(cfg.verification.denyReason, true);
    assert.equal(cfg.staffPolicy.minutes, 10);
    cfg.levels.revision++;
    store.save();
    const after = new Store(directory).guild('a');
    assert.equal(after.levels.revision, 1);
    for (const [key,value] of Object.entries(before)) {
        if (typeof value === 'object') for (const field of Object.keys(value)) assert.deepEqual(after[key][field],value[field]);
        else assert.equal(after[key],value);
    }
});
