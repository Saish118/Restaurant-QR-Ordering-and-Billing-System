-- Product mode is a platform entitlement. A restaurant owner cannot change it.
CREATE FUNCTION public.protect_platform_entitlement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 IF current_user = 'restaurant_app' AND current_setting('app.is_admin',true) IS DISTINCT FROM 'true' THEN
  IF TG_TABLE_NAME = 'subscriptions' THEN
   RAISE EXCEPTION 'Only platform administrators can change product access' USING ERRCODE='42501';
  END IF;
  IF (TG_OP='INSERT' AND NEW.qr_ordering_enabled) OR (TG_OP='UPDATE' AND NEW.qr_ordering_enabled IS DISTINCT FROM OLD.qr_ordering_enabled) THEN
   RAISE EXCEPTION 'Only platform administrators can change product access' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_platform_entitlement() FROM PUBLIC;
CREATE TRIGGER protect_qr_entitlement BEFORE INSERT OR UPDATE OF qr_ordering_enabled ON public.restaurant_settings FOR EACH ROW EXECUTE FUNCTION public.protect_platform_entitlement();
CREATE TRIGGER protect_subscription_entitlement BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.protect_platform_entitlement();
ALTER TABLE public.menu_categories ADD CONSTRAINT category_name_length CHECK(length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE public.menu_items ADD CONSTRAINT item_name_length CHECK(length(btrim(name)) BETWEEN 1 AND 160);
ALTER TABLE public.tables ADD CONSTRAINT table_label_length CHECK(length(btrim(label)) BETWEEN 1 AND 60);
