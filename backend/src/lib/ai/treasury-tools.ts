export interface TreasuryToolDefinition {
  name:
    | 'get_cash_position'
    | 'get_fx_rates'
    | 'list_pending_approvals'
    | 'get_risk_summary'
    | 'get_liquidity_forecast'
    | 'get_account_transactions'
    | 'get_investment_summary'
    | 'get_debt_summary';
  description: string;
  input_schema: Record<string, unknown>;
}

export const treasuryTools: TreasuryToolDefinition[] = [
  {
    name: 'get_cash_position',
    description: 'Get current cash position for org or specific account',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['organization', 'account']
        },
        accountId: {
          type: 'string',
          format: 'uuid'
        },
        currencyCode: {
          type: 'string',
          minLength: 3,
          maxLength: 3
        },
        asOf: {
          type: 'string',
          description: 'ISO timestamp or YYYY-MM-DD date'
        }
      },
      required: ['type'],
      additionalProperties: false
    }
  },
  {
    name: 'get_fx_rates',
    description: 'Get current FX rates for currency pairs',
    input_schema: {
      type: 'object',
      properties: {
        baseCurrency: {
          type: 'string',
          minLength: 3,
          maxLength: 3
        },
        quoteCurrencies: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 3,
            maxLength: 3
          },
          minItems: 1
        }
      },
      required: ['baseCurrency', 'quoteCurrencies'],
      additionalProperties: false
    }
  },
  {
    name: 'list_pending_approvals',
    description: 'List payments awaiting approval',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_risk_summary',
    description: 'Get current risk exposure summary',
    input_schema: {
      type: 'object',
      properties: {
        riskType: {
          type: 'string',
          enum: ['fx', 'interest_rate', 'credit', 'liquidity']
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_liquidity_forecast',
    description: 'Get cash flow forecast for specified horizon',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 365
        },
        currencyCode: {
          type: 'string',
          minLength: 3,
          maxLength: 3
        }
      },
      required: ['days'],
      additionalProperties: false
    }
  },
  {
    name: 'get_account_transactions',
    description: 'Get recent transactions for an account',
    input_schema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          format: 'uuid'
        },
        fromDate: {
          type: 'string',
          description: 'YYYY-MM-DD'
        },
        toDate: {
          type: 'string',
          description: 'YYYY-MM-DD'
        },
        direction: {
          type: 'string',
          enum: ['inflow', 'outflow']
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_investment_summary',
    description: 'Get investment portfolio summary',
    input_schema: {
      type: 'object',
      properties: {
        currencyCode: {
          type: 'string',
          minLength: 3,
          maxLength: 3
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_debt_summary',
    description: 'Get debt facility utilization summary',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
];

export const treasuryToolStatusLabels: Record<TreasuryToolDefinition['name'], string> = {
  get_cash_position: 'Checking cash positions...',
  get_fx_rates: 'Checking FX rates...',
  list_pending_approvals: 'Reviewing approval queue...',
  get_risk_summary: 'Reviewing risk exposures...',
  get_liquidity_forecast: 'Reviewing liquidity forecast...',
  get_account_transactions: 'Pulling recent transactions...',
  get_investment_summary: 'Reviewing investment portfolio...',
  get_debt_summary: 'Reviewing debt facilities...'
};
