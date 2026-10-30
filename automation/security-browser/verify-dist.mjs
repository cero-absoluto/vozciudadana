import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {htmlFiles} from './csp.mjs';
import {hasBrowserPolicy} from './health-check.mjs';
const files=htmlFiles(resolve('apps/web/dist'));
if(!files.length||files.some(path=>!hasBrowserPolicy(readFileSync(path,'utf8'))))throw Error('Every shipped HTML file must have the reviewed effective policy');
console.log(JSON.stringify({status:'PASS',protected_html_files:files.length}));
