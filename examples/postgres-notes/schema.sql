-- System under test: owner-scoped notes protected by Row Level Security.
-- Applied by the bootstrap superuser to a freshly created, disposable database.
-- Roles aal_owner (table owner) and aal_app (application role) are created by the adapter beforehand.
BEGIN;

CREATE SCHEMA app AUTHORIZATION aal_owner;

-- Test identity helper: reads the per-transaction identity set by the test adapter.
-- This is a test mechanism, not a production authentication integration.
CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.current_user_id', true), '') $$;
ALTER FUNCTION app.current_user_id() OWNER TO aal_owner;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO aal_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO aal_app;

CREATE TABLE public.notes (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  body text NOT NULL
);
ALTER TABLE public.notes OWNER TO aal_owner;

INSERT INTO public.notes (id, owner_id, body) VALUES
  ('note-a', 'alice', 'Alice''s private note'),
  ('note-b', 'bob', 'Bob''s private note');

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
-- FORCE so that the table owner is also subject to the policies.
ALTER TABLE public.notes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.notes FROM PUBLIC;
GRANT SELECT, UPDATE ON public.notes TO aal_app;

CREATE POLICY notes_select_own ON public.notes
  FOR SELECT TO aal_app
  USING (owner_id = app.current_user_id());

CREATE POLICY notes_update_own ON public.notes
  FOR UPDATE TO aal_app
  USING (owner_id = app.current_user_id())
  WITH CHECK (owner_id = app.current_user_id());

COMMIT;
