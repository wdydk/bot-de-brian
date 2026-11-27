'use strict';
require('dotenv').config({ quiet: true });
const { processResult, generateDependencyReport } = require('../src/music');
async function main() {
    console.log('Node:', process.version);
    console.log(generateDependencyReport());
    console.log('FFmpeg:', (await processResult(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'])).split('\n')[0]);
    console.log('FFprobe:', (await processResult(process.env.FFPROBE_PATH || 'ffprobe', ['-version'])).split('\n')[0]);
    console.log('Python:', (await processResult('python3', ['--version'])).trim());
    console.log('Diagnóstico local correcto. No comprueba el acceso real a Discord ni la reproducción en un canal de voz.');
}
main().catch(error => { console.error('Diagnóstico falló:', error.message); process.exitCode = 1; });
