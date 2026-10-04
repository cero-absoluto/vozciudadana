-- I4 isolated implementation. Never run against production without its own gate.
CREATE SCHEMA funding_private;
REVOKE ALL ON SCHEMA funding_private FROM PUBLIC, anon, authenticated;
CREATE ROLE funding_runtime NOLOGIN;
GRANT USAGE ON SCHEMA funding_private TO funding_runtime;

CREATE TABLE funding_private.annual_limits (
 policy_year int NOT NULL CHECK(policy_year BETWEEN 2026 AND 2200),
 token text NOT NULL CHECK(token ~ '^[a-f0-9]{64}$'),
 committed bigint NOT NULL DEFAULT 0 CHECK(committed>=0),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 PRIMARY KEY(policy_year,token), CHECK(committed+reserved<=100000)
);
CREATE TABLE funding_private.event_limits (
 event_id uuid NOT NULL REFERENCES public.protests(id),
 token text NOT NULL CHECK(token ~ '^[a-f0-9]{64}$'),
 committed bigint NOT NULL DEFAULT 0 CHECK(committed>=0),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 PRIMARY KEY(event_id,token), CHECK(committed+reserved<=10000)
);
CREATE TABLE funding_private.accounts (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('event','general','restricted_grant','clearing','cost')),
 event_id uuid UNIQUE REFERENCES public.protests(id),
 balance bigint NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closing','ready','settled')),
 CHECK((kind='event')=(event_id IS NOT NULL)),
 CHECK(kind NOT IN ('event','general','restricted_grant') OR balance>=0)
);
INSERT INTO funding_private.accounts(id,kind) VALUES ('general','general'),('clearing','clearing'),('verification_cost','cost');
CREATE TABLE funding_private.intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('event','general')),
 event_id uuid REFERENCES public.protests(id),
 policy_year int NOT NULL,
 annual_token text NOT NULL,
 event_token text,
 amount bigint NOT NULL CHECK(amount>0 AND amount<=100000),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','confirmed','cancelled','review')),
 FOREIGN KEY(policy_year,annual_token) REFERENCES funding_private.annual_limits(policy_year,token),
 FOREIGN KEY(event_id,event_token) REFERENCES funding_private.event_limits(event_id,token),
 CHECK((kind='event' AND event_id IS NOT NULL AND event_token IS NOT NULL) OR (kind='general' AND event_id IS NULL AND event_token IS NULL))
);
CREATE TABLE funding_private.provider_events (
 provider text NOT NULL CHECK(provider='simulator'),
 event_ref text NOT NULL CHECK(length(event_ref) BETWEEN 1 AND 128),
 intent_id uuid NOT NULL REFERENCES funding_private.intents(id),
 amount bigint NOT NULL CHECK(amount>0),
 currency text NOT NULL,
 result text NOT NULL CHECK(result IN ('confirmed','review','duplicate_payment')),
 PRIMARY KEY(provider,event_ref)
);
CREATE TABLE funding_private.payments (
 intent_id uuid PRIMARY KEY REFERENCES funding_private.intents(id),
 gross bigint NOT NULL CHECK(gross>0),
 fee bigint NOT NULL DEFAULT 0 CHECK(fee=0),
 net bigint NOT NULL CHECK(net=gross),
 provider text NOT NULL CHECK(provider='simulator')
);
CREATE TABLE funding_private.ledger_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('contribution','verification_cost','surplus','grant')),
 creation_xid bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE funding_private.ledger_entries (
 transaction_id uuid NOT NULL REFERENCES funding_private.ledger_transactions(id),
 account_id text NOT NULL REFERENCES funding_private.accounts(id),
 amount bigint NOT NULL CHECK(amount<>0),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 PRIMARY KEY(transaction_id,account_id)
);
CREATE TABLE funding_private.cost_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.protests(id),
 amount bigint NOT NULL CHECK(amount>0),
 operation_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','charged','cancelled'))
);
CREATE TABLE funding_private.settlements (
 event_id uuid PRIMARY KEY REFERENCES public.protests(id),
 surplus bigint NOT NULL CHECK(surplus>=0),
 settled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE funding_private.grant_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id text NOT NULL UNIQUE REFERENCES funding_private.accounts(id),
 purpose text NOT NULL CHECK(length(purpose)>0),
 restricted boolean NOT NULL,
 anti_capture_accepted boolean NOT NULL CHECK(anti_capture_accepted)
);
CREATE TABLE funding_private.unmatched_provider_events (
 provider text NOT NULL CHECK(provider='simulator'),
 event_ref text NOT NULL,
 claimed_intent uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount>0),
 currency text NOT NULL,
 PRIMARY KEY(provider,event_ref)
);

