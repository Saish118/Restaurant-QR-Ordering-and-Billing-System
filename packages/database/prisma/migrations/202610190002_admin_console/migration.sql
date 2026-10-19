ALTER TABLE public.users ADD COLUMN email text, ADD COLUMN auth_not_before timestamptz;
ALTER TABLE public.restaurants ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.restaurant_settings ADD COLUMN contact_phone text, ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Kolkata', ADD COLUMN feature_flags jsonb NOT NULL DEFAULT '{"waiter_portal":true,"kitchen_portal":true,"online_payments":false,"gst_billing":false,"whatsapp_sms":false,"advanced_reports":false}';
ALTER TABLE public.restaurant_settings ADD CONSTRAINT feature_flags_object CHECK(jsonb_typeof(feature_flags)='object');
ALTER TABLE public.subscriptions
 ADD COLUMN setup_amount_minor integer NOT NULL DEFAULT 0 CHECK(setup_amount_minor>=0),
 ADD COLUMN recurring_amount_minor integer NOT NULL DEFAULT 0 CHECK(recurring_amount_minor>=0),
 ADD COLUMN billing_cycle text NOT NULL DEFAULT 'MONTHLY' CHECK(billing_cycle IN ('MONTHLY','YEARLY')),
 ADD COLUMN payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('PAID','UNPAID')),
 ADD COLUMN trial_started_at timestamptz,
 ADD COLUMN expires_at timestamptz;
CREATE INDEX orders_platform_date_idx ON public.orders(created_at);
CREATE INDEX restaurants_created_idx ON public.restaurants(created_at);
CREATE POLICY admin_update_identity ON public.users FOR UPDATE TO restaurant_app USING((SELECT current_setting('app.is_admin',true))='true') WITH CHECK((SELECT current_setting('app.is_admin',true))='true');
CREATE TABLE public.subscription_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 amount_minor integer NOT NULL CHECK(amount_minor>0),kind text NOT NULL CHECK(kind IN ('SETUP','RECURRING')),
 paid_at timestamptz NOT NULL DEFAULT now(),recorded_by uuid NOT NULL REFERENCES public.users(id),
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,voided_at timestamptz,void_reason text,
 UNIQUE(restaurant_id,idempotency_key)
);
CREATE INDEX receipts_month_idx ON public.subscription_receipts(paid_at) WHERE voided_at IS NULL;
CREATE TABLE public.restaurant_activity (
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),user_id uuid NOT NULL REFERENCES public.users(id),
 last_seen_at timestamptz NOT NULL DEFAULT now(),last_login_at timestamptz,PRIMARY KEY(restaurant_id,user_id)
);
CREATE TABLE public.error_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,route text NOT NULL,request_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_logs_date_idx ON public.error_logs(created_at DESC);
GRANT SELECT,INSERT,UPDATE ON public.subscription_receipts,public.restaurant_activity TO restaurant_app;
GRANT SELECT,INSERT ON public.error_logs TO restaurant_app;
ALTER TABLE public.subscription_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE public.subscription_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_receipts ON public.subscription_receipts TO restaurant_app USING((SELECT current_setting('app.is_admin',true))='true') WITH CHECK((SELECT current_setting('app.is_admin',true))='true');
ALTER TABLE public.restaurant_activity ENABLE ROW LEVEL SECURITY;ALTER TABLE public.restaurant_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_context ON public.restaurant_activity TO restaurant_app USING((SELECT current_setting('app.is_admin',true))='true' OR (restaurant_id=nullif((SELECT current_setting('app.restaurant_id',true)),'')::uuid AND user_id=nullif((SELECT current_setting('app.user_id',true)),'')::uuid)) WITH CHECK((SELECT current_setting('app.is_admin',true))='true' OR (restaurant_id=nullif((SELECT current_setting('app.restaurant_id',true)),'')::uuid AND user_id=nullif((SELECT current_setting('app.user_id',true)),'')::uuid));
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;ALTER TABLE public.error_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY errors_read ON public.error_logs FOR SELECT TO restaurant_app USING((SELECT current_setting('app.is_admin',true))='true');
CREATE POLICY errors_append ON public.error_logs FOR INSERT TO restaurant_app WITH CHECK(true);
CREATE FUNCTION public.protect_admin_settings() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user='restaurant_app' AND current_setting('app.is_admin',true) IS DISTINCT FROM 'true' THEN
  IF TG_TABLE_NAME='restaurant_settings' THEN
   IF NEW.feature_flags IS DISTINCT FROM OLD.feature_flags THEN RAISE EXCEPTION 'Only platform admin can manage features' USING ERRCODE='42501'; END IF;
  ELSIF TG_TABLE_NAME='tables' THEN
   IF NEW.qr_reference IS DISTINCT FROM OLD.qr_reference THEN RAISE EXCEPTION 'Only platform admin can rotate QR' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_admin_settings() FROM PUBLIC;
CREATE TRIGGER admin_features BEFORE UPDATE OF feature_flags ON public.restaurant_settings FOR EACH ROW EXECUTE FUNCTION public.protect_admin_settings();
CREATE TRIGGER admin_qr_rotation BEFORE UPDATE OF qr_reference ON public.tables FOR EACH ROW EXECUTE FUNCTION public.protect_admin_settings();
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.subscription_receipts,public.restaurant_activity,public.error_logs FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.subscription_receipts,public.restaurant_activity,public.error_logs FROM authenticated; END IF;
 -- Optional hosted identity enrichment; local PostgreSQL intentionally has no auth schema.
 IF to_regclass('auth.users') IS NOT NULL THEN EXECUTE 'UPDATE public.users u SET email=a.email FROM auth.users a WHERE a.id=u.id AND u.email IS NULL'; END IF;
END $$;
-- The bootstrap read is still self-only; verified admins may then inspect operator identities.
CREATE POLICY admin_directory ON public.platform_admins FOR SELECT TO restaurant_app USING((SELECT current_setting('app.is_admin',true))='true');
