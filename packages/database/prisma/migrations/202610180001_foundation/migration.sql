-- Run only as migration owner. Runtime connects as restaurant_app (NOBYPASSRLS).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'restaurant_app') THEN
  CREATE ROLE restaurant_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE TYPE restaurant_status AS ENUM ('TRIAL','ACTIVE','SUSPENDED','CLOSED');
CREATE TYPE restaurant_role AS ENUM ('OWNER','WAITER','CHEF');
CREATE TYPE session_status AS ENUM ('OPEN','BILLING','CLOSED','CANCELLED');
CREATE TYPE order_status AS ENUM ('NEW','READY','SERVED','CANCELLED');
CREATE TYPE order_source AS ENUM ('STAFF','QR');
CREATE TYPE payment_status AS ENUM ('PENDING','PAID','FAILED','REFUNDED');
CREATE TABLE users (
 id uuid PRIMARY KEY, -- Supabase auth subject, intentionally no auth-schema dependency
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_admins (user_id uuid PRIMARY KEY REFERENCES users(id), active boolean NOT NULL DEFAULT true);
CREATE TABLE restaurants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 status restaurant_status NOT NULL DEFAULT 'TRIAL', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE restaurant_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id),
 user_id uuid NOT NULL REFERENCES users(id), role restaurant_role NOT NULL, active boolean NOT NULL DEFAULT true,
 UNIQUE(restaurant_id,user_id), UNIQUE(restaurant_id,id)
);
CREATE INDEX restaurant_users_user_idx ON restaurant_users(user_id,active);
CREATE TABLE restaurant_settings (
 restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id), qr_ordering_enabled boolean NOT NULL DEFAULT false,
 currency char(3) NOT NULL DEFAULT 'INR', address text, logo_path text, gst_number text,
 waiter_all_tables boolean NOT NULL DEFAULT true, customer_bill_visible boolean NOT NULL DEFAULT false
);
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL UNIQUE REFERENCES restaurants(id),
 plan text NOT NULL DEFAULT 'PILOT', trial_ends_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id),
 name text NOT NULL, role restaurant_role NOT NULL CHECK(role IN ('WAITER','CHEF')),
 pin_hash text NOT NULL, active boolean NOT NULL DEFAULT true, session_version integer NOT NULL DEFAULT 1,
 failed_attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 UNIQUE(restaurant_id,id)
);
CREATE TABLE staff_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), staff_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, version integer NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 FOREIGN KEY (restaurant_id,staff_id) REFERENCES staff(restaurant_id,id)
);
CREATE INDEX staff_sessions_tenant_idx ON staff_sessions(restaurant_id,staff_id);
CREATE TABLE tables (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id),
 label text NOT NULL, qr_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE, active boolean NOT NULL DEFAULT true,
 UNIQUE(restaurant_id,id), UNIQUE(restaurant_id,label)
);
CREATE TABLE menu_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id),
 name text NOT NULL, sort_order integer NOT NULL DEFAULT 0, UNIQUE(restaurant_id,id)
);
CREATE TABLE menu_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), category_id uuid NOT NULL,
 name text NOT NULL, price_minor integer NOT NULL CHECK(price_minor>=0), tax_bps integer NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000),
 available boolean NOT NULL DEFAULT true, vegetarian boolean NOT NULL DEFAULT true, special boolean NOT NULL DEFAULT false,
 UNIQUE(restaurant_id,id), FOREIGN KEY(restaurant_id,category_id) REFERENCES menu_categories(restaurant_id,id)
);
CREATE INDEX menu_items_category_idx ON menu_items(restaurant_id,category_id);
CREATE TABLE dining_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), table_id uuid NOT NULL,
 status session_status NOT NULL DEFAULT 'OPEN', version integer NOT NULL DEFAULT 1,
 opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 UNIQUE(restaurant_id,id), FOREIGN KEY(restaurant_id,table_id) REFERENCES tables(restaurant_id,id),
 CHECK ((status IN ('CLOSED','CANCELLED')) = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_live_session_per_table ON dining_sessions(restaurant_id,table_id) WHERE status IN ('OPEN','BILLING');
CREATE TABLE guest_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), dining_session_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 FOREIGN KEY(restaurant_id,dining_session_id) REFERENCES dining_sessions(restaurant_id,id)
);
CREATE INDEX guest_capabilities_session_idx ON guest_capabilities(restaurant_id,dining_session_id);
CREATE TABLE orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), dining_session_id uuid NOT NULL,
 source order_source NOT NULL, status order_status NOT NULL DEFAULT 'NEW', idempotency_key uuid NOT NULL,
 request_hash text NOT NULL, actor_type text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(restaurant_id,id), UNIQUE(restaurant_id,dining_session_id,idempotency_key),
 FOREIGN KEY(restaurant_id,dining_session_id) REFERENCES dining_sessions(restaurant_id,id)
);
CREATE INDEX orders_session_idx ON orders(restaurant_id,dining_session_id,created_at);
CREATE INDEX orders_kitchen_idx ON orders(restaurant_id,status,created_at);
CREATE TABLE order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), order_id uuid NOT NULL, menu_item_id uuid NOT NULL,
 name_snapshot text NOT NULL, unit_price_minor integer NOT NULL CHECK(unit_price_minor>=0), tax_bps_snapshot integer NOT NULL CHECK(tax_bps_snapshot BETWEEN 0 AND 10000),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999), notes text CHECK(length(notes)<=500), status order_status NOT NULL DEFAULT 'NEW',
 UNIQUE(restaurant_id,id), FOREIGN KEY(restaurant_id,order_id) REFERENCES orders(restaurant_id,id),
 FOREIGN KEY(restaurant_id,menu_item_id) REFERENCES menu_items(restaurant_id,id)
);
CREATE INDEX order_items_order_idx ON order_items(restaurant_id,order_id);
CREATE INDEX order_items_menu_idx ON order_items(restaurant_id,menu_item_id);
CREATE TABLE bills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), dining_session_id uuid NOT NULL,
 subtotal_minor bigint NOT NULL DEFAULT 0 CHECK(subtotal_minor>=0), tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor>=0),
 total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor>=0), finalized_at timestamptz,
 UNIQUE(restaurant_id,id), UNIQUE(restaurant_id,dining_session_id),
 FOREIGN KEY(restaurant_id,dining_session_id) REFERENCES dining_sessions(restaurant_id,id), CHECK(total_minor=subtotal_minor+tax_minor)
);
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), bill_id uuid NOT NULL,
 status payment_status NOT NULL DEFAULT 'PENDING', amount_minor bigint NOT NULL CHECK(amount_minor>0),
 method text NOT NULL CHECK(method IN ('CASH','MANUAL_UPI')), reference text, recorded_by uuid NOT NULL,
 FOREIGN KEY(restaurant_id,bill_id) REFERENCES bills(restaurant_id,id)
);
CREATE INDEX payments_bill_idx ON payments(restaurant_id,bill_id);
CREATE TABLE service_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid NOT NULL REFERENCES restaurants(id), dining_session_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('SERVICE','BILL')), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(restaurant_id,dining_session_id) REFERENCES dining_sessions(restaurant_id,id)
);
CREATE INDEX service_requests_session_idx ON service_requests(restaurant_id,dining_session_id);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id uuid REFERENCES restaurants(id), actor_id uuid NOT NULL,
 action text NOT NULL, target_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs(restaurant_id,created_at);
