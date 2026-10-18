-- Cache request context once per statement rather than evaluating it per row.
DO $$ DECLARE p record; u text; c text; stmt text; BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' AND 'restaurant_app'=ANY(roles) LOOP
  u := regexp_replace(p.qual, 'current_setting\(([^)]+)\)', '(SELECT current_setting(\1))', 'g');
  c := regexp_replace(p.with_check, 'current_setting\(([^)]+)\)', '(SELECT current_setting(\1))', 'g');
  stmt := format('ALTER POLICY %I ON public.%I',p.policyname,p.tablename);
  IF u IS NOT NULL THEN stmt := stmt || ' USING (' || u || ')'; END IF;
  IF c IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || c || ')'; END IF;
  EXECUTE stmt;
 END LOOP;
END $$;