CREATE FUNCTION funding_private.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append_only'; END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON funding_private.ledger_entries FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON funding_private.ledger_transactions FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE TRIGGER grant_awards_immutable BEFORE UPDATE OR DELETE ON funding_private.grant_awards FOR EACH ROW EXECUTE FUNCTION funding_private.immutable();
CREATE FUNCTION funding_private.entry_in_creating_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT creation_xid FROM funding_private.ledger_transactions WHERE id=NEW.transaction_id) IS DISTINCT FROM txid_current() THEN
  RAISE EXCEPTION 'transaction_already_final';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entries_creation_only BEFORE INSERT ON funding_private.ledger_entries FOR EACH ROW EXECUTE FUNCTION funding_private.entry_in_creating_transaction();
CREATE FUNCTION funding_private.check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid;
BEGIN
 IF TG_TABLE_NAME='ledger_transactions' THEN tid:=NEW.id; ELSE tid:=NEW.transaction_id; END IF;
 IF (SELECT count(*) FROM funding_private.ledger_entries WHERE transaction_id=tid)<2 OR
    (SELECT COALESCE(sum(amount),0) FROM funding_private.ledger_entries WHERE transaction_id=tid)<>0 THEN
  RAISE EXCEPTION 'unbalanced_ledger';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced_transaction AFTER INSERT ON funding_private.ledger_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.check_balanced();
CREATE CONSTRAINT TRIGGER balanced_entries AFTER INSERT ON funding_private.ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.check_balanced();
CREATE FUNCTION funding_private.check_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='accounts' THEN aid:=NEW.id; ELSE aid:=NEW.account_id; END IF;
 IF (SELECT balance FROM funding_private.accounts WHERE id=aid) IS DISTINCT FROM
    (SELECT COALESCE(sum(amount),0)::bigint FROM funding_private.ledger_entries WHERE account_id=aid) THEN
  RAISE EXCEPTION 'ledger_projection_mismatch';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER accounts_projection AFTER INSERT OR UPDATE ON funding_private.accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.check_projection();
CREATE CONSTRAINT TRIGGER entries_projection AFTER INSERT ON funding_private.ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION funding_private.check_projection();

