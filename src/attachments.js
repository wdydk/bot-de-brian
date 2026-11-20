'use strict';
const { UserError } = require('./core');

const IMAGE_LIMIT = 10 * 1024 * 1024;
const IMAGE_SIZE_ERROR = 'Las fotos de una consulta pueden sumar hasta 10 MiB. Reduce su tamaño o envíalas por separado.';
const IMAGE_FORMAT_ERROR = 'Para leer una foto, adjunta una imagen JPG, PNG o WebP.';
const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');

async function downloadAttachment(file, maxBytes, sizeError, signal = AbortSignal.timeout(20000)) {
    if (file.size > maxBytes) throw new UserError(sizeError);
    const url = URL.parse(file.url);
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ||
        !/^\/(?:ephemeral-)?attachments\//.test(url.pathname)) {
        throw new UserError('Adjunta el archivo directamente al mensaje en Discord.');
    }
    try {
        const response = await fetch(url, { redirect: 'error', signal });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new UserError('No pude descargar el adjunto de Discord. Vuelve a adjuntarlo.');
        }
        if (Number(response.headers.get('content-length')) > maxBytes) {
            await response.body.cancel();
            throw new UserError(sizeError);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) throw new UserError(sizeError);
            chunks.push(chunk);
        }
        return Buffer.concat(chunks, size);
    } catch (error) {
        if (error instanceof UserError) throw error;
        throw new UserError('No pude descargar el adjunto de Discord. Vuelve a adjuntarlo.');
    }
}

function imageType(bytes) {
    if (bytes.subarray(0, 8).equals(pngHeader)) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    throw new UserError(IMAGE_FORMAT_ERROR);
}

async function readImageParts(files) {
    if (files.reduce((total, file) => total + (file.size ?? 0), 0) > IMAGE_LIMIT) throw new UserError(IMAGE_SIZE_ERROR);
    const signal = AbortSignal.timeout(20000);
    let remaining = IMAGE_LIMIT;
    const parts = [];
    for (const file of files) {
        // Discord sometimes supplies application/octet-stream or omits the MIME type.
        // Use the image header for the MIME type sent to Gemini.
        const bytes = await downloadAttachment(file, remaining, IMAGE_SIZE_ERROR, signal);
        const mimeType = imageType(bytes);
        parts.push({ inlineData: { mimeType, data: bytes.toString('base64') } });
        remaining -= bytes.length;
    }
    return parts;
}

module.exports = { downloadAttachment, readImageParts };
