-- Permissões para o painel admin (anon key via frontend)
-- Execute este SQL no Supabase → SQL Editor

-- ── POLITICIANS ──────────────────────────────────────────────────────────────
ALTER TABLE public.politicians ENABLE ROW LEVEL SECURITY;

-- Leitura pública (já deve existir)
DROP POLICY IF EXISTS "politicians_read_public" ON public.politicians;
CREATE POLICY "politicians_read_public"
  ON public.politicians FOR SELECT USING (true);

-- Admin pode inserir, atualizar e deletar via anon key
DROP POLICY IF EXISTS "politicians_insert_anon" ON public.politicians;
CREATE POLICY "politicians_insert_anon"
  ON public.politicians FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "politicians_update_anon" ON public.politicians;
CREATE POLICY "politicians_update_anon"
  ON public.politicians FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "politicians_delete_anon" ON public.politicians;
CREATE POLICY "politicians_delete_anon"
  ON public.politicians FOR DELETE USING (true);

-- ── SCANDALS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.scandals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scandals_read_public" ON public.scandals;
CREATE POLICY "scandals_read_public"
  ON public.scandals FOR SELECT USING (true);

DROP POLICY IF EXISTS "scandals_insert_anon" ON public.scandals;
CREATE POLICY "scandals_insert_anon"
  ON public.scandals FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "scandals_update_anon" ON public.scandals;
CREATE POLICY "scandals_update_anon"
  ON public.scandals FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "scandals_delete_anon" ON public.scandals;
CREATE POLICY "scandals_delete_anon"
  ON public.scandals FOR DELETE USING (true);

-- ── LAWSUITS ─────────────────────────────────────────────────────────────────
-- (se a tabela lawsuits já foi criada)
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lawsuits') THEN
    DROP POLICY IF EXISTS "lawsuits_insert_anon" ON public.lawsuits;
    EXECUTE 'CREATE POLICY lawsuits_insert_anon ON public.lawsuits FOR INSERT WITH CHECK (true)';
    DROP POLICY IF EXISTS "lawsuits_update_anon" ON public.lawsuits;
    EXECUTE 'CREATE POLICY lawsuits_update_anon ON public.lawsuits FOR UPDATE USING (true) WITH CHECK (true)';
    DROP POLICY IF EXISTS "lawsuits_delete_anon" ON public.lawsuits;
    EXECUTE 'CREATE POLICY lawsuits_delete_anon ON public.lawsuits FOR DELETE USING (true)';
  END IF;
END $$;