GRANT USAGE ON SCHEMA public TO restaurant_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO restaurant_app;
REVOKE UPDATE ON audit_logs FROM restaurant_app;
-- No client Data API access to business tables. Realtime will use authorized private broadcasts.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated; END IF;
END $$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY own_identity ON users FOR SELECT TO restaurant_app USING(id = nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.is_admin',true)='true');
CREATE POLICY admin_create_identity ON users FOR INSERT TO restaurant_app WITH CHECK(current_setting('app.is_admin',true)='true');
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY; ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY own_admin ON platform_admins FOR SELECT TO restaurant_app USING(user_id = nullif(current_setting('app.user_id',true),'')::uuid);
ALTER TABLE restaurant_users ENABLE ROW LEVEL SECURITY; ALTER TABLE restaurant_users FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON restaurant_users FOR SELECT TO restaurant_app USING(user_id=nullif(current_setting('app.user_id',true),'')::uuid OR current_setting('app.is_admin',true)='true' OR (restaurant_id=nullif(current_setting('app.restaurant_id',true),'')::uuid AND current_setting('app.role',true)='OWNER'));
CREATE POLICY memberships_create ON restaurant_users FOR INSERT TO restaurant_app WITH CHECK(current_setting('app.is_admin',true)='true');
CREATE POLICY memberships_update ON restaurant_users FOR UPDATE TO restaurant_app USING(current_setting('app.is_admin',true)='true') WITH CHECK(current_setting('app.is_admin',true)='true');
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY; ALTER TABLE restaurants FORCE ROW LEVEL SECURITY;
CREATE POLICY restaurants_read ON restaurants FOR SELECT TO restaurant_app USING(current_setting('app.is_admin',true)='true' OR EXISTS(SELECT 1 FROM restaurant_users m WHERE m.restaurant_id=restaurants.id AND m.user_id=nullif(current_setting('app.user_id',true),'')::uuid AND m.active));
CREATE POLICY restaurants_create ON restaurants FOR INSERT TO restaurant_app WITH CHECK(current_setting('app.is_admin',true)='true');
CREATE POLICY restaurants_update ON restaurants FOR UPDATE TO restaurant_app USING(current_setting('app.is_admin',true)='true') WITH CHECK(current_setting('app.is_admin',true)='true');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['restaurant_settings','subscriptions','staff','staff_sessions','tables','menu_categories','menu_items','dining_sessions','guest_capabilities','orders','order_items','bills','payments','service_requests','audit_logs'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON %I TO restaurant_app USING (current_setting(''app.is_admin'',true)=''true'' OR (restaurant_id=nullif(current_setting(''app.restaurant_id'',true),'''')::uuid AND current_setting(''app.role'',true) IN (''OWNER'',''WAITER'',''CHEF''))) WITH CHECK (current_setting(''app.is_admin'',true)=''true'' OR (restaurant_id=nullif(current_setting(''app.restaurant_id'',true),'''')::uuid AND current_setting(''app.role'',true) IN (''OWNER'',''WAITER'',''CHEF'')))',t);
 END LOOP;
END $$;
