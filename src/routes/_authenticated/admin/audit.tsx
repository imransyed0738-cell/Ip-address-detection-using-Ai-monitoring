import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { adminAuditLog } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { exportToCsv } from "@/lib/report-export";
import { formatWhen } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit log — Sentinel Admin" },
      {
        name: "description",
        content: "Authorised administrator actions and security events recorded by the server.",
      },
    ],
  }),
  component: AdminAudit,
});

function AdminAudit() {
  const load = useServerFn(adminAuditLog);
  const realtimeStatus = useAdminRealtime();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => load(),
  });

  const handleExportCsv = () => {
    if (!data?.length) {
      toast.warning("No audit entries to export");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const headers = ["Timestamp", "Action", "Actor Role", "Actor ID", "Resource", "IP Address", "Result"];
    const rows = (data as any[]).map((entry) => [
      entry.created_at,
      entry.action,
      entry.actor_role || "—",
      entry.actor_id || "—",
      entry.resource || "—",
      entry.ip_address || "—",
      entry.result || "—",
    ]);
    exportToCsv(`Sentinel_Audit_Log_${stamp}`, headers, rows);
    toast.success("Audit log CSV exported successfully");
  };

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Audit log</h1>
            <span
              className={
                realtimeStatus === "SUBSCRIBED" ? "text-xs text-success" : "text-xs text-warning"
              }
            >
              {realtimeStatus === "SUBSCRIBED" ? "Live" : `Realtime ${realtimeStatus.toLowerCase()}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Server-recorded administrator actions and user security events. Entries cannot be edited from this view.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={handleExportCsv} className="gap-1.5 text-xs shadow-2xs">
          <FileSpreadsheet className="size-3.5 text-emerald-600" />
          Export CSV
        </Button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">IP address</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Loading audit entries…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-destructive">
                  Audit log could not be loaded.
                </td>
              </tr>
            )}
            {(data ?? []).map((entry) => (
              <tr key={entry.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2">{formatWhen(entry.created_at)}</td>
                <td className="px-3 py-2 font-medium">{entry.action}</td>
                <td className="px-3 py-2">
                  <div>{entry.actor_role ?? "Unknown"}</div>
                  <div className="font-mono text-xs text-muted-foreground">{entry.actor_id ?? "—"}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{entry.resource ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{entry.ip_address ?? "—"}</td>
                <td className="px-3 py-2">{entry.result ?? "—"}</td>
              </tr>
            ))}
            {!isLoading && !isError && !(data ?? []).length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No audit entries recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
