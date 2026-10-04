import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { adminSecurityEvents } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { exportSecurityAuditPdf, exportToCsv, type SecurityEventReportItem } from "@/lib/report-export";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/events")({
  head: () => ({
    meta: [
      { title: "Security events — Sentinel Admin" },
      {
        name: "description",
        content: "Live security events across user accounts for authorised administrators.",
      },
    ],
  }),
  component: AdminEvents,
});

function AdminEvents() {
  const load = useServerFn(adminSecurityEvents);
  const realtimeStatus = useAdminRealtime();
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "events", highRiskOnly],
    queryFn: () => load({ data: { highRiskOnly } }),
  });

  const exportItems: SecurityEventReportItem[] = (data ?? []).map((e: any) => ({
    id: e.id,
    created_at: e.created_at,
    event_type: prettyEvent(e.event_type),
    user_email: e.user?.email,
    user_name: e.user?.full_name,
    ip_address: e.ip_address,
    region: e.region,
    device: e.device_summary ?? (e.device ? `${e.device.browser || ""} ${e.device.os || ""}`.trim() : "—"),
    risk_score: e.risk_score ?? 0,
    risk_level: e.risk_level ?? "LOW",
    status: e.status ?? "Processed",
  }));

  const handleExportCsv = () => {
    if (!exportItems.length) {
      toast.warning("No security events to export");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const headers = ["Timestamp", "Event Type", "User Name", "Email", "IP Address", "Region", "Device", "Risk Score", "Risk Level", "Status"];
    const rows = exportItems.map((s) => [
      s.created_at,
      s.event_type,
      s.user_name || "—",
      s.user_email || "—",
      s.ip_address || "—",
      s.region || "—",
      s.device || "—",
      s.risk_score,
      s.risk_level,
      s.status,
    ]);
    exportToCsv(`Sentinel_Security_Events_${stamp}`, headers, rows);
    toast.success("Security events CSV exported successfully");
  };

  const handleExportPdf = () => {
    if (!exportItems.length) {
      toast.warning("No security events to export");
      return;
    }
    exportSecurityAuditPdf(exportItems, {
      dateRange: highRiskOnly ? "High-Risk Events Only" : "All Security Events",
      generatedBy: "Sentinel Admin",
    });
    toast.success("Security events PDF report generated successfully");
  };

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Security events</h1>
            <span
              className={
                realtimeStatus === "SUBSCRIBED" ? "text-xs text-success" : "text-xs text-warning"
              }
            >
              {realtimeStatus === "SUBSCRIBED" ? "Live" : `Realtime ${realtimeStatus.toLowerCase()}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live authentication and account-security events. Risk scores are signals for human review.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5 text-xs shadow-2xs">
            <FileSpreadsheet className="size-3.5 text-emerald-600" />
            Export CSV
          </Button>
          <Button size="sm" onClick={handleExportPdf} className="gap-1.5 bg-navy text-navy-foreground text-xs shadow-2xs hover:bg-navy/90">
            <FileText className="size-3.5 text-blue-400" />
            Export PDF Report
          </Button>
        </div>
      </div>

      <label className="mt-4 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={highRiskOnly}
          onChange={(event) => setHighRiskOnly(event.target.checked)}
          className="size-4 accent-primary"
        />
        High-risk events only
      </label>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">IP address</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Region</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Loading security events…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-destructive">
                  Security events could not be loaded.
                </td>
              </tr>
            )}
            {(data ?? []).map((event) => (
              <tr key={event.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2">{formatWhen(event.created_at)}</td>
                <td className="px-3 py-2 font-medium">{prettyEvent(event.event_type)}</td>
                <td className="px-3 py-2">
                  {event.user ? (
                    <Link
                      to="/admin/users/$id"
                      params={{ id: event.user.id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      <div>{event.user.full_name ?? "Unnamed user"}</div>
                      <div className="text-xs text-muted-foreground">{event.user.email}</div>
                    </Link>
                  ) : (
                    "Unknown user"
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{event.ip_address ?? "—"}</td>
                <td className="px-3 py-2">{[event.browser, event.os].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-3 py-2">{event.location_label ?? "—"}</td>
                <td className="px-3 py-2">
                  <RiskBadge score={event.risk_score} level={event.risk_level} />
                </td>
                <td className="px-3 py-2">{event.status ?? "—"}</td>
              </tr>
            ))}
            {!isLoading && !isError && !(data ?? []).length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No security events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