CREATE FUNCTION funding_private.reserve(p_year int,p_annual text,p_event_token text,p_event uuid,p_amount bigint,p_expiry timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE aid uuid; ev public.protests%ROWTYPE; a funding_private.annual_limits%ROWTYPE; e funding_private.event_limits%ROWTYPE;
BEGIN
 IF p_amount<=0 OR p_amount>100000 OR p_expiry<=clock_timestamp() OR p_expiry>clock_timestamp()+interval '30 minutes' THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 IF p_event IS NOT NULL THEN
  SELECT * INTO ev FROM public.protests WHERE id=p_event FOR UPDATE;
  IF NOT FOUND OR ev.starts_at>clock_timestamp() OR ev.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_not_open'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE event_id=p_event AND state='open';
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_enabled'; END IF;
 ELSIF p_event_token IS NOT NULL THEN RAISE EXCEPTION 'invalid_event_token'; END IF;
 INSERT INTO funding_private.annual_limits(policy_year,token) VALUES(p_year,p_annual) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM funding_private.annual_limits WHERE policy_year=p_year AND token=p_annual FOR UPDATE;
 IF a.committed+a.reserved+p_amount>100000 THEN RAISE EXCEPTION 'annual_limit'; END IF;
 IF p_event IS NOT NULL THEN
  INSERT INTO funding_private.event_limits(event_id,token) VALUES(p_event,p_event_token) ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM funding_private.event_limits WHERE event_id=p_event AND token=p_event_token FOR UPDATE;
  IF e.committed+e.reserved+p_amount>10000 THEN RAISE EXCEPTION 'event_limit'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE event_id=p_event AND state='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_open'; END IF;
  UPDATE funding_private.event_limits SET reserved=reserved+p_amount WHERE event_id=p_event AND token=p_event_token;
 END IF;
 UPDATE funding_private.annual_limits SET reserved=reserved+p_amount WHERE policy_year=p_year AND token=p_annual;
 INSERT INTO funding_private.intents(kind,event_id,policy_year,annual_token,event_token,amount,expires_at)
 VALUES(CASE WHEN p_event IS NULL THEN 'general' ELSE 'event' END,p_event,p_year,p_annual,p_event_token,p_amount,p_expiry) RETURNING id INTO aid;
 RETURN aid;
END $$;

CREATE FUNCTION funding_private.confirm(p_ref text,p_intent uuid,p_amount bigint,p_currency text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i funding_private.intents%ROWTYPE; old funding_private.provider_events%ROWTYPE; unmatched funding_private.unmatched_provider_events%ROWTYPE; tid uuid; account text; result text;
BEGIN
 -- Serialize the incoming idempotency key before inspecting any intent.
 PERFORM pg_advisory_xact_lock(hashtextextended('funding:simulator:'||p_ref,0));
 SELECT * INTO unmatched FROM funding_private.unmatched_provider_events WHERE provider='simulator' AND event_ref=p_ref;
 IF FOUND THEN
  IF unmatched.claimed_intent<>p_intent OR unmatched.amount<>p_amount OR unmatched.currency<>p_currency THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN 'review';
 END IF;
 SELECT * INTO old FROM funding_private.provider_events WHERE provider='simulator' AND event_ref=p_ref;
 IF FOUND THEN
  IF old.intent_id<>p_intent OR old.amount<>p_amount OR old.currency<>p_currency THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN old.result;
 END IF;
 SELECT * INTO i FROM funding_private.intents WHERE id=p_intent FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO funding_private.unmatched_provider_events(provider,event_ref,claimed_intent,amount,currency) VALUES('simulator',p_ref,p_intent,p_amount,p_currency);
  RETURN 'review';
 END IF;
 IF i.state='confirmed' THEN result:='duplicate_payment';
 ELSIF i.state<>'reserved' OR i.amount<>p_amount OR p_currency<>'EUR' OR i.expires_at<=clock_timestamp() THEN
  result:='review';
  IF i.state='reserved' THEN UPDATE funding_private.intents SET state='review' WHERE id=i.id; END IF;
 ELSE
  result:='confirmed';
  PERFORM 1 FROM funding_private.annual_limits WHERE policy_year=i.policy_year AND token=i.annual_token FOR UPDATE;
  UPDATE funding_private.annual_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE policy_year=i.policy_year AND token=i.annual_token;
  IF i.event_id IS NOT NULL THEN
   UPDATE funding_private.event_limits SET reserved=reserved-i.amount,committed=committed+i.amount WHERE event_id=i.event_id AND token=i.event_token;
   account:='event:'||i.event_id;
  ELSE account:='general'; END IF;
  PERFORM 1 FROM funding_private.accounts WHERE id IN (account,'clearing') ORDER BY id FOR UPDATE;
  INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('intent:'||i.id,'contribution') RETURNING id INTO tid;
  INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,account,i.amount),(tid,'clearing',-i.amount);
  UPDATE funding_private.accounts SET balance=balance+i.amount WHERE id=account;
  UPDATE funding_private.accounts SET balance=balance-i.amount WHERE id='clearing';
  INSERT INTO funding_private.payments(intent_id,gross,net,provider) VALUES(i.id,i.amount,i.amount,'simulator');
  UPDATE funding_private.intents SET state='confirmed' WHERE id=i.id;
 END IF;
 INSERT INTO funding_private.provider_events(provider,event_ref,intent_id,amount,currency,result) VALUES('simulator',p_ref,i.id,p_amount,p_currency,result);
 RETURN result;
END $$;

CREATE FUNCTION funding_private.cancel(p_intent uuid,p_provider_final boolean) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE i funding_private.intents%ROWTYPE;
BEGIN
 IF p_provider_final IS DISTINCT FROM true THEN RAISE EXCEPTION 'provider_may_still_charge'; END IF;
 SELECT * INTO i FROM funding_private.intents WHERE id=p_intent FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_intent'; END IF;
 IF i.state='cancelled' THEN RETURN 'cancelled'; END IF;
 IF i.state<>'reserved' THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
 UPDATE funding_private.annual_limits SET reserved=reserved-i.amount WHERE policy_year=i.policy_year AND token=i.annual_token;
 IF i.event_id IS NOT NULL THEN UPDATE funding_private.event_limits SET reserved=reserved-i.amount WHERE event_id=i.event_id AND token=i.event_token; END IF;
 UPDATE funding_private.intents SET state='cancelled' WHERE id=i.id;
 RETURN 'cancelled';
END $$;

CREATE FUNCTION funding_private.reserve_cost(p_event uuid,p_amount bigint,p_key text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE a funding_private.accounts%ROWTYPE; ev public.protests%ROWTYPE; held bigint; prior funding_private.cost_reservations%ROWTYPE; cid uuid;
BEGIN
 -- Same parent-before-account lock order as reserve and close_event.
 SELECT * INTO ev FROM public.protests WHERE id=p_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT * INTO a FROM funding_private.accounts WHERE event_id=p_event FOR UPDATE;
 IF NOT FOUND OR a.state<>'open' THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT * INTO prior FROM funding_private.cost_reservations WHERE operation_key=p_key;
 IF FOUND THEN
  IF prior.event_id<>p_event OR prior.amount<>p_amount THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN prior.id;
 END IF;
 -- A retry of an existing reservation is not a new cost commitment.
 IF ev.starts_at IS NULL OR ev.ends_at IS NULL OR ev.starts_at>clock_timestamp() OR ev.ends_at<=clock_timestamp() THEN RAISE EXCEPTION 'event_not_open'; END IF;
 SELECT COALESCE(sum(amount),0) INTO held FROM funding_private.cost_reservations WHERE event_id=p_event AND state='reserved';
 IF p_amount<=0 OR a.balance-held<p_amount THEN RAISE EXCEPTION 'insufficient_event_funds'; END IF;
 INSERT INTO funding_private.cost_reservations(event_id,amount,operation_key) VALUES(p_event,p_amount,p_key) RETURNING id INTO cid;
 RETURN cid;
END $$;

CREATE FUNCTION funding_private.finish_cost(p_cost uuid,p_charge boolean) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE c funding_private.cost_reservations%ROWTYPE; ev uuid; tid uuid; result text;
BEGIN
 SELECT event_id INTO ev FROM funding_private.cost_reservations WHERE id=p_cost;
 IF NOT FOUND OR p_charge IS NULL THEN RAISE EXCEPTION 'invalid_cost'; END IF;
 PERFORM 1 FROM funding_private.accounts WHERE id IN ('event:'||ev,'verification_cost') ORDER BY id FOR UPDATE;
 SELECT * INTO c FROM funding_private.cost_reservations WHERE id=p_cost FOR UPDATE;
 result:=CASE WHEN p_charge THEN 'charged' ELSE 'cancelled' END;
 IF c.state=result THEN RETURN result; END IF;
 IF c.state<>'reserved' THEN RAISE EXCEPTION 'cost_already_final'; END IF;
 IF p_charge THEN
  INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('cost:'||c.id,'verification_cost') RETURNING id INTO tid;
  INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,'event:'||ev,-c.amount),(tid,'verification_cost',c.amount);
  UPDATE funding_private.accounts SET balance=balance-c.amount WHERE event_id=ev;
  UPDATE funding_private.accounts SET balance=balance+c.amount WHERE id='verification_cost';
 END IF;
 UPDATE funding_private.cost_reservations SET state=result WHERE id=c.id;
 RETURN result;
END $$;

CREATE FUNCTION funding_private.close_event(p_event uuid) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE ev public.protests%ROWTYPE;
BEGIN
 SELECT * INTO ev FROM public.protests WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR ev.ends_at>clock_timestamp() THEN RAISE EXCEPTION 'event_not_ended'; END IF;
 UPDATE funding_private.accounts SET state='closing' WHERE event_id=p_event AND state='open';
 IF NOT EXISTS(SELECT 1 FROM funding_private.accounts WHERE event_id=p_event) THEN RAISE EXCEPTION 'event_not_enabled'; END IF;
 RETURN 'closing';
END $$;

CREATE FUNCTION funding_private.settle(p_event uuid) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE a funding_private.accounts%ROWTYPE; amount bigint; tid uuid;
BEGIN
 PERFORM 1 FROM public.protests WHERE id=p_event FOR UPDATE;
 PERFORM 1 FROM funding_private.accounts WHERE id IN ('event:'||p_event,'general') ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM funding_private.accounts WHERE event_id=p_event;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_not_enabled'; END IF;
 SELECT surplus INTO amount FROM funding_private.settlements WHERE event_id=p_event;
 IF FOUND THEN RETURN amount; END IF;
 IF a.state<>'closing' OR EXISTS(SELECT 1 FROM public.protests WHERE id=p_event AND ends_at>clock_timestamp()) THEN RAISE EXCEPTION 'not_ready'; END IF;
 IF EXISTS(SELECT 1 FROM funding_private.intents WHERE event_id=p_event AND state IN ('reserved','review')) OR EXISTS(SELECT 1 FROM funding_private.cost_reservations WHERE event_id=p_event AND state='reserved') THEN RAISE EXCEPTION 'pending_items'; END IF;
 amount:=a.balance;
 IF amount>0 THEN
  INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('settlement:'||p_event,'surplus') RETURNING id INTO tid;
  INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,'event:'||p_event,-amount),(tid,'general',amount);
  UPDATE funding_private.accounts SET balance=balance+amount WHERE id='general';
 END IF;
 UPDATE funding_private.accounts SET balance=0,state='settled' WHERE event_id=p_event;
 INSERT INTO funding_private.settlements(event_id,surplus) VALUES(p_event,amount);
 RETURN amount;
