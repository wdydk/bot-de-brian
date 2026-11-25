'use strict';

// Diagnostics are a closed vocabulary. Never print raw responses, URLs, JWTs,
// exception messages, request bodies, or the child's stderr.
const CODES = new Set(['PGRST000','PGRST001','PGRST002','PGRST003','PGRST106','PGRST125','PGRST202','PGRST204','PGRST205','PGRST301','PGRST302','PGRST303','42501','42P01','42883','23505','40001','40P01','P0001','57014']);
const NETWORK = Object.freeze({
    ENOTFOUND: 'DNS: no se encontró el dominio del proyecto.',
    EAI_AGAIN: 'DNS temporalmente no disponible.',
    ECONNREFUSED: 'La conexión fue rechazada.',
    ECONNRESET: 'La conexión fue interrumpida.',
    EHOSTUNREACH: 'No hay ruta al servidor.',
    ENETUNREACH: 'Red no disponible.',
    ETIMEDOUT: 'Tiempo de conexión agotado.',
    UND_ERR_CONNECT_TIMEOUT: 'Tiempo de conexión agotado.',
    UND_ERR_HEADERS_TIMEOUT: 'Tiempo de espera de cabeceras agotado.',
    UND_ERR_BODY_TIMEOUT: 'Tiempo de espera del cuerpo agotado.',
    UND_ERR_SOCKET: 'La conexión se cerró inesperadamente.',
    CERT_HAS_EXPIRED: 'Certificado TLS caducado.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificado TLS no confiable.',
    SELF_SIGNED_CERT_IN_CHAIN: 'Cadena TLS no confiable.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No se pudo verificar el certificado TLS.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado TLS no coincide con el dominio.',
    TIMEOUT: 'La solicitud superó el tiempo límite.',
    REDIRECT: 'La API devolvió una redirección; revisa la Project URL.',
    NETWORK: 'Fallo de conexión sin código conocido.'
});
const STATES = Object.freeze({
    INVALID_RESPONSE: 'Respuesta inesperada de la API; comprueba Project URL y Data API.',
    WORKER_FAILED: 'El proceso de conexión no pudo completar la operación.',
    WORKER_TIMEOUT: 'El proceso de conexión superó 15 segundos.',
    WORKER_BUFFER: 'La respuesta excedió el límite de memoria permitido.',
    REVISION_CONFLICT: 'Conflicto de revisión; detén las otras instancias y revisa el historial.',
    GUILD_DELETION: 'La operación intentó eliminar una configuración completa de servidor; rechazada.',
    INVALID_STATE: 'Supabase rechazó el formato del documento de memoria.'
});
function own(obj, key) { return typeof key === 'string' && Object.hasOwn(obj, key); }
function httpDiagnostic(status, body) {
    const code = CODES.has(body?.code) ? body.code : undefined;
    let kind = 'HTTP';
    // Match only exact, known SQL exception messages. Never return the message.
    if (code === 'P0001') {
        if (body.message === 'Timmy revision conflict') kind = 'REVISION_CONFLICT';
        if (body.message === 'Timmy guild deletion refused') kind = 'GUILD_DELETION';
        if (['invalid Timmy state','invalid Timmy guild or ticket'].includes(body.message)) kind = 'INVALID_STATE';
    }
    return { kind, status, code };
}
function networkDiagnostic(error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { kind: 'NETWORK', code: 'TIMEOUT' };
    const code = error?.cause?.code || error?.code;
    return { kind: 'NETWORK', code: own(NETWORK, code) ? code : 'NETWORK' };
}
function describe(operation, diagnostic) {
    const stage = operation === 'load' ? 'lectura' : operation === 'commit' ? 'escritura' : 'operación';
    const d = diagnostic || {};
    const status = Number.isInteger(d.status) && d.status >= 300 && d.status <= 599 ? d.status : null;
    const code = CODES.has(d.code) ? d.code : null;
    let advice;
    if (own(STATES,d.kind)) advice = STATES[d.kind];
    else if (d.kind === 'NETWORK') advice = NETWORK[own(NETWORK,d.code) ? d.code : 'NETWORK'];
    else if (d.kind === 'HTTP' && status) {
        if (code === '42501' || status === 403) advice = 'Acceso denegado; verifica permisos de service_role, clave y Data API.';
        else if (['PGRST202','PGRST205','42P01','42883'].includes(code)) advice = 'Tabla o función no disponible en Data API; verifica el SQL, esquema public y caché.';
        else if (status === 401) advice = 'Autenticación rechazada; verifica que la clave secreta pertenezca al mismo proyecto.';
        else if (status === 404) advice = 'Recurso no encontrado; verifica Project URL, Data API y esquema.';
        else if (status === 409) advice = 'Conflicto de datos; verifica revisiones antes de reintentar.';
        else if (status === 429) advice = 'Límite de solicitudes; verifica el servicio antes de reintentar.';
        else if (status >= 500) advice = 'Fallo del servicio remoto; consulta el estado de Supabase.';
        else if (status >= 300 && status < 400) advice = 'Redirección rechazada; usa la Project URL correcta.';
        else advice = 'La API rechazó la solicitud; revisa la configuración y el esquema.';
    } else advice = STATES.WORKER_FAILED;
    return 'Supabase [' + stage + ']' + (status ? ' HTTP ' + status : '') +
        (code ? ' ' + code : d.kind === 'NETWORK' && own(NETWORK,d.code) ? ' ' + d.code : '') + ': ' + advice;
}
function validateSettings(url, key, id) {
    if (!url || !key || !id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Completa TIMMY_SUPABASE_URL, TIMMY_SUPABASE_KEY y TIMMY_STORAGE_ID.');
    let origin;
    try { origin = new URL(url); } catch { throw new Error('TIMMY_SUPABASE_URL debe ser la URL HTTPS del proyecto.'); }
    if (url !== url.trim() || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('TIMMY_SUPABASE_URL debe ser la URL HTTPS del proyecto, sin rutas, credenciales ni espacios.');
    if (key !== key.trim() || /\s/.test(key)) throw new Error('TIMMY_SUPABASE_KEY contiene espacios o saltos de línea.');
    if (key.startsWith('sb_publishable_')) throw new Error('TIMMY_SUPABASE_KEY es pública; usa una secret key o service_role.');
    if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return { url: origin.origin, key, id };
    let claims;
    try {
        const segments = key.split('.');
        if (segments.length !== 3 || !segments.every(s => /^[A-Za-z0-9_-]+$/.test(s))) throw new Error();
        claims = JSON.parse(Buffer.from(segments[1],'base64url').toString('utf8'));
    } catch { throw new Error('TIMMY_SUPABASE_KEY no tiene formato de secret key o JWT service_role.'); }
    // Decode only for local checks, not signature verification. Supabase verifies it.
    if (claims?.role !== 'service_role') throw new Error('TIMMY_SUPABASE_KEY no es service_role; no uses anon ni una clave de usuario.');
    if (typeof claims.exp === 'number' && claims.exp <= Date.now()/1000) throw new Error('TIMMY_SUPABASE_KEY JWT está caducada.');
    const project = /^([a-z0-9]+)\.supabase\.co$/i.exec(origin.hostname)?.[1];
    if (project && typeof claims.ref === 'string' && claims.ref !== project) throw new Error('TIMMY_SUPABASE_KEY JWT pertenece a otro proyecto Supabase.');
    return { url: origin.origin, key, id };
}
module.exports = { httpDiagnostic, networkDiagnostic, describe, validateSettings };
