-- ============================================
-- Cache layer for OpenAPI.it / certified company data
-- Reduces cost by avoiding duplicate paid calls for the same P.IVA.
-- TTL: 180 days for Camera di Commercio data (changes rarely).
-- ============================================

CREATE TABLE IF NOT EXISTS public.company_lookup_cache (
  piva TEXT PRIMARY KEY,
  ragione_sociale TEXT,
  source TEXT NOT NULL,              -- 'openapi_it_advanced' | 'openapi_it_stakeholders' | 'openapi_it_pec' | 'openapi_it_search'
  payload JSONB NOT NULL,            -- full normalized result
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL    -- fetched_at + TTL (default 180 days for advanced, 30 for pec/stakeholders)
);

CREATE INDEX IF NOT EXISTS idx_company_lookup_cache_source ON public.company_lookup_cache(source);
CREATE INDEX IF NOT EXISTS idx_company_lookup_cache_expires ON public.company_lookup_cache(expires_at);

ALTER TABLE public.company_lookup_cache ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write cache (it is server-side only, never exposed to clients)
CREATE POLICY "Service role full access company_lookup_cache"
  ON public.company_lookup_cache FOR ALL
  USING (auth.role() = 'service_role');

-- Composite key needs source to allow different caches per endpoint per P.IVA
ALTER TABLE public.company_lookup_cache DROP CONSTRAINT IF EXISTS company_lookup_cache_pkey;
ALTER TABLE public.company_lookup_cache ADD PRIMARY KEY (piva, source);

-- Helper: remove expired entries (call periodically)
CREATE OR REPLACE FUNCTION public.prune_company_lookup_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM public.company_lookup_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