END $$;

CREATE FUNCTION funding_private.record_simulated_grant(p_grant uuid,p_amount bigint,p_ref text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,funding_private AS $$
DECLARE g funding_private.grant_awards%ROWTYPE; tid uuid; old_amount bigint;
BEGIN
 IF p_amount<=0 OR p_ref IS NULL OR length(p_ref)=0 THEN RAISE EXCEPTION 'invalid_grant'; END IF;
 SELECT * INTO g FROM funding_private.grant_awards WHERE id=p_grant;
 IF NOT FOUND OR NOT g.anti_capture_accepted THEN RAISE EXCEPTION 'grant_not_approved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM funding_private.accounts WHERE id=g.account_id AND kind='restricted_grant') THEN RAISE EXCEPTION 'grant_account_required'; END IF;
 PERFORM 1 FROM funding_private.accounts WHERE id IN (g.account_id,'clearing') ORDER BY id FOR UPDATE;
 SELECT id INTO tid FROM funding_private.ledger_transactions WHERE operation_key='grant:'||p_ref;
 IF FOUND THEN
  SELECT amount INTO old_amount FROM funding_private.ledger_entries WHERE transaction_id=tid AND account_id=g.account_id;
  IF old_amount IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN tid;
 END IF;
 INSERT INTO funding_private.ledger_transactions(operation_key,kind) VALUES('grant:'||p_ref,'grant') RETURNING id INTO tid;
 INSERT INTO funding_private.ledger_entries(transaction_id,account_id,amount) VALUES(tid,g.account_id,p_amount),(tid,'clearing',-p_amount);
 UPDATE funding_private.accounts SET balance=balance+p_amount WHERE id=g.account_id;
 UPDATE funding_private.accounts SET balance=balance-p_amount WHERE id='clearing';
 RETURN tid;
END $$;

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='funding_private' LOOP
  EXECUTE format('ALTER TABLE funding_private.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('CREATE POLICY runtime_only ON funding_private.%I TO funding_runtime USING (true) WITH CHECK (true)',t.tablename);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA funding_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA funding_private FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA funding_private TO funding_runtime;
REVOKE UPDATE ON funding_private.ledger_entries,funding_private.ledger_transactions FROM funding_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA funding_private TO funding_runtime;
-- Parent row locking needs SELECT/UPDATE privileges; never granted to clients.
GRANT SELECT ON public.protests TO funding_runtime;
GRANT UPDATE (id) ON public.protests TO funding_runtime;
-- No cron, legacy UPDATE, grant acceptance, bank transfer or live provider.
