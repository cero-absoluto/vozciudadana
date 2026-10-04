// Synthetic metadata mirror only; never imports production records or trigger bodies.
export const fundingParentFixtureSQL=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.protests(
 id uuid PRIMARY KEY,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 saldo_euros numeric,hash_integridad text,ultima_donacion timestamptz,
 count integer NOT NULL DEFAULT 0,title text DEFAULT 'synthetic',
 updated_at timestamptz NOT NULL DEFAULT '2000-01-01T00:00:00Z');
ALTER TABLE public.protests ENABLE ROW LEVEL SECURITY;
CREATE POLICY protests_public_read ON public.protests FOR SELECT TO PUBLIC USING(true);
CREATE POLICY protests_service_write ON public.protests FOR ALL TO service_role USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.protests TO anon,authenticated,service_role;
CREATE TABLE public.fixture_parent_trigger_calls(before_calls int NOT NULL DEFAULT 0,after_calls int NOT NULL DEFAULT 0);
INSERT INTO public.fixture_parent_trigger_calls DEFAULT VALUES;
CREATE FUNCTION public.fixture_parent_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_WHEN='BEFORE' THEN
  UPDATE public.fixture_parent_trigger_calls SET before_calls=before_calls+1;
  NEW.updated_at:=clock_timestamp();
 ELSE UPDATE public.fixture_parent_trigger_calls SET after_calls=after_calls+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_protests_updated_at BEFORE UPDATE ON public.protests FOR EACH ROW EXECUTE FUNCTION public.fixture_parent_notice();
CREATE TRIGGER trg_transfer_protest_surplus_to_platform_fund AFTER UPDATE ON public.protests FOR EACH ROW EXECUTE FUNCTION public.fixture_parent_notice();
`;
export const fundingCoreMigration=new URL('../../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url);
export const fundingRlsMigration=new URL('../../supabase/migrations/20261004050924_funding_rls_compatibility.sql',import.meta.url);


export const fundingAuthMigration=new URL('../../supabase/migrations/20261004052915_funding_shared_auth.sql',import.meta.url);

export const fundingTemporalMigration=new URL('../../supabase/migrations/20261004055625_funding_temporal_v2.sql',import.meta.url);

export const fundingCostsMigration=new URL('../../supabase/migrations/20261004061929_funding_costs_exceptions.sql',import.meta.url);

export const fundingReviewMigration=new URL('../../supabase/migrations/20261004065228_funding_owner_review.sql',import.meta.url);

export const fundingProviderMigration=new URL('../../supabase/migrations/20261004072447_funding_offline_provider_bindings.sql',import.meta.url);

export const fundingContinuityMigration=new URL('../../supabase/migrations/20261004080912_funding_key_scope_continuity.sql',import.meta.url);
export const fundingRetentionMigration=new URL('../../supabase/migrations/20261004080913_funding_retention_controls.sql',import.meta.url);
export const fundingLifecycleMigration=new URL('../../supabase/migrations/20261004122418_funding_provider_lifecycle.sql',import.meta.url);
export const fundingLifecycleEnrollmentSQL="INSERT INTO funding_private.provider_lifecycle_enrollment VALUES(true,'synthetic_closed_fixture','d0000000-0000-0000-0000-000000000001',true)";

export const fundingLifecycleReplayMigration=new URL('../../supabase/migrations/20261004125949_funding_lifecycle_replay.sql',import.meta.url);
