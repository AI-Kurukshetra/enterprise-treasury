'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Shield, ShieldAlert, UserPlus, Users, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SlideOver } from '@/components/ui/slide-over';
import { useAdminRolesQuery, useAdminUsersQuery, usePoliciesQuery } from '@/hooks/use-treasury-queries';
import { createPolicy, deletePolicy, inviteAdminUser, revokeAdminUser, updatePolicy, validatePolicyRules } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { PolicyAction, PolicyCondition, PolicyDomain, PolicyRule, TreasuryPolicy } from '@/lib/types';

type AdminTab = 'users' | 'roles' | 'policies';
type PolicyDomainFilter = PolicyDomain | 'all';

interface PolicyDraft {
  id?: string;
  name: string;
  domain: PolicyDomain;
  rules: PolicyRule[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string;
}

const policyDomains: Array<{ value: PolicyDomainFilter; label: string }> = [
  { value: 'all', label: 'All domains' },
  { value: 'payment', label: 'Payment' },
  { value: 'investment', label: 'Investment' },
  { value: 'forex', label: 'Forex' },
  { value: 'liquidity', label: 'Liquidity' }
];

const actionLabels: Record<PolicyAction, string> = {
  block: 'Block',
  warn: 'Warn',
  require_approval: 'Require Approval',
  auto_approve: 'Auto Approve'
};

export function AdminConsole() {
  const [activeTab, setActiveTab] = useState<AdminTab>('policies');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [revokeUserId, setRevokeUserId] = useState<string | null>(null);
  const [policyDomainFilter, setPolicyDomainFilter] = useState<PolicyDomainFilter>('all');
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [policyErrors, setPolicyErrors] = useState<string[]>([]);

  const queryClient = useQueryClient();
  const usersQuery = useAdminUsersQuery();
  const rolesQuery = useAdminRolesQuery();
  const policiesQuery = usePoliciesQuery({
    domain: policyDomainFilter === 'all' ? undefined : policyDomainFilter
  });

  const inviteMutation = useMutation({
    mutationFn: inviteAdminUser
  });
  const revokeMutation = useMutation({
    mutationFn: revokeAdminUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setRevokeUserId(null);
    }
  });
  const validatePolicyMutation = useMutation({
    mutationFn: validatePolicyRules
  });
  const savePolicyMutation = useMutation({
    mutationFn: async (draft: PolicyDraft) => {
      const validation = await validatePolicyRules(draft.rules);
      if (!validation.valid) {
        throw new Error(validation.errors.join('\n'));
      }

      if (draft.id) {
        return updatePolicy(draft.id, toPolicyPayload(draft));
      }

      return createPolicy(toPolicyPayload(draft));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
      setPolicyDraft(null);
      setPolicyErrors([]);
    }
  });
  const togglePolicyMutation = useMutation({
    mutationFn: async (policy: TreasuryPolicy) => {
      if (policy.isActive) {
        return deletePolicy(policy.id);
      }

      return updatePolicy(policy.id, {
        name: policy.name,
        domain: policy.domain,
        rules: policy.rules,
        isActive: true,
        effectiveFrom: todayString(),
        effectiveTo: null
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'policies'] });
    }
  });

  const permissionKeys = useMemo(
    () => Array.from(new Set(rolesQuery.data?.flatMap((role) => role.permissions) ?? [])).sort(),
    [rolesQuery.data]
  );

  function openCreatePolicy() {
    setPolicyDraft(createEmptyPolicyDraft(policyDomainFilter === 'all' ? 'payment' : policyDomainFilter));
    setPolicyErrors([]);
  }

  function openEditPolicy(policy: TreasuryPolicy) {
    setPolicyDraft({
      id: policy.id,
      name: policy.name,
      domain: policy.domain,
      rules: policy.rules,
      isActive: policy.isActive,
      effectiveFrom: policy.effectiveFrom.slice(0, 10),
      effectiveTo: policy.effectiveTo?.slice(0, 10) ?? ''
    });
    setPolicyErrors([]);
  }

  async function handleValidatePolicy() {
    if (!policyDraft) {
      return;
    }

    const result = await validatePolicyMutation.mutateAsync(policyDraft.rules);
    setPolicyErrors(result.valid ? [] : result.errors);
  }

  function handleSavePolicy() {
    if (!policyDraft) {
      return;
    }

    setPolicyErrors([]);
    savePolicyMutation.mutate(policyDraft, {
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Policy could not be saved.';
        setPolicyErrors(message.split('\n').filter(Boolean));
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(214,228,223,0.55),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,246,244,0.96))]">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardDescription>Admin Console</CardDescription>
              <CardTitle>Access, approval, and treasury policy governance</CardTitle>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
              <Shield className="h-4 w-4 text-emerald-600" />
              Audit-safe admin controls
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-wrap gap-2">
            {([
              ['users', 'Users', Users],
              ['roles', 'Roles', Shield],
              ['policies', 'Policies', Workflow]
            ] as const).map(([tab, label, Icon]) => (
              <Button
                key={tab}
                type="button"
                variant={activeTab === tab ? 'default' : 'outline'}
                onClick={() => setActiveTab(tab)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>

          {activeTab === 'users' ? (
            <div className="space-y-5">
              <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm md:grid-cols-[1fr_220px_auto]">
                <label className="space-y-2">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Invite email</span>
                  <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="user@company.com" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Role</span>
                  <Select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                    <option value="">Select role</option>
                    {rolesQuery.data?.map((role) => (
                      <option key={role.id} value={role.name}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="accent"
                    onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                    disabled={!inviteEmail || !inviteRole || inviteMutation.isPending}
                  >
                    <UserPlus className="h-4 w-4" />
                    {inviteMutation.isPending ? 'Queuing...' : 'Invite user'}
                  </Button>
                </div>
              </div>

              {inviteMutation.data ? (
                <p className="text-sm text-slate-600">{inviteMutation.data.message}</p>
              ) : null}

              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium">Email</th>
                        <th className="px-6 py-3 font-medium">Role</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                        <th className="px-6 py-3 font-medium">Last login</th>
                        <th className="px-6 py-3 font-medium">MFA</th>
                        <th className="px-6 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersQuery.data?.map((user) => (
                        <tr key={user.id} className="border-t border-slate-100">
                          <td className="px-6 py-4 font-medium text-slate-900">{user.name ?? 'Unknown user'}</td>
                          <td className="px-6 py-4 text-slate-600">{user.email}</td>
                          <td className="px-6 py-4 text-slate-600">{user.role}</td>
                          <td className="px-6 py-4">
                            <Badge variant={user.status === 'active' ? 'success' : user.status === 'invited' ? 'warning' : 'danger'}>
                              {user.status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-slate-600">{user.lastLogin ? formatDateTime(user.lastLogin) : 'Unavailable'}</td>
                          <td className="px-6 py-4">
                            <Badge variant={user.mfaEnabled ? 'success' : 'outline'}>{user.mfaEnabled ? 'Enabled' : 'Disabled'}</Badge>
                          </td>
                          <td className="px-6 py-4">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setRevokeUserId(user.id)}
                              disabled={user.status === 'revoked'}
                            >
                              Revoke access
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'roles' ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                {rolesQuery.data?.map((role) => (
                  <Card key={role.id} className="border-slate-200 bg-white">
                    <CardHeader className="pb-3">
                      <CardDescription>{role.isSystem ? 'System role' : 'Custom role'}</CardDescription>
                      <CardTitle>{role.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-500">{role.permissionCount} permissions assigned</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-medium">Permission key</th>
                        {rolesQuery.data?.map((role) => (
                          <th key={role.id} className="px-6 py-3 font-medium">
                            {role.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {permissionKeys.map((permission) => (
                        <tr key={permission} className="border-t border-slate-100">
                          <td className="px-6 py-4 font-mono text-xs text-slate-600">{permission}</td>
                          {rolesQuery.data?.map((role) => (
                            <td key={`${role.id}-${permission}`} className="px-6 py-4">
                              <input type="checkbox" checked={role.permissions.includes(permission)} readOnly className="h-4 w-4 rounded border-slate-300" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'policies' ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Policy tab</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">Deterministic rule enforcement by treasury domain</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Create reusable block, warn, and approval rules with a condition builder instead of raw JSON.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {policyDomains.map((domain) => (
                    <Button
                      key={domain.value}
                      type="button"
                      size="sm"
                      variant={policyDomainFilter === domain.value ? 'default' : 'outline'}
                      onClick={() => setPolicyDomainFilter(domain.value)}
                    >
                      {domain.label}
                    </Button>
                  ))}
                  <Button type="button" variant="accent" onClick={openCreatePolicy}>
                    <Plus className="h-4 w-4" />
                    Create Policy
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {policiesQuery.data?.map((policy) => (
                  <Card key={policy.id} id={`policy-${policy.id}`} className="border-slate-200 bg-white">
                    <CardHeader className="space-y-3 border-b border-slate-100 pb-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={domainBadgeVariant(policy.domain)}>{policy.domain}</Badge>
                        <Badge variant={policy.isActive ? 'success' : 'outline'}>
                          {policy.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div>
                        <CardDescription>Version {policy.version}</CardDescription>
                        <CardTitle>{policy.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-5">
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Effective window</p>
                        <p className="mt-2 text-sm text-slate-700">
                          {formatDate(policy.effectiveFrom)}
                          {policy.effectiveTo ? ` to ${formatDate(policy.effectiveTo)}` : ' onward'}
                        </p>
                      </div>
                      <div className="space-y-3">
                        {policy.rules.map((rule) => (
                          <div key={rule.id} className="rounded-[24px] border border-slate-200 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-slate-900">{rule.name}</p>
                                <p className="text-sm text-slate-500">{rule.message}</p>
                              </div>
                              <Badge variant={actionBadgeVariant(rule.action)}>{actionLabels[rule.action]}</Badge>
                            </div>
                            <p className="mt-3 text-sm text-slate-700">{describeRule(rule)}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEditPolicy(policy)}>
                          Edit builder
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={policy.isActive ? 'danger' : 'success'}
                          onClick={() => togglePolicyMutation.mutate(policy)}
                          disabled={togglePolicyMutation.isPending}
                        >
                          {policy.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={Boolean(revokeUserId)}
        onClose={() => setRevokeUserId(null)}
        onConfirm={() => (revokeUserId ? revokeMutation.mutate(revokeUserId) : undefined)}
        title="Revoke organization access"
        description="This changes the membership status to revoked. Audit logs remain immutable."
        confirmLabel={revokeMutation.isPending ? 'Revoking...' : 'Revoke access'}
        confirmVariant="danger"
        loading={revokeMutation.isPending}
      />

      <SlideOver
        open={Boolean(policyDraft)}
        onClose={() => setPolicyDraft(null)}
        title={policyDraft?.id ? policyDraft.name : 'Create policy'}
        description="Design the rule set, preview it in plain English, validate the DSL, and persist without leaving the admin console."
      >
        {policyDraft ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Policy name</span>
                <Input
                  value={policyDraft.name}
                  onChange={(event) => setPolicyDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                  placeholder="Global payment escalation"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Domain</span>
                <Select
                  value={policyDraft.domain}
                  onChange={(event) =>
                    setPolicyDraft((current) => (current ? { ...current, domain: event.target.value as PolicyDomain } : current))
                  }
                >
                  {policyDomains
                    .filter((item): item is { value: PolicyDomain; label: string } => item.value !== 'all')
                    .map((domain) => (
                      <option key={domain.value} value={domain.value}>
                        {domain.label}
                      </option>
                    ))}
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Effective from</span>
                <Input
                  type="date"
                  value={policyDraft.effectiveFrom}
                  onChange={(event) => setPolicyDraft((current) => (current ? { ...current, effectiveFrom: event.target.value } : current))}
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Effective to</span>
                <Input
                  type="date"
                  value={policyDraft.effectiveTo}
                  onChange={(event) => setPolicyDraft((current) => (current ? { ...current, effectiveTo: event.target.value } : current))}
                />
              </label>
            </div>

            <label className="flex items-center gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={policyDraft.isActive}
                onChange={(event) => setPolicyDraft((current) => (current ? { ...current, isActive: event.target.checked } : current))}
                className="h-4 w-4 rounded border-slate-300"
              />
              Activate immediately after save
            </label>

            <div className="space-y-4 rounded-[28px] border border-slate-200 bg-[#f7f4ef] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Rules</p>
                  <h4 className="mt-2 text-lg font-semibold text-slate-950">Visual condition builder</h4>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPolicyDraft((current) =>
                      current
                        ? {
                            ...current,
                            rules: [...current.rules, createEmptyRule(current.domain)]
                          }
                        : current
                    )
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add rule
                </Button>
              </div>

              {policyDraft.rules.map((rule, index) => (
                <Card key={rule.id} className="border-slate-200 bg-white">
                  <CardHeader className="space-y-4 border-b border-slate-100 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardDescription>Rule {index + 1}</CardDescription>
                        <CardTitle>{rule.name || 'Unnamed rule'}</CardTitle>
                      </div>
                      {policyDraft.rules.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPolicyDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    rules: current.rules.filter((candidate) => candidate.id !== rule.id)
                                  }
                                : current
                            )
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Rule name</span>
                        <Input
                          value={rule.name}
                          onChange={(event) => updateDraftRule(setPolicyDraft, rule.id, { ...rule, name: event.target.value })}
                          placeholder="High value payment screen"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Action</span>
                        <Select
                          value={rule.action}
                          onChange={(event) =>
                            updateDraftRule(setPolicyDraft, rule.id, { ...rule, action: event.target.value as PolicyAction })
                          }
                        >
                          {Object.entries(actionLabels).map(([action, label]) => (
                            <option key={action} value={action}>
                              {label}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                    <label className="space-y-2">
                      <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Message</span>
                      <Input
                        value={rule.message}
                        onChange={(event) => updateDraftRule(setPolicyDraft, rule.id, { ...rule, message: event.target.value })}
                        placeholder="Escalate to treasurer and CFO"
                      />
                    </label>
                    <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
                      <span className="font-medium">Preview:</span> {describeRule(rule)}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-5">
                    <ConditionEditor
                      condition={rule.condition}
                      domain={policyDraft.domain}
                      onChange={(nextCondition) => updateDraftRule(setPolicyDraft, rule.id, { ...rule, condition: nextCondition })}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>

            {policyErrors.length > 0 ? (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <ShieldAlert className="h-4 w-4" />
                  Validation issues
                </div>
                {policyErrors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setPolicyDraft(null)}>
                Cancel
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleValidatePolicy()} disabled={validatePolicyMutation.isPending}>
                {validatePolicyMutation.isPending ? 'Validating...' : 'Validate rules'}
              </Button>
              <Button type="button" variant="accent" onClick={handleSavePolicy} disabled={savePolicyMutation.isPending}>
                {savePolicyMutation.isPending ? 'Saving...' : policyDraft.id ? 'Save policy' : 'Create policy'}
              </Button>
            </div>
          </div>
        ) : null}
      </SlideOver>
    </div>
  );
}

function ConditionEditor({
  condition,
  domain,
  onChange,
  onRemove
}: {
  condition: PolicyCondition;
  domain: PolicyDomain;
  onChange: (condition: PolicyCondition) => void;
  onRemove?: () => void;
}) {
  const isGroup = condition.type === 'and' || condition.type === 'or';

  return (
    <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Condition type</span>
          <Select value={condition.type} onChange={(event) => onChange(createEmptyCondition(event.target.value as PolicyCondition['type']))}>
            <option value="amount_exceeds">Amount exceeds</option>
            <option value="counterparty_concentration">Counterparty concentration</option>
            {domain === 'payment' ? <option value="payment_to_restricted_country">Restricted country</option> : null}
            <option value="fx_exposure_exceeds">FX exposure exceeds</option>
            <option value="balance_below_minimum">Balance below minimum</option>
            <option value="covenant_ratio_breached">Covenant ratio breached</option>
            <option value="and">AND group</option>
            <option value="or">OR group</option>
          </Select>
        </label>
        {onRemove ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>

      {condition.type === 'amount_exceeds' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Threshold</span>
            <Input value={condition.threshold} onChange={(event) => onChange({ ...condition, threshold: event.target.value })} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Currency</span>
            <Input value={condition.currency} onChange={(event) => onChange({ ...condition, currency: event.target.value.toUpperCase() })} />
          </label>
        </div>
      ) : null}

      {condition.type === 'counterparty_concentration' ? (
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Max percentage</span>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={String(condition.maxPercentage)}
            onChange={(event) => onChange({ ...condition, maxPercentage: Number(event.target.value || 0) })}
          />
        </label>
      ) : null}

      {condition.type === 'payment_to_restricted_country' ? (
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Restricted countries</span>
          <Input
            value={condition.countries.join(', ')}
            onChange={(event) =>
              onChange({
                ...condition,
                countries: event.target.value
                  .split(',')
                  .map((country) => country.trim().toUpperCase())
                  .filter(Boolean)
              })
            }
            placeholder="IR, KP, SY"
          />
        </label>
      ) : null}

      {condition.type === 'fx_exposure_exceeds' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Exposure percentage</span>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={String(condition.percentage)}
              onChange={(event) => onChange({ ...condition, percentage: Number(event.target.value || 0) })}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Currency</span>
            <Input value={condition.currency} onChange={(event) => onChange({ ...condition, currency: event.target.value.toUpperCase() })} />
          </label>
        </div>
      ) : null}

      {condition.type === 'balance_below_minimum' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Minimum balance</span>
            <Input value={condition.threshold} onChange={(event) => onChange({ ...condition, threshold: event.target.value })} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Account id (optional)</span>
            <Input
              value={condition.accountId ?? ''}
              onChange={(event) =>
                onChange({
                  ...condition,
                  accountId: event.target.value.trim() || undefined
                })
              }
            />
          </label>
        </div>
      ) : null}

      {condition.type === 'covenant_ratio_breached' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Facility id</span>
            <Input value={condition.facilityId} onChange={(event) => onChange({ ...condition, facilityId: event.target.value })} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Ratio key</span>
            <Input value={condition.ratio} onChange={(event) => onChange({ ...condition, ratio: event.target.value })} />
          </label>
        </div>
      ) : null}

      {isGroup ? (
        <div className="space-y-3">
          {(condition.conditions ?? []).map((childCondition, index) => (
            <ConditionEditor
              key={`${condition.type}-${index}`}
              condition={childCondition}
              domain={domain}
              onChange={(nextCondition) =>
                onChange({
                  ...condition,
                  conditions: condition.conditions.map((candidate, candidateIndex) =>
                    candidateIndex === index ? nextCondition : candidate
                  )
                })
              }
              onRemove={() =>
                onChange({
                  ...condition,
                  conditions: condition.conditions.filter((_, candidateIndex) => candidateIndex !== index)
                })
              }
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...condition,
                conditions: [...condition.conditions, createEmptyCondition('amount_exceeds')]
              })
            }
          >
            <Plus className="h-4 w-4" />
            Add nested condition
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function createEmptyPolicyDraft(domain: PolicyDomain): PolicyDraft {
  return {
    name: '',
    domain,
    rules: [createEmptyRule(domain)],
    isActive: true,
    effectiveFrom: todayString(),
    effectiveTo: ''
  };
}

function createEmptyRule(domain: PolicyDomain): PolicyRule {
  return {
    id: crypto.randomUUID(),
    name: '',
    action: 'block',
    message: '',
    condition: createEmptyCondition(domain === 'payment' ? 'amount_exceeds' : 'amount_exceeds')
  };
}

function createEmptyCondition(type: PolicyCondition['type']): PolicyCondition {
  switch (type) {
    case 'amount_exceeds':
      return { type, threshold: '1000000.000000', currency: 'USD' };
    case 'counterparty_concentration':
      return { type, maxPercentage: 25 };
    case 'payment_to_restricted_country':
      return { type, countries: ['IR'] };
    case 'fx_exposure_exceeds':
      return { type, percentage: 20, currency: 'EUR' };
    case 'balance_below_minimum':
      return { type, threshold: '500000.000000' };
    case 'covenant_ratio_breached':
      return { type, facilityId: '', ratio: 'leverage' };
    case 'and':
      return { type, conditions: [createEmptyCondition('amount_exceeds'), createEmptyCondition('balance_below_minimum')] };
    case 'or':
      return { type, conditions: [createEmptyCondition('amount_exceeds'), createEmptyCondition('counterparty_concentration')] };
    default:
      return { type: 'amount_exceeds', threshold: '1000000.000000', currency: 'USD' };
  }
}

function describeRule(rule: PolicyRule) {
  return `${actionLabels[rule.action]} ${describeCondition(rule.condition)}`;
}

function describeCondition(condition: PolicyCondition): string {
  switch (condition.type) {
    case 'amount_exceeds':
      return `payments over ${condition.threshold} ${condition.currency}`;
    case 'counterparty_concentration':
      return `counterparty exposure above ${condition.maxPercentage}%`;
    case 'payment_to_restricted_country':
      return `payments to ${condition.countries.join(', ')}`;
    case 'fx_exposure_exceeds':
      return `${condition.currency} FX exposure above ${condition.percentage}% of portfolio`;
    case 'balance_below_minimum':
      return `${condition.accountId ? `account ${condition.accountId}` : 'liquidity buffer'} below ${condition.threshold}`;
    case 'covenant_ratio_breached':
      return `${condition.ratio} covenant breached on facility ${condition.facilityId || 'pending selection'}`;
    case 'and':
      return condition.conditions.map((childCondition) => describeCondition(childCondition)).join(' and ');
    case 'or':
      return condition.conditions.map((childCondition) => describeCondition(childCondition)).join(' or ');
    default:
      return 'policy condition';
  }
}

function toPolicyPayload(draft: PolicyDraft) {
  return {
    name: draft.name,
    domain: draft.domain,
    rules: draft.rules,
    isActive: draft.isActive,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null
  };
}

function todayString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function actionBadgeVariant(action: PolicyAction) {
  switch (action) {
    case 'block':
      return 'danger';
    case 'warn':
      return 'warning';
    case 'require_approval':
      return 'secondary';
    case 'auto_approve':
      return 'success';
    default:
      return 'outline';
  }
}

function domainBadgeVariant(domain: PolicyDomain) {
  switch (domain) {
    case 'payment':
      return 'danger';
    case 'investment':
      return 'success';
    case 'forex':
      return 'warning';
    case 'liquidity':
      return 'secondary';
    default:
      return 'outline';
  }
}

function updateDraftRule(
  setPolicyDraft: Dispatch<SetStateAction<PolicyDraft | null>>,
  ruleId: string,
  nextRule: PolicyRule
) {
  setPolicyDraft((current) =>
    current
      ? {
          ...current,
          rules: current.rules.map((rule) => (rule.id === ruleId ? nextRule : rule))
        }
      : current
  );
}
