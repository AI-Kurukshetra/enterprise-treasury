BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. risk_alerts table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.risk_alerts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  risk_type            text NOT NULL CHECK (length(trim(risk_type)) > 0),
  severity             text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  title                text NOT NULL CHECK (length(trim(title)) > 0),
  message              text NOT NULL,
  related_entity_type  text,
  related_entity_id    uuid,
  status               text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  resolved_at          timestamptz,
  resolved_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_org_status
  ON public.risk_alerts (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_org_type
  ON public.risk_alerts (organization_id, risk_type, status);

ALTER TABLE public.risk_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY risk_alerts_service_role ON public.risk_alerts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY risk_alerts_org_member ON public.risk_alerts
  FOR ALL USING (is_org_member(auth.uid(), organization_id))
  WITH CHECK (is_org_member(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_risk_alerts_set_updated_at ON public.risk_alerts;
CREATE TRIGGER trg_risk_alerts_set_updated_at
  BEFORE UPDATE ON public.risk_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. report_cash_summary RPC
--    Returns a JSON object matching CashSummaryReport
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_cash_summary(
  p_organization_id uuid,
  p_period_start    text,
  p_period_end      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accounts        jsonb;
  v_cash_flows      jsonb;
  v_tx_stats        jsonb;
  v_counterparties  jsonb;
BEGIN
  -- Account opening/closing balances from cash_positions snapshots
  SELECT jsonb_agg(
    jsonb_build_object(
      'accountId',                  ba.id,
      'accountName',                ba.account_name,
      'accountNumberMasked',        ba.account_number_masked,
      'currencyCode',               ba.currency_code::text,
      'countryCode',                ba.country_code::text,
      'openingBalance',             COALESCE(cp_open.current_balance, 0)::text,
      'closingBalance',             COALESCE(cp_close.available_balance, 0)::text,
      'openingAvailableBalance',    COALESCE(cp_open.available_balance, 0)::text,
      'closingAvailableBalance',    COALESCE(cp_close.available_balance, 0)::text,
      'netMovement',                (COALESCE(cp_close.available_balance, 0) - COALESCE(cp_open.available_balance, 0))::text
    )
  )
  INTO v_accounts
  FROM public.bank_accounts ba
  LEFT JOIN LATERAL (
    SELECT available_balance, current_balance
    FROM public.cash_positions
    WHERE organization_id = p_organization_id
      AND scope_id = ba.id
      AND scope_type = 'account'
      AND as_of_at::date <= p_period_start::date
    ORDER BY as_of_at DESC LIMIT 1
  ) cp_open ON true
  LEFT JOIN LATERAL (
    SELECT available_balance, current_balance
    FROM public.cash_positions
    WHERE organization_id = p_organization_id
      AND scope_id = ba.id
      AND scope_type = 'account'
      AND as_of_at::date <= p_period_end::date
    ORDER BY as_of_at DESC LIMIT 1
  ) cp_close ON true
  WHERE ba.organization_id = p_organization_id
    AND ba.status = 'active';

  -- Net cash flow by currency from transactions
  SELECT jsonb_agg(
    jsonb_build_object(
      'currencyCode',  currency_code::text,
      'inflows',       inflows::text,
      'outflows',      outflows::text,
      'netCashFlow',   (inflows - outflows)::text
    )
  )
  INTO v_cash_flows
  FROM (
    SELECT
      currency_code,
      SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END)  AS inflows,
      SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END) AS outflows
    FROM public.transactions
    WHERE organization_id = p_organization_id
      AND booking_date >= p_period_start::date
      AND booking_date <= p_period_end::date
    GROUP BY currency_code
  ) t;

  -- Transaction statistics by currency
  SELECT jsonb_agg(
    jsonb_build_object(
      'currencyCode',           currency_code::text,
      'transactionCount',       tx_count,
      'averageTransactionSize', avg_size::text
    )
  )
  INTO v_tx_stats
  FROM (
    SELECT
      currency_code,
      COUNT(*)        AS tx_count,
      AVG(amount)     AS avg_size
    FROM public.transactions
    WHERE organization_id = p_organization_id
      AND booking_date >= p_period_start::date
      AND booking_date <= p_period_end::date
    GROUP BY currency_code
  ) t;

  -- Top counterparties by volume (top 10)
  SELECT jsonb_agg(
    jsonb_build_object(
      'counterpartyId',    agg.counterparty_id,
      'counterpartyName',  COALESCE(c.name, 'Unknown'),
      'rankedVolume',      agg.total_volume::text,
      'transactionCount',  agg.tx_count,
      'currencyBreakdown', agg.currency_breakdown
    )
  )
  INTO v_counterparties
  FROM (
    SELECT
      top_cp.counterparty_id,
      top_cp.total_volume,
      top_cp.tx_count,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'currencyCode',     sub.currency_code::text,
          'totalVolume',      sub.vol::text,
          'transactionCount', sub.cnt
        ))
        FROM (
          SELECT currency_code, SUM(amount) AS vol, COUNT(*) AS cnt
          FROM public.transactions
          WHERE organization_id = p_organization_id
            AND counterparty_id = top_cp.counterparty_id
            AND booking_date >= p_period_start::date
            AND booking_date <= p_period_end::date
          GROUP BY currency_code
        ) sub
      ) AS currency_breakdown
    FROM (
      SELECT counterparty_id, SUM(amount) AS total_volume, COUNT(*) AS tx_count
      FROM public.transactions
      WHERE organization_id = p_organization_id
        AND counterparty_id IS NOT NULL
        AND booking_date >= p_period_start::date
        AND booking_date <= p_period_end::date
      GROUP BY counterparty_id
      ORDER BY total_volume DESC
      LIMIT 10
    ) top_cp
  ) agg
  LEFT JOIN public.counterparties c ON c.id = agg.counterparty_id
    AND c.organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'generatedAt',          now()::text,
    'periodStart',          p_period_start,
    'periodEnd',            p_period_end,
    'accounts',             COALESCE(v_accounts, '[]'::jsonb),
    'netCashFlowByCurrency', COALESCE(v_cash_flows, '[]'::jsonb),
    'transactionStatistics', COALESCE(v_tx_stats, '[]'::jsonb),
    'topCounterparties',    COALESCE(v_counterparties, '[]'::jsonb)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. report_liquidity RPC
