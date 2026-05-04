-- ============================================
-- CKB Assicurazione - Database Schema
-- Incolla questo SQL nel SQL Editor di Supabase
-- ============================================

-- 1. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY,
  email TEXT,
  credits INTEGER DEFAULT 100,
  plan_type TEXT DEFAULT 'free',
  full_name TEXT,
  company TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  paypal_order_id TEXT
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Service role full access profiles"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role');

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, plan_type)
  VALUES (NEW.id, NEW.email, 100, 'free')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. SEARCHES (the big one - contains all lead data)
CREATE TABLE IF NOT EXISTS public.searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  category TEXT,
  location TEXT,
  status TEXT DEFAULT 'pending',
  results JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_searches_user_id ON public.searches(user_id);
CREATE INDEX idx_searches_status ON public.searches(status);
CREATE INDEX idx_searches_category_location ON public.searches(category, location);

ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own searches"
  ON public.searches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own searches"
  ON public.searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access searches"
  ON public.searches FOR ALL
  USING (auth.role() = 'service_role');

-- 3. LEADS (cached/indexed leads)
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT,
  website TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  category TEXT,
  score INTEGER DEFAULT 0,
  raw JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_user_id ON public.leads(user_id);
CREATE INDEX idx_leads_city ON public.leads(city);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own leads"
  ON public.leads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access leads"
  ON public.leads FOR ALL
  USING (auth.role() = 'service_role');

-- 4. LEAD_ENRICHMENTS
CREATE TABLE IF NOT EXISTS public.lead_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  lead_website TEXT,
  linkedin_url TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  partita_iva TEXT,
  anno_fondazione TEXT,
  dipendenti_stimati TEXT,
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lead_enrichments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access enrichments"
  ON public.lead_enrichments FOR ALL
  USING (auth.role() = 'service_role');

-- 5. LISTS
CREATE TABLE IF NOT EXISTS public.lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own lists"
  ON public.lists FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access lists"
  ON public.lists FOR ALL
  USING (auth.role() = 'service_role');

-- 6. LIST_LEADS
CREATE TABLE IF NOT EXISTS public.list_leads (
  list_id UUID REFERENCES public.lists(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, lead_id)
);

ALTER TABLE public.list_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own list_leads"
  ON public.list_leads FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.lists
      WHERE lists.id = list_leads.list_id
      AND lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access list_leads"
  ON public.list_leads FOR ALL
  USING (auth.role() = 'service_role');

-- 7. SAVED_LEADS
CREATE TABLE IF NOT EXISTS public.saved_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  lead_data JSONB,
  search_id UUID,
  lead_index INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.saved_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own saved_leads"
  ON public.saved_leads FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access saved_leads"
  ON public.saved_leads FOR ALL
  USING (auth.role() = 'service_role');

-- 8. ENVIRONMENTS
CREATE TABLE IF NOT EXISTS public.environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'Briefcase',
  color TEXT DEFAULT 'blue',
  lead_ids JSONB DEFAULT '[]',
  search_ids JSONB DEFAULT '[]',
  filters JSONB DEFAULT '{}',
  stats JSONB DEFAULT '{}',
  is_auto_update BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.environments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own environments"
  ON public.environments FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access environments"
  ON public.environments FOR ALL
  USING (auth.role() = 'service_role');

-- 9. API_KEYS
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  requests_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own api_keys"
  ON public.api_keys FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access api_keys"
  ON public.api_keys FOR ALL
  USING (auth.role() = 'service_role');

-- 10. USER_INTEGRATIONS
CREATE TABLE IF NOT EXISTS public.user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  webhook_url TEXT,
  hubspot_access_token TEXT,
  hubspot_refresh_token TEXT,
  hubspot_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own integrations"
  ON public.user_integrations FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access integrations"
  ON public.user_integrations FOR ALL
  USING (auth.role() = 'service_role');

-- 11. LEAD_INTERACTIONS (analytics/scoring)
CREATE TABLE IF NOT EXISTS public.lead_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  lead_website TEXT,
  lead_nome TEXT,
  action TEXT,
  score_at_time INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interactions_user ON public.lead_interactions(user_id);

ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own interactions"
  ON public.lead_interactions FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access interactions"
  ON public.lead_interactions FOR ALL
  USING (auth.role() = 'service_role');

-- 12. LEAD_MONITORS
CREATE TABLE IF NOT EXISTS public.lead_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  search_id UUID,
  lead_index INTEGER,
  lead_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lead_monitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own monitors"
  ON public.lead_monitors FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access monitors"
  ON public.lead_monitors FOR ALL
  USING (auth.role() = 'service_role');

-- 13. LEAD_ALERTS (user notifications about lead events)
CREATE TABLE IF NOT EXISTS public.lead_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  lead_id TEXT,
  alert_type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_alerts_user ON public.lead_alerts(user_id);
CREATE INDEX idx_lead_alerts_unread ON public.lead_alerts(user_id, is_read) WHERE is_read = FALSE;

ALTER TABLE public.lead_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own alerts"
  ON public.lead_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts"
  ON public.lead_alerts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access alerts"
  ON public.lead_alerts FOR ALL
  USING (auth.role() = 'service_role');

-- DONE
SELECT 'All tables created successfully!' AS result;
