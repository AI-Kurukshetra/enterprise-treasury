BEGIN;

CREATE TABLE IF NOT EXISTS public.currency_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency public.currency_code NOT NULL,
  quote_currency public.currency_code NOT NULL,
  rate numeric(20,8) NOT NULL CHECK (rate > 0),
  as_of_at timestamptz NOT NULL,
  provider text NOT NULL CHECK (length(trim(provider)) > 0),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_currency_rates_pair CHECK (base_currency <> quote_currency)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_currency_rates_pair_provider_asof
  ON public.currency_rates (base_currency, quote_currency, provider, as_of_at);

CREATE INDEX IF NOT EXISTS idx_currency_rates_as_of
  ON public.currency_rates (as_of_at DESC);

CREATE INDEX IF NOT EXISTS idx_currency_rates_pair_as_of
  ON public.currency_rates (base_currency, quote_currency, as_of_at DESC);

DROP TRIGGER IF EXISTS trg_currency_rates_set_updated_at ON public.currency_rates;
CREATE TRIGGER trg_currency_rates_set_updated_at
BEFORE UPDATE ON public.currency_rates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.currency_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.currency_rates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS currency_rates_service_role_all ON public.currency_rates;
CREATE POLICY currency_rates_service_role_all ON public.currency_rates
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS currency_rates_authenticated_select ON public.currency_rates;
CREATE POLICY currency_rates_authenticated_select ON public.currency_rates
  FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

COMMIT;
