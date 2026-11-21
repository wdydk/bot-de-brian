'use strict';

const reportWords = /\b(?:reportar|reporte|reporto|denunciar|denuncia|denuncio)\b/i;
const noProof = /(?:sin (?:pruebas?|capturas?)|no (?:tengo|hay|tom[eé]|guard[eé])(?: ninguna)? (?:pruebas?|capturas?|evidencia|enlace)|^(?:no|ninguna)[.!]?$)/i;
function extract(text) {
    // A Discord message link contains three IDs, none identifies the reported member.
    const plain = text.replace(/https?:\/\/\S+|<(?:#|@&)\d+>/gi,' ').trim();
    const mention = /(?:<@!?|@)?\b(\d{17,20})\b>?/.exec(plain);
    const reason = plain.match(/\b(?:porque\s+|por\s+|motivo[\s:]+|me\s+(?=insult|estaf|acos|amenaz)).+/i);
    const after = mention && plain.slice(mention.index+mention[0].length).replace(/^[\s.,:;-]+/,'');
    const detail = reason?.[0] || (after && after.split(/\s+/).length>=2 && !noProof.test(after) ? after : '');
    return { plain, target:mention?.[1], detail, link:/https?:\/\/[^\s<>]+/i.test(text) };
}
function intake(ticket, text, files, save) {
    const previous = ticket.report, current = extract(text);
    const starts = reportWords.test(text);
    const openedAsReport = ticket.category === 'reporte' || reportWords.test(ticket.summary || '');
    if (!previous && !starts && !openedAsReport) return null;
    const newTarget = previous?.complete && starts && current.target && current.target !== previous.target;
    if (previous?.complete && !newTarget) return null;
    const fromForm = !previous && openedAsReport ? extract(ticket.summary || '') : {};
    const report = newTarget ? {} : { ...previous };
    report.target ||= current.target || fromForm.target;
    const described = current.detail || fromForm.detail;
    if (!report.detail && described) report.detail = described.slice(0,700);
    if (!report.detail && report.target && !current.target && !noProof.test(current.plain) &&
        !/\?\s*$/.test(current.plain) && !starts &&
        (current.plain.split(/\s+/).length>=2 || /^(?:spam|acoso|insultos|estafa|amenazas|raid)[.!]?$/i.test(current.plain))) {
        report.detail = current.plain.slice(0,700);
    }
    if (files?.size || current.link || fromForm.link) report.evidence = true;
    if (noProof.test(text.trim())) report.withoutEvidence = true;
    report.complete = Boolean(report.target && report.detail && (report.evidence || report.withoutEvidence));
    ticket.report = report;
    try { save(); } catch (error) { ticket.report = previous; throw error; }
    if (!report.target) return 'Podemos revisar el reporte aquí. ¿Cuál es la mención o el ID de la cuenta que quieres reportar?';
    const who = '<@' + report.target + '>';
    if (!report.detail) return 'Ya estás en tu ticket. Anoté el reporte sobre ' + who + '. ¿Qué pasó?' + (report.evidence ? ' La evidencia ya está en el canal.' : ' Si tienes una captura o el enlace al mensaje, puedes dejarlo aquí.');
    if (!report.complete) return 'Anoté lo ocurrido con ' + who + '. ¿Tienes una captura o un enlace? Si no guardaste pruebas, también puedes decirlo.';
    return 'El reporte sobre ' + who + ' quedó en este ticket con tu descripción' + (report.evidence ? ' y la evidencia compartida.' : '. Indicamos que no tienes pruebas adicionales.') + ' El equipo puede revisarlo aquí.';
}
module.exports = { intake };
