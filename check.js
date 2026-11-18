'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const files = ['index.js', ...['src', 'web'].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`))];
for (const file of files) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
console.log(`Sintaxis correcta: ${files.length} archivos.`);
