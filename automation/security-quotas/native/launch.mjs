import {mkdtempSync,readFileSync,writeFileSync,chmodSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
const native=await import(process.env.CENSUS_NATIVE_BIN_MODULE||'@embedded-postgres/linux-x64');
const nativeRoot=resolve(dirname(native.postgres),'..');
// Reproduce the package's reviewed symlink hydration without running install scripts.
for(const {source,target} of JSON.parse(readFileSync(join(nativeRoot,'pg-symlinks.json')))){
 const cwd=dirname(nativeRoot),src=resolve(cwd,source),dst=resolve(cwd,target);
 if(!src.startsWith(nativeRoot+'/')||!dst.startsWith(nativeRoot+'/'))throw Error('Unexpected package symlink path');
 if(!existsSync(dst))symlinkSync(src,dst);
}
const work=mkdtempSync(join(tmpdir(),'voiceprotest-quota-rehearsal-'));chmodSync(work,0o700);
const data=join(work,'data'),log=join(work,'server.log'),password=randomBytes(32).toString('hex');
const env={...process.env,LD_LIBRARY_PATH:join(nativeRoot,'lib')};let started=false;
function command(bin,args,options={}){
 const result=spawnSync(bin,args,{env,encoding:'utf8',...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${bin} failed (${result.status})\n${result.stderr||result.stdout||''}`);
 return result;
}
try{
 if(process.getuid?.()===0){
  const map=readFileSync('/proc/self/uid_map','utf8').trim().split(/\s+/);
  if(process.env.CENSUS_ALLOW_NAMESPACE_UID_ADAPTER!=='1'||map[2]!=='1')throw Error('Run as an ordinary OS user. In this single-UID test namespace only, explicitly enable CENSUS_ALLOW_NAMESPACE_UID_ADAPTER=1.');
  // Restricted namespace adapter affects OS-user/ownership reporting only.
  // It does not change SQL roles, permissions, row locks or transaction behavior.
  command('gcc',['-shared','-fPIC','-o',join(work,'namespace-uid.so'),join(here,'namespace-uid.c'),'-ldl']);
  env.LD_PRELOAD=join(work,'namespace-uid.so');
 }
 const pwfile=join(work,'password');writeFileSync(pwfile,password,{mode:0o600});
 command(native.initdb,['-D',data,'-U','rehearsal','--auth-host=scram-sha-256','--auth-local=reject','--pwfile='+pwfile,'--no-locale','--encoding=UTF8']);
 rmSync(pwfile);
 command(native.pg_ctl,['-D',data,'-l',log,'-o',"-c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c port=55450 -c cluster_name=voiceprotest-quota-rehearsal",'-w','start']);started=true;
 // The client never inherits the UID facade or any actual database credentials.
 const clientEnv={...process.env,CENSUS_NATIVE_PASSWORD:password};delete clientEnv.LD_PRELOAD;delete clientEnv.PGPASSWORD;delete clientEnv.DATABASE_URL;
 command(process.execPath,[join(here,'run.mjs')],{env:clientEnv,stdio:'inherit'});
}finally{
 if(started){try{command(native.pg_ctl,['-D',data,'-m','fast','-w','stop']);}catch(e){console.error(e.message);console.error('Temporary instance requires attention:',work);throw e;}}
 rmSync(work,{recursive:true,force:true});
}
