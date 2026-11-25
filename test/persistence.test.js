'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/core');
const { openStore } = require('../src/persistence');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timmy-persist-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const env = { TIMMY_STORAGE: 'supabase', TIMMY_SUPABASE_URL: 'https://example.supabase.co', TIMMY_SUPABASE_KEY: 'fake', TIMMY_STORAGE_ID: 'test' };
    let row = null, fail = false;
    const history = [];
    const rpc = (_settings, operation, args) => {
        if (fail) throw new Error('offline');
        if (operation === 'load') return structuredClone(row);
        if (args.expected !== (row?.revision || 0)) throw new Error('conflict');
        row = { revision: args.expected + 1, payload: structuredClone(args.payload) };
        history.push(structuredClone(row));
        return row.revision;
    };
    return { root, env, history, rpc, fail: () => { fail = true; }, row: () => row, erase: () => { row = null; } };
}
test('migration preserves guilds, tickets and settings after restart in a fresh directory', t => {
    const f = fixture(t);
    const initial = new Store(f.root);
    initial.patchGuild('A', { prefix: '!', supportRole: 'role', ticketPanelMessage: 'message', delegatedRoles: { mod: ['role'] }, custom: { hi: 'hello' } });
    initial.patchGuild('B', { prefix: '?' });
    initial.data.tickets.channel = { guildId: 'A', ownerId: 'member' };
    initial.save();
    const before = structuredClone(initial.data);
    const store = openStore(f.root, { env: { ...f.env, TIMMY_SUPABASE_BOOTSTRAP: 'import' }, rpc: f.rpc });
    assert.deepEqual(store.data, before);
    assert.ok(fs.readdirSync(f.root).some(n => n.includes('.pre-cloud-')));
    const setup = store.guild('A');
    setup.logChannel = 'logs'; store.save();
    store.patchGuild('A', { prefix: '$' }); // panel and setup share Store
    const current = f.row().revision;
    store.save();
    assert.equal(f.row().revision, current);
    const fresh = openStore(path.join(f.root, 'new'), { env: f.env, rpc: f.rpc });
    assert.deepEqual(fresh.data, store.data);
    assert.equal(fresh.guild('A').logChannel, 'logs');
    assert.equal(fresh.guild('A').prefix, '$');
    assert.equal(fresh.guild('B').prefix, '?');
    assert.equal(fresh.data.tickets.channel.ownerId, 'member');
    assert.deepEqual(f.history[0].payload, before);
});
test('no implicit empty bootstrap or local fallback', t => {
    const f = fixture(t);
    assert.throws(() => openStore(f.root, { env: f.env, rpc: f.rpc }), /Sin memoria remota/);
    assert.equal(fs.existsSync(path.join(f.root, 'timmy-v3.json')), false);
    assert.throws(() => openStore(f.root, { env: { TIMMY_STORAGE: 'supabase' }, rpc: f.rpc }), /Completa/);
    openStore(f.root, { env: { ...f.env, TIMMY_SUPABASE_BOOTSTRAP: 'empty' }, rpc: f.rpc });
    assert.throws(() => openStore(f.root, { env: {} }), /modo local/);
    f.erase();
    assert.throws(() => openStore(f.root, { env: { ...f.env, TIMMY_SUPABASE_BOOTSTRAP: 'empty' }, rpc: f.rpc }), /desapareció/);
});
test('conflicting writer and network failures never replace the committed snapshot', t => {
    const f = fixture(t);
    const first = openStore(f.root, { env: { ...f.env, TIMMY_SUPABASE_BOOTSTRAP: 'empty' }, rpc: f.rpc });
    const other = openStore(path.join(f.root, 'other'), { env: f.env, rpc: f.rpc });
    first.patchGuild('A', { prefix: '!' });
    assert.throws(() => other.patchGuild('A', { prefix: '?' }), /conflict/);
    assert.throws(() => other.save(), /bloqueada/);
    assert.equal(f.row().payload.guilds.A.prefix, '!');
    const disk = fs.readFileSync(first.file, 'utf8');
    f.fail();
    assert.throws(() => first.patchGuild('A', { prefix: '$' }), /offline/);
    assert.equal(fs.readFileSync(first.file, 'utf8'), disk);
    assert.equal(f.row().payload.guilds.A.prefix, '!');
});
test('divergent local data is not silently overwritten; local backup alone blocks reset', t => {
    const f = fixture(t);
    const cloud = openStore(f.root, { env: { ...f.env, TIMMY_SUPABASE_BOOTSTRAP: 'empty' }, rpc: f.rpc });
    cloud.patchGuild('A', { prefix: '!' });
    const old = new Store(path.join(f.root, 'old'));
    old.patchGuild('A', { prefix: '?' });
    const before = fs.readFileSync(old.file, 'utf8');
    assert.throws(() => openStore(old.directory, { env: f.env, rpc: f.rpc }), /difieren/);
    assert.equal(fs.readFileSync(old.file, 'utf8'), before);
    fs.unlinkSync(old.file);
    assert.throws(() => openStore(old.directory, { env: {} }), /Falta la memoria/);
});
