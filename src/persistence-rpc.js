'use strict';
const fs = require('node:fs');
async function main() {
    const req = JSON.parse(fs.readFileSync(0, 'utf8'));
    const url = process.env.TIMMY_SUPABASE_URL;
    const key = process.env.TIMMY_SUPABASE_KEY;
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    // Legacy service_role JWT needs Authorization. New sb_secret keys use apikey.
    if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
    let endpoint, options;
    if (req.operation === 'load') {
        endpoint = '/rest/v1/timmy_state?select=revision,payload&storage_id=eq.' + encodeURIComponent(req.key);
        options = { headers };
    } else if (req.operation === 'commit') {
        endpoint = '/rest/v1/rpc/timmy_commit_state';
        options = { method: 'POST', headers, body: JSON.stringify({ p_id: req.key, p_expected: req.expected, p_payload: req.payload }) };
    } else throw new Error('Operación no válida');
    const response = await fetch(url + endpoint, { ...options, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Error de persistencia HTTP');
    const data = await response.json();
    if (req.operation === 'load') {
        if (!Array.isArray(data) || data.length > 1) throw new Error('Respuesta inválida');
        process.stdout.write(JSON.stringify(data[0] || null));
    } else process.stdout.write(JSON.stringify(data));
}
main().catch(() => { process.stderr.write('Error de persistencia remota\n'); process.exitCode = 1; });
