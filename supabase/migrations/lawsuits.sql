-- Tabela de processos judiciais formais (CNJ DataJud: STF, STJ, TRFs)
-- Separada de 'scandals' (notícias) para exibição diferenciada no dossiê

CREATE TABLE IF NOT EXISTS public.lawsuits (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  politician_id   UUID         NOT NULL REFERENCES public.politicians(id) ON DELETE CASCADE,
  court           TEXT         NOT NULL,          -- "STF", "STJ", "TRF-1", etc.
  process_number  TEXT         NOT NULL DEFAULT '',
  description     TEXT         NOT NULL DEFAULT '',
  status          TEXT         NOT NULL DEFAULT 'Em andamento',
  news_url        TEXT,                           -- link para portal do tribunal (pode ser null)
  date_judgment   TEXT         NOT NULL DEFAULT '',  -- YYYY-MM-DD
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lawsuits_politician_id_idx ON public.lawsuits (politician_id);
CREATE INDEX IF NOT EXISTS lawsuits_process_number_idx ON public.lawsuits (process_number);

-- RLS: leitura pública, escrita somente service role
ALTER TABLE public.lawsuits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lawsuits_read_public"
  ON public.lawsuits FOR SELECT
  USING (true);

CREATE POLICY "lawsuits_insert_service"
  ON public.lawsuits FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lawsuits_update_service"
  ON public.lawsuits FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "lawsuits_delete_service"
  ON public.lawsuits FOR DELETE
  USING (auth.role() = 'service_role');
