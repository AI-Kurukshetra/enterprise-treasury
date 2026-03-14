'use client';

import Link from 'next/link';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PolicyViolation, PolicyWarning } from '@/lib/types';

interface PolicyViolationBannerProps {
  violations?: PolicyViolation[];
  warnings?: PolicyWarning[];
}

export function PolicyViolationBanner({ violations = [], warnings = [] }: PolicyViolationBannerProps) {
  if (violations.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {violations.map((violation) => (
        <div key={`${violation.policyId}-${violation.ruleId}`} className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="danger">Blocked</Badge>
                <span className="font-medium">Payment blocked by policy: {violation.message}</span>
              </div>
              <Link href={`/admin#policy-${violation.policyId}`} className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 underline underline-offset-2">
                View policy details
              </Link>
            </div>
          </div>
        </div>
      ))}

      {warnings.map((warning) => (
        <div key={`${warning.policyId}-${warning.ruleId}`} className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">{warning.action === 'require_approval' ? 'Approval' : 'Warning'}</Badge>
                <span className="font-medium">
                  Warning: {warning.message}
                  {warning.action === 'require_approval' ? ' — approvals required' : ''}
                </span>
              </div>
              <Link href={`/admin#policy-${warning.policyId}`} className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 underline underline-offset-2">
                View policy details
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
