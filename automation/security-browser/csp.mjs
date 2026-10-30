import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const API_ORIGINS=['https://api.voiceprotest.org','https://reports.voiceprotest.org','https://vozciudadanaapi-production.up.railway.app'];
export const stripHtmlComments=html=>html.replace(/<!--[\s\S]*?-->/g,'');
export function validateApiOrigin(apiUrl){if(typeof apiUrl!=='string'||!API_ORIGINS.includes(apiUrl))throw new Error('VITE_API_URL must be a reviewed HTTPS API origin without trailing slash');}
export function contentSecurityPolicy(html,{apiUrl}={}) {
 if(apiUrl!==undefined)validateApiOrigin(apiUrl);
 const hashes=[...stripHtmlComments(html).matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)].map(m=>{if(!/type="application\/ld\+json"/.test(m[1]))throw new Error('Unreviewed inline script');JSON.parse(m[2]);return "'sha256-"+createHash('sha256').update(m[2]).digest('base64')+"'";});
 return ["default-src 'none'","base-uri 'none'","object-src 'none'",`script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ ${hashes.join(' ')}`,"script-src-attr 'none'","style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:",`connect-src 'self' ${API_ORIGINS.join(' ')} https://www.google.com/recaptcha/ https://www.wikidata.org https://query.wikidata.org https://cdn.jsdelivr.net/npm/world-atlas@2/`,"frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/","worker-src 'self'","manifest-src 'self'","form-action 'none'"].join('; ');
}
export function protectHtml(html,{apiUrl}={}){
 validateApiOrigin(apiUrl);
 if(!html.includes('<meta charset="UTF-8">')||/http-equiv="Content-Security-Policy"/i.test(html))throw new Error('Missing charset or duplicate CSP');
 const csp=contentSecurityPolicy(html,{apiUrl});
 return html.replace('<meta charset="UTF-8">',()=>'<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="'+csp+'">\n  <meta name="referrer" content="strict-origin">');
}
export function htmlFiles(root){const files=[];for(const entry of readdirSync(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isSymbolicLink())throw new Error('Unreviewed output symlink');if(entry.isDirectory())files.push(...htmlFiles(path));else if(entry.name.endsWith('.html'))files.push(path);}return files;}
export function browserProtectionPlugin({apiUrl=process.env.VITE_API_URL}={}){
 let out;
 return{name:'browser-protection',apply:'build',configResolved(config){out=resolve(config.root,config.build.outDir);},transformIndexHtml:{order:'post',handler:html=>protectHtml(html,{apiUrl})},writeBundle(){for(const path of htmlFiles(out)){const html=readFileSync(path,'utf8');if(!/http-equiv="Content-Security-Policy"/i.test(html))writeFileSync(path,protectHtml(html,{apiUrl}));}}};
}
