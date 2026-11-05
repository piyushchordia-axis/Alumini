import {
  BILLING_CYCLES,
  BILLING_MODELS,
  BILLING_MODEL_LABELS,
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABELS,
  formatPhone,
  type BillingModel,
  type BillingPlanCreateInput,
  type BillingPlanDto,
  type BillingPlanUpdateInput,
  type MessageChannel,
  type TenantStatus,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { IconExternalLink } from "@/components/icons";
import { Avatar, Badge, Button, Card, Checkbox, ErrorBox, FormField, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoneyMinor } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

type Tab = "overview" | "settings" | "branding" | "admins" | "billing";

export function PlatformTenantDetailPage() {
  const { tenantId = "" } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const q = useQuery({ queryKey: qk.platform.tenant(tenantId), queryFn: () => api.platform.tenants.get(tenantId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["platform"] });
    void qc.invalidateQueries({ queryKey: ["tenants"] });
    void qc.invalidateQueries({ queryKey: ["tenant"] });
  };
  const setStatus = useMutation({
    mutationFn: (status: TenantStatus) => api.platform.tenants.update(tenantId, { status }),
    onSuccess: () => {
      refresh();
      toast.success("Status updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Not found"} />;
  const { tenant, settings, counts, currentPlan, admins } = q.data;
  return (
    <div className="space-y-4">
      <Link to="/platform/tenants" className="text-sm text-slate-500 hover:text-slate-800">
        ← Institutions
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} />
            {tenant.name}
            <Badge tone={tenant.status === "ACTIVE" ? "success" : tenant.status === "SUSPENDED" ? "warning" : "neutral"}>{tenant.status}</Badge>
          </span>
        }
        subtitle={
          <>
            <a href={`/t/${tenant.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
              /t/{tenant.slug}
              <IconExternalLink size={14} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            · onboarded {formatDate(tenant.createdAt)}
          </>
        }
        actions={
          <Select aria-label="Institution status" value={tenant.status} onChange={(e) => setStatus.mutate(e.target.value as TenantStatus)} className="w-40">
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "settings", label: "Settings" },
          { value: "branding", label: "Branding" },
          { value: "admins", label: "Admins", count: admins.length },
          { value: "billing", label: "Billing" },
        ]}
        className="w-fit"
      />
      {tab === "overview" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Approved members" value={counts.approvedMembers} />
          <Stat label="Pending members" value={counts.pendingMembers} />
          <Stat label="Suspended" value={counts.suspendedMembers} />
          <Stat label="Active (30d)" value={counts.activeMembers30d} hint="Used for per-active-user billing" />
          <Stat label="New (30d)" value={counts.newMembers30d} />
          <Stat label="Billing plan" value={currentPlan ? BILLING_MODEL_LABELS[currentPlan.billingModel] : "None"} hint={currentPlan ? `since ${formatDate(currentPlan.effectiveFrom)}` : "Add one under Billing"} />
        </div>
      )}
      {tab === "settings" && (
        <Card className="p-5">
          <SettingsForm
            key={settings.updatedAt}
            initial={settings}
            tenantType={tenant.type}
            onSubmit={async (input) => {
              try {
                await api.platform.tenants.updateSettings(tenantId, input);
              } finally {
                // Refused too: the page may be stale (Messaging switched off by the institution, say), and the form remounts on what's saved.
                refresh();
              }
            }}
          />
        </Card>
      )}
      {tab === "branding" && (
        <Card className="p-5">
          <BrandingForm
            key={tenant.updatedAt}
            initial={tenant}
            onSubmit={async (input) => {
              await api.platform.tenants.update(tenantId, input);
              refresh();
            }}
          />
        </Card>
      )}
      {tab === "admins" && <AdminsTab tenantId={tenantId} admins={admins} onChange={refresh} />}
      {tab === "billing" && <BillingTab tenantId={tenantId} />}
    </div>
  );
}

function AdminsTab({ tenantId, admins, onChange }: { tenantId: string; admins: Awaited<ReturnType<typeof api.platform.tenants.get>>["admins"]; onChange: () => void }) {
  const [phone, setPhone] = useState("+91");
  const [fullName, setFullName] = useState("");
  const add = useMutation({
    mutationFn: () => api.platform.tenants.admins.add(tenantId, { phone, fullName }),
    onSuccess: () => {
      onChange();
      setFullName("");
      setPhone("+91");
      toast.success("Admin added — they can sign in with their mobile number");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (membershipId: string) => api.platform.tenants.admins.remove(tenantId, membershipId),
    onSuccess: () => {
      onChange();
      toast.success("Admin role removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="mb-3 font-semibold text-slate-900">Add an institution admin</h3>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <FormField label="Mobile number">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          <FormField label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
          <Button type="submit" loading={add.isPending} disabled={fullName.length < 2}>
            Add admin
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Existing members are promoted and approved; new numbers get an approved admin membership they can log into immediately.</p>
      </Card>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {admins.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No admins yet.</li>}
        {admins.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={a.fullName} src={a.avatarUrl} size="sm" />
            <span className="flex-1 text-sm">
              <span className="font-medium text-slate-900">{a.fullName}</span>
              <span className="text-slate-500"> · {formatPhone(a.phone)} · batch of {a.batchYear}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => confirm(`Remove admin role from ${a.fullName}?`) && remove.mutate(a.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** WhatsApp, SMS and email the plan includes, each with an optional charge per delivered message. */
function ChannelsField({
  channels,
  rates,
  currency,
  onChange,
}: {
  channels: MessageChannel[];
  rates: Record<MessageChannel, string>;
  currency: string;
  onChange: (channels: MessageChannel[], rates: Record<MessageChannel, string>) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">Messaging included</legend>
      <p className="mb-2 text-xs text-slate-500">Channels admins can use for invites and announcements (in-app and push are always included). Rates are charged per delivered message.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {MESSAGE_CHANNELS.map((c) => {
          const on = channels.includes(c);
          return (
            <div key={c} className="space-y-1">
              <Checkbox label={MESSAGE_CHANNEL_LABELS[c]} checked={on} onChange={(e) => onChange(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c), rates)} />
              {on && (
                <Input
                  aria-label={`${MESSAGE_CHANNEL_LABELS[c]} rate per message (${currency})`}
                  type="number"
                  min={0}
                  step="0.001"
                  placeholder={`${currency} per message`}
                  value={rates[c]}
                  onChange={(e) => onChange(channels, { ...rates, [c]: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

const ratesToInputs = (r: Partial<Record<MessageChannel, number>>): Record<MessageChannel, string> => ({
  WHATSAPP: r.WHATSAPP != null ? String(r.WHATSAPP / 100) : "",
  SMS: r.SMS != null ? String(r.SMS / 100) : "",
  EMAIL: r.EMAIL != null ? String(r.EMAIL / 100) : "",
});
/** Major units typed by staff → minor units (fractions kept: ₹0.115 → 11.5 paise). */
const inputsToRates = (channels: MessageChannel[], r: Record<MessageChannel, string>): Partial<Record<MessageChannel, number>> =>
  Object.fromEntries(channels.filter((c) => r[c].trim() !== "").map((c) => [c, Math.round(Number(r[c]) * 100 * 1000) / 1000]));
const channelSummary = (p: BillingPlanDto) =>
  p.includedChannels.length
    ? p.includedChannels.map((c) => `${MESSAGE_CHANNEL_LABELS[c]}${p.messageRatesMinor[c] != null ? ` ${formatMoneyMinor(p.messageRatesMinor[c]!, p.currency, 3)}/msg` : ""}`).join(", ")
    : "in-app and push only";

function currentMonthIn(timeZone: string): { start: string; end: string; today: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}`, today };
}

/** Edit an existing plan's price, cycle, currency or notes, or end it on a date. Only changed fields are sent. */
function PlanEditModal({ plan, mode, timeZone, onClose, onSaved }: { plan: BillingPlanDto; mode: "edit" | "end"; timeZone: string; onClose: () => void; onSaved: () => void }) {
  const [cycle, setCycle] = useState(plan.billingCycle);
  const [currency, setCurrency] = useState(plan.currency);
  const [price, setPrice] = useState(plan.pricePerActiveUserMinor != null ? String(plan.pricePerActiveUserMinor / 100) : "");
  const [flat, setFlat] = useState(plan.flatFeeMinor != null ? String(plan.flatFeeMinor / 100) : "");
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [endOn, setEndOn] = useState(plan.effectiveTo ?? currentMonthIn(timeZone).today);
  const [channels, setChannels] = useState<MessageChannel[]>(plan.includedChannels);
  const [rates, setRates] = useState(ratesToInputs(plan.messageRatesMinor));
  const save = useMutation({
    mutationFn: () => {
      const input: BillingPlanUpdateInput = {};
      if (mode === "end") input.effectiveTo = endOn;
      else {
        if (cycle !== plan.billingCycle) input.billingCycle = cycle;
        if (currency !== plan.currency) input.currency = currency;
        if (plan.billingModel === "PER_ACTIVE_USER") input.pricePerActiveUserMinor = Math.round(Number(price) * 100);
        if (plan.billingModel === "FLAT_FEE") input.flatFeeMinor = Math.round(Number(flat) * 100);
        if (notes !== (plan.notes ?? "")) input.notes = notes || null;
        input.includedChannels = channels;
        input.messageRatesMinor = inputsToRates(channels, rates);
      }
      return api.platform.billing.updatePlan(plan.id, input);
    },
    onSuccess: () => {
      onSaved();
      toast.success(mode === "end" ? "Plan end date saved" : "Plan updated");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "end" ? "End this plan" : "Edit plan"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      {mode === "end" ? (
        <FormField label="Last day of the plan" hint={`Usage after this day has no plan unless a new one starts. Started ${formatDate(plan.effectiveFrom)}.`}>
          <Input type="date" min={plan.effectiveFrom} value={endOn} onChange={(e) => setEndOn(e.target.value)} />
        </FormField>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Cycle">
            <Select value={cycle} onChange={(e) => setCycle(e.target.value as (typeof BILLING_CYCLES)[number])}>
              {BILLING_CYCLES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          {plan.billingModel === "PER_ACTIVE_USER" && (
            <FormField label="Price per active member" required>
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
          )}
          {plan.billingModel === "FLAT_FEE" && (
            <FormField label="Flat fee per cycle" required>
              <Input type="number" min={0} step="0.01" value={flat} onChange={(e) => setFlat(e.target.value)} />
            </FormField>
          )}
          <div className="sm:col-span-2">
            <ChannelsField
              channels={channels}
              rates={rates}
              currency={currency}
              onChange={(c, r) => {
                setChannels(c);
                setRates(r);
              }}
            />
          </div>
          <div className="sm:col-span-2">
            <FormField label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </FormField>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BillingTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const billing = useQuery({ queryKey: qk.platform.billing(tenantId), queryFn: () => api.platform.billing.get(tenantId) });
  // Billing periods are calendar days in the platform's billing time zone (from the API; India by default).
  const zone = billing.data?.timeZone ?? "Asia/Kolkata";
  const { start: monthStart, end: monthEnd } = currentMonthIn(zone);
  const [editing, setEditing] = useState<{ plan: BillingPlanDto; mode: "edit" | "end" } | null>(null);
  const [snapshotNotes, setSnapshotNotes] = useState("");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const usage = useQuery({ queryKey: qk.platform.usage(tenantId, { from, to }), queryFn: () => api.platform.billing.usage(tenantId, { from, to }), enabled: !!from && !!to && from <= to });
  const [model, setModel] = useState<BillingModel>("PER_ACTIVE_USER");
  const [cycle, setCycle] = useState<(typeof BILLING_CYCLES)[number]>("MONTHLY");
  const [currency, setCurrency] = useState("INR");
  const [price, setPrice] = useState("");
  const [flat, setFlat] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(monthStart);
  const [notes, setNotes] = useState("");
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [rates, setRates] = useState(ratesToInputs({}));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["platform"] });
  };
  const createPlan = useMutation({
    mutationFn: () => {
      const input: BillingPlanCreateInput = {
        billingModel: model,
        billingCycle: cycle,
        currency,
        pricePerActiveUserMinor: model === "PER_ACTIVE_USER" ? Math.round(Number(price) * 100) : null,
        flatFeeMinor: model === "FLAT_FEE" ? Math.round(Number(flat) * 100) : null,
        effectiveFrom,
        notes: notes || null,
        includedChannels: channels,
        messageRatesMinor: inputsToRates(channels, rates),
      };
      return api.platform.billing.createPlan(tenantId, input);
    },
    onSuccess: () => {
      refresh();
      toast.success("Billing plan recorded");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const snapshot = useMutation({
    mutationFn: () => api.platform.billing.createSnapshot(tenantId, { periodStart: from, periodEnd: to, notes: snapshotNotes.trim() || null }),
    onSuccess: () => {
      setSnapshotNotes("");
      refresh();
      toast.success("Snapshot saved for invoicing");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (billing.isLoading) return <Loading />;
  if (billing.error || !billing.data) return <ErrorBox error={billing.error ?? "Failed"} />;
  const b = billing.data;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900">Current plan</h3>
        {b.currentPlan ? (
          <p className="mt-1 text-sm text-slate-700">
            {BILLING_MODEL_LABELS[b.currentPlan.billingModel]}
            {b.currentPlan.billingModel === "PER_ACTIVE_USER" && ` · ${formatMoneyMinor(b.currentPlan.pricePerActiveUserMinor, b.currentPlan.currency)} per active member`}
            {b.currentPlan.billingModel === "FLAT_FEE" && ` · ${formatMoneyMinor(b.currentPlan.flatFeeMinor, b.currentPlan.currency)}`} · {b.currentPlan.billingCycle.toLowerCase()} · since {formatDate(b.currentPlan.effectiveFrom)}
            <span className="block text-xs text-slate-500">Messaging: {channelSummary(b.currentPlan)}</span>
            {b.currentPlan.notes && <span className="block text-xs text-slate-500">{b.currentPlan.notes}</span>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-700">No plan recorded. Add one below so usage can be priced.</p>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold text-slate-900">Usage &amp; chargeback estimate</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <FormField label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <FormField label="Snapshot note">
            <Input value={snapshotNotes} onChange={(e) => setSnapshotNotes(e.target.value)} placeholder="Invoice #, PO…" maxLength={1000} />
          </FormField>
          <Button variant="outline" onClick={() => snapshot.mutate()} loading={snapshot.isPending} disabled={!usage.data}>
            Freeze snapshot for invoice
          </Button>
        </div>
        {usage.data && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Stat label="Approved at period end" value={usage.data.approvedMembers} />
              <Stat label="Active in period" value={usage.data.activeMembers} hint="Used the app on at least one day" />
              <Stat label="New in period" value={usage.data.newMembers} hint="First approved in the period" />
              <Stat
                label="Estimated amount"
                value={formatMoneyMinor(usage.data.estimatedAmountMinor, usage.data.currency)}
                hint={
                  usage.data.plan
                    ? `${BILLING_MODEL_LABELS[usage.data.plan.billingModel]} · ${usage.data.cycleFraction === 1 ? "one full" : `${usage.data.cycleFraction} of a`} ${usage.data.plan.billingCycle.toLowerCase()} cycle${usage.data.messageAmountMinor ? ` + ${formatMoneyMinor(usage.data.messageAmountMinor, usage.data.currency)} messages` : ""}`
                    : "no plan"
                }
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {MESSAGE_CHANNELS.map((c) => (
                <Stat key={c} label={`${MESSAGE_CHANNEL_LABELS[c]} messages`} value={usage.data!.messages[c]} hint="Delivered in the period" />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Days are calendar days in {usage.data.timeZone}. The estimate is prorated when the period is not exactly one billing cycle.</p>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold text-slate-900">Record a new plan</h3>
        <p className="text-xs text-slate-500">Billing is handled offline; this records what was agreed. A new plan closes the previous one the day before it starts.</p>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            createPlan.mutate();
          }}
        >
          <FormField label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value as BillingModel)}>
              {BILLING_MODELS.map((m) => (
                <option key={m} value={m}>
                  {BILLING_MODEL_LABELS[m]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Cycle">
            <Select value={cycle} onChange={(e) => setCycle(e.target.value as (typeof BILLING_CYCLES)[number])}>
              {BILLING_CYCLES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </FormField>
          {model === "PER_ACTIVE_USER" && (
            <FormField label="Price per active member" required>
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
          )}
          {model === "FLAT_FEE" && (
            <FormField label="Flat fee per cycle" required>
              <Input type="number" min={0} step="0.01" value={flat} onChange={(e) => setFlat(e.target.value)} />
            </FormField>
          )}
          <FormField label="Effective from" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </FormField>
          <div className="sm:col-span-3">
            <ChannelsField
              channels={channels}
              rates={rates}
              currency={currency}
              onChange={(c, r) => {
                setChannels(c);
                setRates(r);
              }}
            />
          </div>
          <div className="sm:col-span-3">
            <FormField label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Who agreed, invoice terms, PO numbers…" />
            </FormField>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" loading={createPlan.isPending} disabled={(model === "PER_ACTIVE_USER" && !price) || (model === "FLAT_FEE" && !flat)}>
              Record plan
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-slate-900">Plan history</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {b.plans.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {BILLING_MODEL_LABELS[p.billingModel]}
                {p.pricePerActiveUserMinor != null && ` · ${formatMoneyMinor(p.pricePerActiveUserMinor, p.currency)}/active member`}
                {p.flatFeeMinor != null && ` · ${formatMoneyMinor(p.flatFeeMinor, p.currency)}`}
                <span className="block text-xs text-slate-500">Messaging: {channelSummary(p)}</span>
              </span>
              <span className="flex items-center gap-3 text-slate-500">
                {formatDate(p.effectiveFrom)} → {p.effectiveTo ? formatDate(p.effectiveTo) : "open"}
                <Button size="sm" variant="ghost" onClick={() => setEditing({ plan: p, mode: "edit" })}>
                  Edit
                </Button>
                {!p.effectiveTo && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ plan: p, mode: "end" })}>
                    End
                  </Button>
                )}
              </span>
              {p.notes && <span className="w-full text-xs text-slate-500">{p.notes}</span>}
            </li>
          ))}
          {b.plans.length === 0 && <li className="py-2 text-slate-400">No plans yet.</li>}
        </ul>
      </Card>

      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-slate-900">Invoice snapshots</h3>
        <ul className="divide-y divide-slate-100 text-sm">
          {b.snapshots.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {formatDate(s.periodStart)} – {formatDate(s.periodEnd)} · {s.activeMemberCount} active · {s.approvedMemberCount} approved
                {s.messageAmountMinor > 0 && ` · messages ${formatMoneyMinor(s.messageAmountMinor, s.currency)}`}
              </span>
              <span className="font-medium text-slate-900">{formatMoneyMinor(s.amountMinor, s.currency)}</span>
              {s.notes && <span className="w-full text-xs text-slate-500">{s.notes}</span>}
            </li>
          ))}
          {b.snapshots.length === 0 && <li className="py-2 text-slate-400">No snapshots yet.</li>}
        </ul>
      </Card>
      {editing && <PlanEditModal plan={editing.plan} mode={editing.mode} timeZone={zone} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}
