'use strict';
const fs = require('node:fs');
const { httpDiagnostic, networkDiagnostic } = require('./persistence-diagnostics');

async function request(req, { url, key, fetcher = fetch }) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
    let endpoint, options;
    if (req.operation === 'load') {
        endpoint = '/rest/v1/timmy_state?select=revision,payload&storage_id=eq.' + encodeURIComponent(req.key);
        options = { headers };
    } else if (req.operation === 'commit') {
        endpoint = '/rest/v1/rpc/timmy_commit_state';
        options = { method: 'POST', headers, body: JSON.stringify({ p_id: req.key, p_expected: req.expected, p_payload: req.payload }) };
    } else return { ok: false, diagnostic: { kind: 'WORKER_FAILED' } };
    let response;
    try {
        response = await fetcher(url + endpoint, { ...options, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    } catch (error) { return { ok: false, diagnostic: networkDiagnostic(error) }; }
    if (!response.ok) {
        let body;
        // Only known codes and exact known SQL messages are used; never echo the body.
        try { body = await response.json(); } catch { body = null; }
        return { ok: false, diagnostic: httpDiagnostic(response.status, body) };
    }
    let data;
    try { data = await response.json(); }
    catch { return { ok: false, diagnostic: { kind: 'INVALID_RESPONSE' } }; }
    if (req.operation === 'load') {
        if (!Array.isArray(data) || data.length > 1) return { ok: false, diagnostic: { kind: 'INVALID_RESPONSE' } };
        return { ok: true, value: data[0] || null };
    }
    if (!Number.isSafeInteger(data) || data < 1) return { ok: false, diagnostic: { kind: 'INVALID_RESPONSE' } };
    return { ok: true, value: data };
}
async function main() {
    const req = JSON.parse(fs.readFileSync(0, 'utf8'));
    const result = await request(req, { url: process.env.TIMMY_SUPABASE_URL, key: process.env.TIMMY_SUPABASE_KEY });
    process.stdout.write(JSON.stringify(result));
}
if (require.main === module) main().catch(() => {
    process.stdout.write(JSON.stringify({ ok: false, diagnostic: { kind: 'WORKER_FAILED' } }));
    process.exitCode = 1;
});
module.exports = { request };
