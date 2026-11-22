'use strict';

const reportWords = /\b(?:reportar|reporte|reporto|denunciar|denuncia|denuncio)\b/i;
const noProof = /\b(?:sin|no (?:tengo|hay|tom[eé]|guard[eé])) (?:ning[uú]n(?:a)? )?(?:pruebas?|capturas?|evidencias?|enlaces?|fotos?)\b/i;
const onlyEvidence = /^(?:(?:aqu[ií]|ac[aá]|ah[ií]|esta) (?:est[aá]n?|es|tienes?) |(?:te )?(?:dejo|adjunto|env[ií]o) )?(?:la |las |una? |mis? )?(?:capturas?|pruebas?|evidencias?|fotos?|enlaces?)(?: adjuntas?)?$/i;
const shortIncident = /^(?:spam|acoso|insultos|estafa|amenazas|raid)$/i;

function description(fragment) {
    const text = fragment.replace(/^[\s.,:;-]+|[\s.,:;!-]+$/g, '');
    if (!text || /[¿?]/.test(text) || reportWords.test(text) || onlyEvidence.test(text)) return '';
    if (/^(?:hola|buen[oa]s(?: d[ií]as| tardes| noches)?|muchas gracias|de nada|no (?:s[eé]|recuerdo))$/i.test(text)) return '';
    if (/^(?:(?:est[ea]|es[ea]|aqu[ií]|ah[ií]) )?(?:es )?(?:(?:su|el|la|est[ea]) )?(?:id|usuario|cuenta|miembro)(?: es)?$/i.test(text)) return '';
    return shortIncident.test(text) || text.split(/\s+/).length >= 2 ? text : '';
}

function extract(text) {
    // A Discord message link contains three IDs, none identifies the reported member.
    const plain = text.replace(/https?:\/\/\S+|<(?:#|@&)\d+>/gi, ' ').trim();
    const content = plain.replace(noProof, '').trim();
    const mention = /(?:<@!?|@)?\b(\d{17,20})\b>?/.exec(content);
    const reason = content.match(/\b(?:porque\s+|por\s+|motivo[\s:]+|me\s+(?=insult|estaf|acos|amenaz)).+/i);
    const narrative = mention ? description(content.slice(mention.index + mention[0].length)) || description(content.slice(0, mention.index)) : description(content);
    const detail = reason && !/[¿?]/.test(reason[0]) ? reason[0].replace(/<@!?\d+>/g, '').trim() : narrative;
    return { target: mention?.[1], detail, withoutEvidence: noProof.test(plain), link: /https?:\/\/[^\s<>]+/i.test(text) };
}

function intake(ticket, text, { hasFiles, readImage }, save) {
    const previous = ticket.report, current = extract(text);
    const starts = reportWords.test(text);
    const openedAsReport = ticket.category === 'reporte' || reportWords.test(ticket.summary || '');
    if (!previous && !starts && !openedAsReport) return null;
    const newTarget = previous?.complete && starts && current.target && current.target !== previous.target;
    if (previous?.complete && !newTarget) return null;
    const fromForm = !previous && openedAsReport ? extract(ticket.summary || '') : {};
    const report = newTarget ? {} : { ...previous };
    report.target ||= current.target || fromForm.target;
    const described = (!readImage && current.detail) || fromForm.detail;
    if (!report.detail && described) report.detail = described.slice(0,700);
    if (hasFiles || current.link || fromForm.link) report.evidence = true;
    const declined = previous?.target && previous.detail && /^(?:no|ninguna)[.!]?$/i.test(text.trim());
    if (current.withoutEvidence || fromForm.withoutEvidence || declined) report.withoutEvidence = true;
    report.complete = Boolean(report.target && report.detail && (report.evidence || report.withoutEvidence));
    ticket.report = report;
    try { save(); } catch (error) { ticket.report = previous; throw error; }
    if (readImage) return null;
    if (!report.target) return 'Podemos revisar el reporte aquí. ¿Cuál es la mención o el ID de la cuenta que quieres reportar?';
    const who = '<@' + report.target + '>';
    if (!report.detail) return 'Ya estás en tu ticket. Anoté el reporte sobre ' + who + '. ¿Qué pasó?' + (report.evidence ? ' La evidencia ya está en el canal.' : ' Si tienes una captura o el enlace al mensaje, puedes dejarlo aquí.');
    if (!report.complete) return 'Anoté lo ocurrido con ' + who + '. ¿Tienes una captura o un enlace? Si no guardaste pruebas, también puedes decirlo.';
    return 'El reporte sobre ' + who + ' quedó en este ticket con tu descripción' + (report.evidence ? ' y la evidencia compartida.' : '. Indicamos que no tienes pruebas adicionales.') + ' El equipo puede revisarlo aquí.';
}
module.exports = { intake };
