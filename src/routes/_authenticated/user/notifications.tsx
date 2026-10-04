import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  Edit3,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { markAlertsAsRead } from "@/lib/security.functions";
import { formatWhen, useAlerts, useSecurityRealtime } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/notifications")({
  head: () => ({
    meta: [
      { title: "Security & Attendance Alerts — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Real-time alerts for attendance modifications, deletions, new devices, and security events.",
      },
      { property: "og:title", content: "Security & Attendance Alerts" },
      { property: "og:description", content: "Real-time account alerts & attendance activity history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  useSecurityRealtime();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const markReadFn = useServerFn(markAlertsAsRead);
  const [filter, setFilter] = useState<"ALL" | "ATTENDANCE" | "SECURITY" | "UNREAD">("ALL");
  const [search, setSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const unread = (alerts.data ?? []).filter((a) => !a.read).length;

  const markRead = useMutation({
    mutationFn: async (id?: string) => {
      try {
        await markReadFn({ data: { id } });
      } catch {
        // Fallback to client Supabase call
        const query = supabase.from("security_alerts").update({ read: true });
        const { error } = id ? await query.eq("id", id) : await query.eq("read", false);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
      toast.success("Notifications updated");
    },
    onError: (e: Error) => toast.error("Could not update alert", { description: e.message }),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await alerts.refetch();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  const allAlerts = alerts.data ?? [];

  const attendanceCount = allAlerts.filter(
    (a) =>
      a.category === "attendance" ||
      a.title.toLowerCase().includes("attendance") ||
      (a.description?.toLowerCase().includes("attendance") ?? false),
  ).length;

  const securityCount = allAlerts.length - attendanceCount;

  const filteredAlerts = allAlerts.filter((a) => {
    const isAttendance =
      a.category === "attendance" ||
      a.title.toLowerCase().includes("attendance") ||
      (a.description?.toLowerCase().includes("attendance") ?? false);

    if (filter === "ATTENDANCE" && !isAttendance) return false;
    if (filter === "SECURITY" && isAttendance) return false;
    if (filter === "UNREAD" && a.read) return false;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchTitle = a.title.toLowerCase().includes(q);
      const matchDesc = a.description ? a.description.toLowerCase().includes(q) : false;
      const matchCat = a.category.toLowerCase().includes(q);
      const matchSev = a.severity.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchCat && !matchSev) return false;
    }

    return true;
  });

  return (
    <AppShell unread={unread}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Notifications & Audit</p>
          <h1 className="text-2xl font-semibold">Security & Attendance Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live stream of account security alerts and attendance history (recorded, modified, or deleted records).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={alerts.isFetching || isRefreshing}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${alerts.isFetching || isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck className="mr-2 size-4" /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
              filter === "ALL"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            All Alerts ({allAlerts.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ATTENDANCE")}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
              filter === "ATTENDANCE"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardCheck className="size-3.5" />
            Attendance History ({attendanceCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("SECURITY")}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
              filter === "SECURITY"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shield className="size-3.5" />
            Security Alerts ({securityCount})
          </button>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => setFilter("UNREAD")}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-colors ${
                filter === "UNREAD"
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "bg-warning/20 text-warning-foreground hover:bg-warning/30"
              }`}
            >
              <Bell className="size-3.5" />
              Unread ({unread})
            </button>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Filter notifications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="panel mt-4 divide-y divide-border">
        {alerts.isLoading && (
          <p className="p-10 text-center text-sm text-muted-foreground">Loading alerts…</p>
        )}
        {alerts.isError && (
          <div className="p-10 text-center">
            <p className="text-sm text-destructive">Could not load security alerts.</p>
            <p className="mt-1 text-xs text-muted-foreground">{alerts.error.message}</p>
            <Button className="mt-4" variant="outline" onClick={() => void alerts.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {filteredAlerts.map((a) => {
          const isAttendance =
            a.category === "attendance" ||
            a.title.toLowerCase().includes("attendance") ||
            (a.description?.toLowerCase().includes("attendance") ?? false);

          const isDeleted =
            a.title.toLowerCase().includes("deleted") ||
            (a.description?.toLowerCase().includes("deleted") ?? false);

          const isModified =
            a.title.toLowerCase().includes("modified") ||
            (a.description?.toLowerCase().includes("modified") ?? false);

          return (
            <article key={a.id} className="flex gap-4 p-5 transition-colors hover:bg-surface/50">
              <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                {isAttendance ? (
                  isDeleted ? (
                    <Trash2 className="size-4 text-destructive" />
                  ) : isModified ? (
                    <Edit3 className="size-4 text-warning" />
                  ) : (
                    <ClipboardCheck className="size-4 text-success" />
                  )
                ) : a.severity === "CRITICAL" || a.severity === "HIGH" ? (
                  <ShieldAlert className="size-4 text-destructive" />
                ) : (
                  <Shield className="size-4 text-accent" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-foreground">{a.title}</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      isDeleted || a.severity === "CRITICAL" || a.severity === "HIGH"
                        ? "bg-destructive/10 text-destructive"
                        : isModified || a.severity === "MEDIUM"
                          ? "bg-warning/15 text-warning-foreground"
                          : "bg-success/10 text-success"
                    }`}
                  >
                    {isDeleted ? "DELETED" : isModified ? "MODIFIED" : a.severity}
                  </span>
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {isAttendance ? "ATTENDANCE" : a.category || "SECURITY"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatWhen(a.created_at)}
                  </span>
                </div>
                {a.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{a.description}</p>
                )}
                {!a.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2.5 h-7 px-2 text-xs font-medium text-accent"
                    onClick={() => markRead.mutate(a.id)}
                  >
                    Mark as read
                  </Button>
                )}
              </div>
            </article>
          );
        })}

        {!alerts.isLoading && !alerts.isError && filteredAlerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
            <BellOff className="size-6" />
            <p className="text-sm">
              {search.trim()
                ? `No notifications found matching "${search}".`
                : filter === "ALL"
                  ? "No alerts found. Your account is secure."
                  : filter === "ATTENDANCE"
                    ? "No attendance history alerts recorded yet."
                    : filter === "UNREAD"
                      ? "No unread alerts. You are all caught up!"
                      : "No security alerts recorded yet."}
            </p>
            {search.trim() ? (
              <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="mt-2 text-xs">
                Clear search
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2 text-xs">
                <RefreshCw className="mr-1.5 size-3.5" /> Refresh notifications
              </Button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
