import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ClipboardCheck, FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminUserAction, adminUserDetail } from "@/lib/admin.functions";
import { getAdminUserAttendanceAlerts, getAttendanceLogs } from "@/lib/security.functions";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/users/$id")({
  head: () => ({
    meta: [
      { title: "Account investigation — Sentinel Admin" },
      {
        name: "description",
        content:
          "Investigation panel with sign-in history, devices, risk history and authorised admin actions.",
      },
      { property: "og:title", content: "Account investigation — Sentinel Admin" },
      { property: "og:description", content: "Authorised account security investigation panel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Investigation,
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Investigation() {
  const { id } = useParams({ from: "/_authenticated/admin/users/$id" });
  const detail = useServerFn(adminUserDetail);
  const act = useServerFn(adminUserAction);
  const getLogsFn = useServerFn(getAttendanceLogs);
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ["admin", "user", id],
    queryFn: () => detail({ data: { userId: id } }),
  });

  const getAlertsFn = useServerFn(getAdminUserAttendanceAlerts);

  const attendanceQuery = useQuery({
    queryKey: ["admin", "userAttendance", id],
    queryFn: () => getLogsFn({ data: { limit: 100 } }),
  });

  const userAttendanceAlertsQuery = useQuery({
    queryKey: ["admin", "userAttendanceAlerts", id],
    queryFn: () => getAlertsFn({ data: { userId: id } }),
    refetchInterval: 15_000,
  });

  const action = useMutation({
    mutationFn: (input: { action: any; note?: string }) =>
      act({ data: { userId: id, action: input.action, ...(input.note ? { note: input.note } : {}) } }),
    onSuccess: () => {
      toast.success("Action recorded in the audit log");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  const p = data?.profile as any;
  const activity = data?.events ?? [];
  const signIns = activity.filter((event: any) =>
    ["LOGIN_SUCCESS", "NEW_DEVICE"].includes(event.event_type),
  );
  const signOuts = activity.filter((event: any) => event.event_type === "LOGOUT");
  const ipLookups = activity.filter((event: any) => event.event_type === "IP_LOOKUP");
  const lastSignIn = signIns[0];
  const lastSignOut = signOuts[0];

  return (
    <AdminShell>
      <Link
        to="/admin/users"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" /> Back to users
      </Link>

      {isLoading && <p className="text-sm text-muted-foreground">Loading account…</p>}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Could not open this investigation.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "The account security details could not be loaded."}
          </p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && !p && (
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium">User account not found.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Return to the users list and choose an active account to investigate.
          </p>
          <Button className="mt-4" size="sm" variant="outline" asChild>
            <Link to="/admin/users">Back to users</Link>
          </Button>
        </div>
      )}

      {p && !isError && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold">{p.full_name ?? "Unnamed account"}</h1>
              {data?.risk && <RiskBadge score={data.risk.score} level={data.risk.level} />}
              {p.account_locked && (
                <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                  Locked
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="print:hidden"
              onClick={() => window.print()}
              title="Open the activity report in the print dialog, then choose Save as PDF"
            >
              <FileDown className="mr-2 size-4" />
              Download PDF
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Activity summary">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Total sign-ins</dt>
                  <dd className="mt-1 text-lg font-semibold">{signIns.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total sign-outs</dt>
                  <dd className="mt-1 text-lg font-semibold">{signOuts.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">IP addresses checked</dt>
                  <dd className="mt-1 text-lg font-semibold">{ipLookups.length}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last sign-in</dt>
                  <dd className="mt-1 text-xs">{lastSignIn ? formatWhen(lastSignIn.created_at) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last sign-out</dt>
                  <dd className="mt-1 text-xs">{lastSignOut ? formatWhen(lastSignOut.created_at) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last IP checked</dt>
                  <dd className="mt-1 break-all font-mono text-xs">
                    {(ipLookups[0]?.metadata as any)?.tracked_ip ?? ipLookups[0]?.ip_address ?? "—"}
                  </dd>
                </div>
              </dl>
            </Panel>

            <Panel title="Account information">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{p.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd>{p.mobile ?? "—"}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatWhen(p.created_at)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{p.account_locked ? "Locked" : p.flagged_for_review ? "Under review" : "Active"}</dd>
                <dt className="text-muted-foreground">Password reset required</dt>
                <dd>{p.require_password_reset ? "Yes" : "No"}</dd>
                <dt className="text-muted-foreground">Registered devices</dt>
                <dd>{data?.devices.length ?? 0}</dd>
              </dl>
            </Panel>

            <Panel title="Risk assessment">
              <p className="text-sm">
                Score <strong>{data?.risk.score}</strong>/100 — {data?.risk.level} risk. Reasons:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {data?.risk.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Scores describe account activity only. They never label a person, and high scores require
                human review before any action.
              </p>
            </Panel>

            <Panel title="Authorised location">
              {p.location_consent ? (
                <div className="space-y-2 text-sm">
                  <div>Consent: <strong>Granted</strong> {p.location_consent_at ? `· ${formatWhen(p.location_consent_at)}` : ""}</div>
                  <div>Last authorised location: {p.last_location_label ?? "No fix recorded"}</div>
                  {p.last_lat != null && p.last_lng != null && (
                    <>
                      <div className="font-mono text-xs">
                        {p.last_lat.toFixed(4)}, {p.last_lng.toFixed(4)}
                        {p.location_accuracy ? ` · ±${Math.round(p.location_accuracy)} m` : ""}
                      </div>
                      <div>Updated: {p.last_location_at ? formatWhen(p.last_location_at) : "—"}</div>
                      <iframe
                        title="Authorised location map"
                        className="h-56 w-full rounded border border-border"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.last_lng - 0.02}%2C${p.last_lat - 0.02}%2C${p.last_lng + 0.02}%2C${p.last_lat + 0.02}&layer=mapnik&marker=${p.last_lat}%2C${p.last_lng}`}
                      />
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This user has not consented to location sharing. No coordinates are collected or stored.
                </p>
              )}
            </Panel>

            <Panel title="Administrator actions">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "FORCE_LOGOUT" })}>
                  Force logout
                </Button>
                {p.account_locked ? (
                  <Button size="sm" onClick={() => action.mutate({ action: "UNLOCK" })}>
                    Unlock account
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => action.mutate({ action: "LOCK" })}>
                    Lock account
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "REQUIRE_PASSWORD_RESET" })}>
                  Require password reset
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "FLAG_REVIEW" })}>
                  Flag for review
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "RESOLVE_REVIEW" })}>
                  Resolve review
                </Button>
                <Button size="sm" variant="outline" onClick={() => action.mutate({ action: "GENERATE_RISK" })}>
                  Generate risk assessment
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                <Textarea
                  placeholder="Investigation note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!note.trim()}
                  onClick={() => action.mutate({ action: "ADD_NOTE", note })}
                >
                  Add note
                </Button>
              </div>
            </Panel>
          </div>

            <Panel title="User activity">
              <p className="mb-3 text-xs text-muted-foreground">
                Sign-ins, security changes, device activity, and reported events for this account.
              </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">When</th>
                    <th className="py-2">Event</th>
                    <th className="py-2">IP / checked address</th>
                    <th className="py-2">Device</th>
                    <th className="py-2">Region</th>
                    <th className="py-2">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.events ?? []).map((e: any) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="whitespace-nowrap py-2">{formatWhen(e.created_at)}</td>
                      <td className="py-2">{prettyEvent(e.event_type)}</td>
                      <td className="py-2 font-mono text-xs">
                        {e.metadata?.tracked_ip ?? e.ip_address ?? "—"}
                      </td>
                      <td className="py-2">{[e.browser, e.os].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="py-2">{e.location_label ?? "—"}</td>
                      <td className="py-2">
                        <RiskBadge score={e.risk_score} level={e.risk_level} />
                      </td>
                    </tr>
                  ))}
                  {!(data?.events ?? []).length && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        No events recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Devices and sessions">
              <ul className="space-y-2 text-sm">
                {(data?.devices ?? []).map((d: any) => (
                  <li key={d.id} className="rounded border border-border p-2">
                    <div className="font-medium">{d.device_name ?? "Unnamed device"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[d.device_type, d.browser, d.os].filter(Boolean).join(" · ")} · last IP{" "}
                      <span className="font-mono">{d.last_ip ?? "—"}</span> · {formatWhen(d.last_seen)} ·{" "}
                      {d.trusted ? "Trusted" : "Untrusted"}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">id {d.id}</div>
                  </li>
                ))}
                {!(data?.devices ?? []).length && (
                  <li className="text-muted-foreground">No registered devices.</li>
                )}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                MAC addresses are never collected — browsers do not expose them, and Sentinel does not
                attempt to work around that.
              </p>
            </Panel>

            <Panel title="Risk history and notes">
              <ul className="space-y-2 text-sm">
                {(data?.assessments ?? []).map((a: any) => (
                  <li key={a.id} className="rounded border border-border p-2">
                    <RiskBadge score={a.score} level={a.risk_level} />{" "}
                    <span className="text-xs text-muted-foreground">
                      {formatWhen(a.generated_at)} · {a.review_status}
                    </span>
                    <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                      {(a.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}
                    </ul>
                  </li>
                ))}
                {(data?.notes ?? []).map((n: any) => (
                  <li key={n.id} className="rounded border border-border p-2">
                    <div className="text-xs text-muted-foreground">{formatWhen(n.created_at)} · note</div>
                    <div>{n.note}</div>
                  </li>
                ))}
                {!(data?.assessments ?? []).length && !(data?.notes ?? []).length && (
                  <li className="text-muted-foreground">No assessments or notes yet.</li>
                )}
              </ul>
            </Panel>
          </div>

          <Panel title="User attendance history">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">
                Attendance logs recorded by or linked to this user.
              </p>
              <Link
                to="/admin/attendance"
                className="text-xs font-medium text-primary hover:underline"
              >
                View all in attendance dashboard →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2">Date</th>
                    <th className="py-2">Name</th>
                    <th className="py-2">Roll / ID</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Note</th>
                    <th className="py-2">IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceQuery.isLoading ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        Loading attendance history…
                      </td>
                    </tr>
                  ) : (attendanceQuery.data ?? []).filter(
                      (r: any) =>
                        r.userId === id ||
                        (p?.email && r.note?.toLowerCase().includes(p.email.toLowerCase())) ||
                        (p?.full_name && r.name?.toLowerCase().includes(p.full_name.toLowerCase())),
                    ).length ? (
                    (attendanceQuery.data ?? [])
                      .filter(
                        (r: any) =>
                          r.userId === id ||
                          (p?.email && r.note?.toLowerCase().includes(p.email.toLowerCase())) ||
                          (p?.full_name && r.name?.toLowerCase().includes(p.full_name.toLowerCase())),
                      )
                      .map((record: any) => (
                        <tr key={record.id} className="border-t border-border">
                          <td className="whitespace-nowrap py-2 font-medium">{record.date}</td>
                          <td className="py-2">{record.name}</td>
                          <td className="py-2 font-mono text-xs">{record.rollNumber}</td>
                          <td className="py-2">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                record.status === "Present"
                                  ? "bg-success/10 text-success"
                                  : record.status === "Late"
                                    ? "bg-warning/20 text-warning-foreground"
                                    : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {record.status}
                            </span>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">{record.note || "—"}</td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">
                            {record.ipAddress || "—"}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        No attendance records recorded for this user yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Attendance Notification History */}
          <Panel title="Attendance Notification History">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-xs text-muted-foreground">
                All attendance alerts generated for this user — when records were{" "}
                <strong>marked</strong>, <strong>modified</strong>, or <strong>deleted</strong>.
              </p>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {(userAttendanceAlertsQuery.data ?? []).length} alerts
              </span>
            </div>

            {userAttendanceAlertsQuery.isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Loading notification history…
              </div>
            ) : (userAttendanceAlertsQuery.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                <ClipboardCheck className="mx-auto mb-2 size-5 opacity-40" />
                No attendance notifications recorded for this user yet.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {(userAttendanceAlertsQuery.data ?? []).map((alert) => {
                  const isDeleted = alert.title.toLowerCase().includes("deleted");
                  const isModified = alert.title.toLowerCase().includes("modified");

                  const actionLabel = isDeleted ? "🗑️ Deleted" : isModified ? "✏️ Modified" : "📋 Marked";
                  const actionBadgeClass = isDeleted
                    ? "bg-destructive/10 text-destructive border border-destructive/20"
                    : isModified
                      ? "bg-warning/15 text-warning-foreground border border-warning/30"
                      : "bg-success/10 text-success border border-success/20";

                  const severityBadgeClass =
                    alert.severity === "HIGH" || alert.severity === "CRITICAL"
                      ? "bg-destructive/10 text-destructive"
                      : alert.severity === "MEDIUM"
                        ? "bg-warning/15 text-warning-foreground"
                        : "bg-success/10 text-success";

                  const rowBg = isDeleted
                    ? "bg-destructive/5"
                    : isModified
                      ? "bg-warning/5"
                      : "";

                  return (
                    <div key={alert.id} className={`flex flex-wrap items-start gap-3 px-3 py-3 text-sm ${rowBg}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${actionBadgeClass}`}>
                            {actionLabel}
                          </span>
                          <span className="font-medium text-xs truncate">{alert.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${severityBadgeClass}`}>
                            {alert.severity}
                          </span>
                        </div>
                        {alert.description && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            {alert.description}
                          </p>
                        )}
                      </div>
                      <time className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                        {formatWhen(alert.created_at)}
                      </time>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}
    </AdminShell>
  );
}
