CREATE INDEX restaurant_activity_user_idx ON public.restaurant_activity(user_id);
CREATE INDEX receipts_recorded_by_idx ON public.subscription_receipts(recorded_by);
DROP POLICY admin_directory ON public.platform_admins;
ALTER POLICY own_admin ON public.platform_admins USING(user_id=nullif((SELECT current_setting('app.user_id',true)),'')::uuid OR (SELECT current_setting('app.is_admin',true))='true');
