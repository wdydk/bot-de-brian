'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { Store } = require('./core');
const { describe, validateSettings } = require('./persistence-diagnostics');

function valid(payload) {
    const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (!object(payload) || payload.version !== 3 || !object(payload.guilds) || !object(payload.tickets)
        || Object.values(payload.guilds).some(x => !object(x))
        || Object.values(payload.tickets).some(x => !object(x))) {
        throw new Error('Memoria v3 inválida; conserva el archivo y sus backups.');
    }
    return payload;
}
function read(file) { return valid(JSON.parse(fs.readFileSync(file, 'utf8'))); }
function atomic(file, data) {
    const tmp = file + '.tmp-' + randomUUID();
    try {
        const fd = fs.openSync(tmp, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function archive(file) {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.pre-cloud-' + randomUUID(), fs.constants.COPYFILE_EXCL);
}
function rpcCall(settings, operation, args = {}) {
    // Store.save() is synchronous throughout Timmy. Wait for a durable acknowledgement
    // before reporting success; use a bounded child process for the HTTP operation.
    const child = spawnSync(process.execPath, [path.join(__dirname, 'persistence-rpc.js')], {
        input: JSON.stringify({ operation, key: settings.id, ...args }),
        env: { ...process.env, TIMMY_SUPABASE_URL: settings.url, TIMMY_SUPABASE_KEY: settings.key },
        encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024, windowsHide: true
    });
    if (child.error || child.status !== 0) {
        const kind = child.error?.code === 'ETIMEDOUT' ? 'WORKER_TIMEOUT' : child.error?.code === 'ENOBUFS' ? 'WORKER_BUFFER' : 'WORKER_FAILED';
        throw new Error(describe(operation, { kind }));
    }
    let result;
    try { result = JSON.parse(child.stdout); }
    catch { throw new Error(describe(operation, { kind: 'INVALID_RESPONSE' })); }
    if (result?.ok !== true) throw new Error(describe(operation, result?.diagnostic));
    if (!Object.hasOwn(result,'value')) throw new Error(describe(operation, { kind: 'INVALID_RESPONSE' }));
    return result.value;
}
function openStore(directory, { env = process.env, rpc = rpcCall, onFailure = () => {} } = {}) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'timmy-v3.json');
    const marker = file + '.remote';
    const url = env.TIMMY_SUPABASE_URL, key = env.TIMMY_SUPABASE_KEY, id = env.TIMMY_STORAGE_ID;
    const mode = env.TIMMY_STORAGE || 'local';
    if (mode !== 'local' && mode !== 'supabase') throw new Error('TIMMY_STORAGE debe ser local o supabase.');
    if (mode === 'local') {
        if (fs.existsSync(marker) || url || key || id) throw new Error('Persistencia cloud configurada; no se permite arrancar en modo local accidentalmente.');
        if (!fs.existsSync(file) && fs.existsSync(file + '.bak')) throw new Error('Falta la memoria principal; restaura una copia válida antes de iniciar.');
        return new Store(directory);
    }
    const settings = validateSettings(url, key, id);
    const identity = { url: settings.url, id };
    const marked = fs.existsSync(marker);
    if (marked && !isDeepStrictEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), identity)) throw new Error('El almacenamiento remoto cambió; revisa la migración manualmente.');
    const local = fs.existsSync(file) ? read(file) : null;
    if (!local && !marked && fs.existsSync(file + '.bak')) throw new Error('Existe una copia local sin memoria principal. Restáurala antes de migrar.');
    const call = (operation, args) => rpc(settings, operation, args);
    let row = call('load');
    if (row === null) {
        if (marked) throw new Error('La memoria remota desapareció; restaura un backup, no inicialices de nuevo.');
        const bootstrap = env.TIMMY_SUPABASE_BOOTSTRAP;
        const hasData = local && (Object.keys(local.guilds).length || Object.keys(local.tickets).length);
        if (bootstrap !== 'import' || !hasData) {
            if (bootstrap !== 'empty' || hasData || fs.existsSync(file + '.bak')) throw new Error('Sin memoria remota: importa un JSON existente con bootstrap=import o autoriza explícitamente una instalación nueva con bootstrap=empty.');
        }
        const payload = local || { version: 3, guilds: {}, tickets: {} };
        archive(file); archive(file + '.bak');
        const revision = call('commit', { expected: 0, payload });
        if (revision !== 1) throw new Error('No se pudo confirmar la primera revisión.');
        row = { revision, payload };
    }
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Revisión remota inválida.');
    const remote = valid(row.payload);
    if (!marked && local && !isDeepStrictEqual(local, remote)) throw new Error('La memoria local y remota difieren. Conserva ambas y reconcilia manualmente; no se sobrescribió ninguna.');
    if (!marked || (local && !isDeepStrictEqual(local, remote))) {
        archive(file); archive(file + '.bak');
    }
    atomic(marker, identity);
    if (!local || !isDeepStrictEqual(local, remote)) atomic(file, remote);
    const store = new Store(directory);
    const localSave = store.save.bind(store);
    let revision = row.revision;
    let committed = structuredClone(remote);
    let poisoned = false;
    store.save = function () {
        if (poisoned) throw new Error('Persistencia bloqueada; reinicia tras verificar la memoria remota.');
        try {
            const payload = valid(this.data);
            if (isDeepStrictEqual(committed, payload)) return;
            const next = call('commit', { expected: revision, payload });
            if (next !== revision + 1) throw new Error('No se confirmó la revisión esperada.');
            revision = next;
            committed = structuredClone(payload);
            localSave();
        } catch (error) {
            // Existing commands sometimes mutate objects directly. Do not continue
            // serving potentially uncommitted state or retry a write of unknown outcome.
            poisoned = true;
            onFailure(error);
            throw error;
        }
    };
    store.backend = 'supabase';
    return store;
}
module.exports = { openStore };
