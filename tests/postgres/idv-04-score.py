"""Offline native PostgreSQL regression. Requires pgserver==0.1.4, psycopg[binary]==3.2.13.
Starts its own disposable server; never accepts a production DSN.
"""
import json, re, tempfile, uuid
from pathlib import Path
import pgserver, psycopg
ROOT=Path(__file__).resolve().parents[2]
defs=json.loads((ROOT/'tests/fixtures/idv-04-functions.json').read_text())
server=pgserver.get_server(Path(tempfile.mkdtemp())/'data',cleanup_mode='delete')
conn=psycopg.connect(server.get_uri(),autocommit=True)
conn.execute("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $$; SET ROLE postgres; CREATE ROLE service_role; CREATE ROLE anon;")
conn.execute('''
CREATE SCHEMA voiceprotest_private;
CREATE TABLE public.protests(id uuid PRIMARY KEY,ends_at timestamptz,saldo_euros numeric,count integer DEFAULT 0,requiere_censo boolean DEFAULT false,dominio_email text,risk_level text DEFAULT 'low');
CREATE TABLE public.email_otp_requests(id uuid PRIMARY KEY,email_hash text,protest_id uuid,otp_hash text,expires_at timestamptz,consumed_at timestamptz,attempt_count integer DEFAULT 0);
CREATE TABLE public.institutional_members(email_hash text,protest_id uuid,expires_at timestamptz,CONSTRAINT institutional_member_unique UNIQUE(email_hash,protest_id));
CREATE TABLE public.adhesions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),protest_id uuid,device_id text,phone_hash text,identity_subject_hash text,verification_method text,doc_hash text,ciudad text,region text,pais text,pais_code text,idioma text,nullifier text,created_at timestamptz,fiabilidad integer,senales text,gps_confirmed boolean,adhesion_osm_id bigint,anonymized_at timestamptz,CONSTRAINT adhesions_active_nullifier_unique UNIQUE(nullifier));
CREATE TABLE public.devices(id text,last_seen timestamptz);
CREATE TABLE voiceprotest_private.census_creator_proofs(protest_id uuid PRIMARY KEY,used_at timestamptz,key_hash text,founder_hash text);
CREATE TABLE public.groups(id uuid PRIMARY KEY,protest_id uuid);
CREATE TABLE public.group_members(group_id uuid,email_hash text,accredited_at timestamptz);
CREATE FUNCTION public.update_cities_count(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
''')
for d in defs:
 conn.execute(d['definition'])
 conn.execute('REVOKE ALL ON FUNCTION public.'+d['signature']+' FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.'+d['signature']+' TO service_role')
trigger_source=(ROOT/'docs/proposals/idv-01-02-admission.sql').read_text()
trigger=re.search(r'CREATE OR REPLACE FUNCTION public.enforce_census_admission\(\).*?END \$function\$',trigger_source,re.S).group(0)
conn.execute(trigger)
conn.execute('CREATE TRIGGER census_admission_guard BEFORE INSERT ON public.adhesions FOR EACH ROW EXECUTE FUNCTION public.enforce_census_admission()')
def fixture(census=False,expired=False,attempts=0,consumed=False):
 p,c=uuid.uuid4(),uuid.uuid4(); email=uuid.uuid4().hex
 conn.execute("INSERT INTO protests(id,ends_at,dominio_email,requiere_censo) VALUES(%s,now()+interval '1 day','synthetic.invalid',%s)",(p,census))
 conn.execute("INSERT INTO email_otp_requests VALUES(%s,%s,%s,'correct',now()+(CASE WHEN %s THEN interval '-1 hour' ELSE interval '1 hour' END),CASE WHEN %s THEN now() ELSE NULL END,%s)",(c,email,p,expired,consumed,attempts))
 return p,c,email
sig=next(d['signature'] for d in defs if d['signature'].startswith('verify_institutional_challenge'))
def call(f,code=None,otp='correct',founder=False,key='synthetic-key'):
 p,c,email=f
 args=[email,p,otp,email,uuid.uuid4().hex,None,None,None,code,'es','2027-08-31T00:00:00Z']
 if founder: args += [key,c]; name='verify_census_founder_adhesion'
 else: args += [c]; name='verify_institutional_challenge_and_create_adhesion'
 return conn.execute('SELECT public.'+name+'('+','.join(['%s']*len(args))+')',args).fetchone()[0]