--    Returns a JSON object matching LiquidityReport
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_liquidity(
  p_organization_id uuid,
  p_as_of           text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accounts         jsonb;
  v_pools            jsonb;
  v_runway           jsonb;
  v_trapped          jsonb;
  v_base_currency    text;
  v_total_available  numeric(20,6) := 0;
  v_daily_burn       numeric(20,6) := 0;
  v_days_of_runway   numeric;
BEGIN
  -- Get org base currency
  SELECT base_currency::text INTO v_base_currency
  FROM public.organizations WHERE id = p_organization_id;

  v_base_currency := COALESCE(v_base_currency, 'USD');

  -- Available liquidity by account
  SELECT jsonb_agg(
    jsonb_build_object(
      'accountId',           ba.id,
      'accountName',         ba.account_name,
      'accountNumberMasked', ba.account_number_masked,
      'currencyCode',        ba.currency_code::text,
      'countryCode',         ba.country_code::text,
      'region',              COALESCE(ba.country_code::text, 'Unknown'),
      'availableBalance',    COALESCE(cp.available_balance, 0)::text,
      'currentBalance',      COALESCE(cp.current_balance, 0)::text,
      'positionTimestamp',   cp.as_of_at::text
    )
  )
  INTO v_accounts
  FROM public.bank_accounts ba
  LEFT JOIN LATERAL (
    SELECT available_balance, current_balance, as_of_at
    FROM public.cash_positions
    WHERE organization_id = p_organization_id
      AND scope_id = ba.id
      AND scope_type = 'account'
      AND as_of_at <= p_as_of::timestamptz
    ORDER BY as_of_at DESC LIMIT 1
  ) cp ON true
  WHERE ba.organization_id = p_organization_id
    AND ba.status = 'active';

  -- Liquidity pools with composition
  SELECT jsonb_agg(
    jsonb_build_object(
      'poolId',               lp.id,
      'name',                 lp.name,
      'poolType',             lp.pool_type::text,
      'baseCurrency',         lp.base_currency::text,
      'accountCount',         COALESCE(pool_data.account_count, 0),
      'totalAvailableBalance', COALESCE(pool_data.total_available, 0)::text,
      'totalCurrentBalance',  COALESCE(pool_data.total_current, 0)::text,
      'composition',          COALESCE(pool_data.composition, '[]'::jsonb)
    )
  )
  INTO v_pools
  FROM public.liquidity_pools lp
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                           AS account_count,
      SUM(COALESCE(cp.available_balance, 0)) AS total_available,
      SUM(COALESCE(cp.current_balance, 0))   AS total_current,
      jsonb_agg(jsonb_build_object(
        'accountId',       ba.id,
        'accountName',     ba.account_name,
        'currencyCode',    ba.currency_code::text,
        'availableBalance', COALESCE(cp.available_balance, 0)::text,
        'currentBalance',  COALESCE(cp.current_balance, 0)::text
      )) AS composition
    FROM public.liquidity_pool_accounts lpa
    JOIN public.bank_accounts ba ON ba.id = lpa.bank_account_id
    LEFT JOIN LATERAL (
      SELECT available_balance, current_balance
      FROM public.cash_positions
      WHERE organization_id = p_organization_id
        AND scope_id = ba.id
        AND scope_type = 'account'
        AND as_of_at <= p_as_of::timestamptz
      ORDER BY as_of_at DESC LIMIT 1
    ) cp ON true
    WHERE lpa.liquidity_pool_id = lp.id
  ) pool_data ON true
  WHERE lp.organization_id = p_organization_id;

  -- Runway: total org available balance and 30-day average daily outflow
  SELECT COALESCE(available_balance, 0)
  INTO v_total_available
  FROM public.cash_positions_latest
  WHERE organization_id = p_organization_id
    AND scope_type = 'organization'
    AND currency_code::text = v_base_currency
  LIMIT 1;

  SELECT COALESCE(SUM(amount) / 30.0, 0)
  INTO v_daily_burn
  FROM public.transactions
  WHERE organization_id = p_organization_id
    AND direction = 'outflow'
    AND currency_code::text = v_base_currency
    AND booking_date >= (p_as_of::date - INTERVAL '30 days');

  IF v_daily_burn > 0 THEN
    v_days_of_runway := ROUND(v_total_available / v_daily_burn);
  ELSE
    v_days_of_runway := NULL;
  END IF;

  v_runway := jsonb_build_object(
    'baseCurrency',    v_base_currency,
    'availableBalance', v_total_available::text,
    'dailyBurnRate',   v_daily_burn::text,
    'daysOfRunway',    v_days_of_runway
  );

  -- Trapped cash: accounts with balance but in restricted countries (simplified)
  SELECT jsonb_agg(
    jsonb_build_object(
      'region',         COALESCE(ba.country_code::text, 'Unknown'),
      'currencyCode',   ba.currency_code::text,
      'reason',         'cross_border_restriction',
      'trappedBalance', COALESCE(cp.available_balance, 0)::text
    )
  )
  INTO v_trapped
  FROM public.bank_accounts ba
  LEFT JOIN LATERAL (
    SELECT available_balance
    FROM public.cash_positions
    WHERE organization_id = p_organization_id
      AND scope_id = ba.id
      AND scope_type = 'account'
      AND as_of_at <= p_as_of::timestamptz
    ORDER BY as_of_at DESC LIMIT 1
  ) cp ON true
  WHERE ba.organization_id = p_organization_id
    AND ba.status = 'active'
    AND ba.currency_code::text != v_base_currency
    AND COALESCE(cp.available_balance, 0) > 0;

  RETURN jsonb_build_object(
    'generatedAt',              now()::text,
    'asOf',                     p_as_of,
    'availableLiquidityByAccount', COALESCE(v_accounts, '[]'::jsonb),
    'liquidityPools',           COALESCE(v_pools, '[]'::jsonb),
    'runway',                   v_runway,
    'trappedCashByRegion',      COALESCE(v_trapped, '[]'::jsonb)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. report_compliance_package RPC
--    Returns a JSON payload with compliance data
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_compliance_package(
  p_organization_id uuid,
  p_period_start    text,
  p_period_end      text,
  p_report_type     text DEFAULT 'audit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_name        text;
  v_tx_summary      jsonb;
  v_payment_summary jsonb;
  v_audit_events    jsonb;
BEGIN
  SELECT name INTO v_org_name FROM public.organizations WHERE id = p_organization_id;

  -- Transaction summary for compliance
  SELECT jsonb_build_object(
    'totalTransactions', COUNT(*),
    'totalInflow',       SUM(CASE WHEN direction='inflow'  THEN amount ELSE 0 END)::text,
    'totalOutflow',      SUM(CASE WHEN direction='outflow' THEN amount ELSE 0 END)::text,
    'currencies',        jsonb_agg(DISTINCT currency_code::text)
  )
  INTO v_tx_summary
  FROM public.transactions
  WHERE organization_id = p_organization_id
    AND booking_date >= p_period_start::date
    AND booking_date <= p_period_end::date;

  -- Payment summary for compliance
  SELECT jsonb_build_object(
    'totalPayments',   COUNT(*),
    'totalAmount',     COALESCE(SUM(amount), 0)::text,
    'approvedCount',   COUNT(*) FILTER (WHERE status = 'approved'),
    'rejectedCount',   COUNT(*) FILTER (WHERE status = 'rejected'),
    'pendingCount',    COUNT(*) FILTER (WHERE status = 'pending_approval')
  )
  INTO v_payment_summary
  FROM public.payments
  WHERE organization_id = p_organization_id
    AND created_at::date >= p_period_start::date
    AND created_at::date <= p_period_end::date;

  -- Recent audit log events
  SELECT jsonb_agg(
    jsonb_build_object(
      'action',     al.action,
      'entityType', al.entity_type,
      'actorId',    al.user_id,
      'timestamp',  al.created_at::text
    )
    ORDER BY al.created_at DESC
  )
  INTO v_audit_events
  FROM public.audit_logs al
  WHERE al.organization_id = p_organization_id
    AND al.created_at::date >= p_period_start::date
    AND al.created_at::date <= p_period_end::date
  LIMIT 200;

  RETURN jsonb_build_object(
    'reportType',       p_report_type,
    'organizationId',   p_organization_id,
    'organizationName', v_org_name,
    'periodStart',      p_period_start,
    'periodEnd',        p_period_end,
    'generatedAt',      now()::text,
    'transactionSummary', COALESCE(v_tx_summary, '{}'::jsonb),
    'paymentSummary',   COALESCE(v_payment_summary, '{}'::jsonb),
    'auditEvents',      COALESCE(v_audit_events, '[]'::jsonb)
  );
END;
$$;

COMMIT;
