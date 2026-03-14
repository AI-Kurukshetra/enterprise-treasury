import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowLeftRight,
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  ChartColumn,
  CircleAlert,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Waves
} from 'lucide-react';

export interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortDescription: string;
  requiredPermissionPrefixes?: string[];
  requiredPermissions?: string[];
}

export interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    label: 'Treasury',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        shortDescription: 'Treasury command center'
      },
      {
        href: '/accounts',
        label: 'Accounts',
        icon: Building2,
        shortDescription: 'Multi-bank account registry'
      },
      {
        href: '/payments',
        label: 'Payments',
        icon: ArrowLeftRight,
        shortDescription: 'Payment operations and approvals'
      },
      {
        href: '/transactions',
        label: 'Transactions',
        icon: ReceiptText,
        shortDescription: 'Ledger-level activity monitoring'
      },
      {
        href: '/cash-positions',
        label: 'Cash Positions',
        icon: Landmark,
        shortDescription: 'Global liquidity visibility'
      },
      {
        href: '/liquidity',
        label: 'Liquidity',
        icon: Waves,
        shortDescription: 'Pools, sweeps, and intercompany flows',
        requiredPermissions: ['liquidity.read']
      },
      {
        href: '/forecasts',
        label: 'Forecasts',
        icon: ChartColumn,
        shortDescription: 'Scenario planning and runway'
      },
      {
        href: '/risk-exposure',
        label: 'Risk Exposure',
        icon: CircleAlert,
        shortDescription: 'FX, counterparty, and rate risk'
      },
      {
        href: '/investments',
        label: 'Investments',
        icon: BriefcaseBusiness,
        shortDescription: 'Short-duration portfolio control'
      },
      {
        href: '/copilot',
        label: 'Treasury Copilot',
        icon: Sparkles,
        shortDescription: 'AI-native treasury analysis workspace',
        requiredPermissions: ['copilot.access']
      }
    ]
  },
  {
    label: 'Reports',
    items: [
      {
        href: '/reports',
        label: 'Reports',
        icon: BadgeDollarSign,
        shortDescription: 'Board, audit, and liquidity reporting'
      },
      {
        href: '/admin/audit-logs',
        label: 'Audit Logs',
        icon: ScrollText,
        shortDescription: 'Immutable operational traceability',
        requiredPermissions: ['admin.audit_logs.read']
      }
    ]
  },
  {
    label: 'Admin',
    items: [
      {
        href: '/admin',
        label: 'Admin Console',
        icon: ShieldCheck,
        shortDescription: 'Users, roles, and policy governance',
        requiredPermissionPrefixes: ['admin.', 'policy.']
      }
    ]
  }
];

export const utilityNavigation = [
  {
    label: 'Live connectivity',
    value: '24 banks / 7 ERPs / 2 rate feeds',
    icon: Activity
  }
];