def last_row(result):return conn.execute('SELECT fiabilidad,senales,gps_confirmed FROM adhesions WHERE id=%s',(result['id'],)).fetchone()
def expect_error(f,needle,**kwargs):
 try:call(f,**kwargs)
 except psycopg.Error as e:assert needle in str(e),(needle,str(e))
 else:raise AssertionError('expected '+needle)
def consumed(f):return conn.execute('SELECT consumed_at FROM email_otp_requests WHERE id=%s',(f[1],)).fetchone()[0]
# Reproduce baseline overclaim before applying exact migration.
assert last_row(call(fixture()))==(90,'email_otp,ip',False)
pre=conn.execute("SELECT proowner,proacl,prosecdef FROM pg_proc WHERE oid=('public.'||%s)::regprocedure",(sig,)).fetchone()
conn.execute((ROOT/'docs/proposals/idv-04-institutional-score.sql').read_text())
post=conn.execute("SELECT proowner,proacl,prosecdef FROM pg_proc WHERE oid=('public.'||%s)::regprocedure",(sig,)).fetchone();assert pre==post
for code,score,signals in [(None,75,'email_otp'),('',75,'email_otp'),('ESP',75,'email_otp'),('es',75,'email_otp'),('ES',85,'email_otp,ip')]:
 f=fixture();assert last_row(call(f,code))==(score,signals,False);assert consumed(f) is not None
# Error semantics, retry, and rollback preserve challenge behavior.
f=fixture();assert call(f,otp='wrong')['error']=='VP_WRONG_OTP';assert consumed(f) is None
assert conn.execute('SELECT attempt_count FROM email_otp_requests WHERE id=%s',(f[1],)).fetchone()[0]==1
assert last_row(call(f))==(75,'email_otp',False);expect_error(f,'VP_OTP_ALREADY_USED')
for options,error in [({'expired':True},'VP_OTP_EXPIRED'),({'attempts':5},'VP_TOO_MANY_ATTEMPTS'),({'consumed':True},'VP_OTP_ALREADY_USED')]:expect_error(fixture(**options),error)
f=fixture();conn.execute('UPDATE protests SET ends_at=now()-interval \'1 hour\' WHERE id=%s',(f[0],));expect_error(f,'VP_PROTEST_CLOSED');assert consumed(f) is None
# Real census trigger and real founder wrapper, not a stubbed acceptance.
f=fixture(census=True);expect_error(f,'CENSUS_MEMBERSHIP_REQUIRED');assert consumed(f) is None
conn.execute('INSERT INTO voiceprotest_private.census_creator_proofs(protest_id,key_hash) VALUES(%s,%s)',(f[0],'synthetic-key'))
assert last_row(call(f,founder=True))==(75,'email_otp',False)
assert conn.execute('SELECT founder_hash FROM voiceprotest_private.census_creator_proofs WHERE protest_id=%s',(f[0],)).fetchone()[0]==f[2]
f=fixture(census=True);g=uuid.uuid4();conn.execute('INSERT INTO groups VALUES(%s,%s)',(g,f[0]));conn.execute('INSERT INTO group_members VALUES(%s,%s,now())',(g,f[2]));assert last_row(call(f,'ES'))==(85,'email_otp,ip',False)
# Reapplying on an unexpected definition fails closed.
try:conn.execute((ROOT/'docs/proposals/idv-04-institutional-score.sql').read_text())
except psycopg.Error as e:assert 'VP_IDV04_BASELINE_DRIFT' in str(e);conn.execute('ROLLBACK')
else:raise AssertionError('drift guard not enforced')
md5=conn.execute("SELECT md5(pg_get_functiondef(('public.'||%s)::regprocedure))",(sig,)).fetchone()[0]
conn.execute((ROOT/'docs/proposals/idv-04-institutional-score-rollback.sql').read_text())
assert conn.execute("SELECT md5(pg_get_functiondef(('public.'||%s)::regprocedure))",(sig,)).fetchone()[0]=='51bc6c14aa8d5127a7467681b3bd844d'
conn.execute((ROOT/'docs/proposals/idv-04-institutional-score.sql').read_text())
assert last_row(call(fixture()))==(75,'email_otp',False)
print(json.dumps({'status':'PASS','postgres':conn.execute('SELECT version()').fetchone()[0],'applied_md5':md5,'groups':['baseline reproduction','IP country matrix','ACL owner invoker unchanged','wrong OTP retry and replay','expired and exhausted challenges','admission rollback preserves OTP','census rejection','founder bootstrap','accredited member','drift guard','rollback and reapply']}))
conn.close()
