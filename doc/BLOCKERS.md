# Blockers

- Active: `investment` policy evaluation is only partially grounded in schema. The current `PolicyContext.investment` contract has no currency, and `public.investments` has no issuer/counterparty reference, so investment amount/concentration rules currently fall back to organization-base-currency math and generic treasury counterparty exposure instead of instrument-specific issuer concentration.
- Active: `covenant_ratio_breached` depends on structured JSON in `public.debt_facilities.covenant_summary`. The evaluator currently expects either `ratios.<ratio>.{actual,max|min}` or a `breachedRatios[]` marker; without a normalized covenant schema, policy evaluation cannot guarantee facility-to-facility consistency.
