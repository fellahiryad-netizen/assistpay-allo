-- AssistPay sur Supabase : fermer l'accès aux tables par l'API publique de Supabase.
-- L'application se connecte directement à PostgreSQL (rôle propriétaire) : elle n'est pas concernée.
-- À exécuter une fois dans Supabase > SQL Editor, après la création des tables (et à relancer après une nouvelle migration).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
    END IF;
  END LOOP;
END $$;
