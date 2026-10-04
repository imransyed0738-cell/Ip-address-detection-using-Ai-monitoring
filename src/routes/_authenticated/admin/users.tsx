import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  Users,
  Wifi,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminListUsers, adminUserAction, type MonitoredUser } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { formatWhen } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "User Directory & Security Surveillance — Sentinel Admin" },
      {
        name: "description",
        content: "Account status, real-time sign-in, devices, and explainable risk level for every user.",
      },
      { property: "og:title", content: "User Directory & Security Surveillance — Sentinel Admin" },
      { property: "og:description", content: "Administrator view of account security status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminUsers,
});

function AdminUsers() {
  const queryClient = useQueryClient();
  const load = useServerFn(adminListUsers);
  const act = useServerFn(adminUserAction);
  const realtimeStatus = useAdminRealtime();

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ONLINE" | "HIGH_RISK" | "LOCKED" | "REVIEW">("ALL");
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const { data, error, isError, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => load(),
    refetchInterval: 5000,
  });

  const quickAction = useMutation({
    mutationFn: (input: { userId: string; action: any; note?: string }) =>
      act({ data: { userId: input.userId, action: input.action, ...(input.note ? { note: input.note } : {}) } }),
    onSuccess: (_, vars) => {
      toast.success(`Action '${vars.action}' applied successfully`);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Action failed");
    },
  });

  const users = (data ?? []) as MonitoredUser[];

  const rows = users.filter((u) => {
    const matchesQuery = `${u.full_name ?? ""} ${u.email ?? ""} ${u.lastIp ?? ""} ${u.location_label ?? ""}`
      .toLowerCase()
      .includes(q.toLowerCase());
    if (!matchesQuery) return false;

    if (filter === "ONLINE") return u.onlineStatus === "ONLINE";
    if (filter === "HIGH_RISK") return u.riskScore >= 51;
    if (filter === "LOCKED") return u.account_locked;
    if (filter === "REVIEW") return u.flagged_for_review;
    return true;
  });

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIp(text);
    toast.success("IP copied to clipboard");
    setTimeout(() => setCopiedIp(null), 2000);
  };

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Registered Users & Live Surveillance</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                realtimeStatus === "SUBSCRIBED"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-warning/15 text-warning border border-warning/30"
              }`}
            >
              <span
                className={`size-2 rounded-full ${
                  realtimeStatus === "SUBSCRIBED" ? "bg-success animate-pulse" : "bg-warning"
                }`}
              />
              {realtimeStatus === "SUBSCRIBED" ? "Live Stream Active" : `Realtime ${realtimeStatus.toLowerCase()}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete directory of all registered accounts with real-time authentication status, geolocation, device metadata, and risk posture.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isRefetching}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link to="/admin/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Admin Dashboard
          </Link>
        </div>
      </div>

      {/* Filter Tabs & Search Box */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 text-sm"
            placeholder="Search by name, email, IP or location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={filter === "ALL" ? "default" : "outline"}
            onClick={() => setFilter("ALL")}
            className="h-8 text-xs"
          >
            All Users ({users.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "ONLINE" ? "default" : "outline"}
            onClick={() => setFilter("ONLINE")}
            className="h-8 text-xs flex items-center gap-1"
          >
            <span className="size-2 rounded-full bg-success animate-pulse" />
            Online ({users.filter((u) => u.onlineStatus === "ONLINE").length})
          </Button>
          <Button
            size="sm"
            variant={filter === "HIGH_RISK" ? "default" : "outline"}
            onClick={() => setFilter("HIGH_RISK")}
            className="h-8 text-xs"
          >
            High Risk ({users.filter((u) => u.riskScore >= 51).length})
          </Button>
          <Button
            size="sm"
            variant={filter === "LOCKED" ? "default" : "outline"}
            onClick={() => setFilter("LOCKED")}
            className="h-8 text-xs"
          >
            Locked ({users.filter((u) => u.account_locked).length})
          </Button>
          <Button
            size="sm"
            variant={filter === "REVIEW" ? "default" : "outline"}
            onClick={() => setFilter("REVIEW")}
            className="h-8 text-xs"
          >
            Under Review ({users.filter((u) => u.flagged_for_review).length})
          </Button>
        </div>
      </div>

      {/* Main Users Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">User & Identity</th>
              <th className="px-4 py-3 font-semibold">Live Status</th>
              <th className="px-4 py-3 font-semibold">Observed IP</th>
              <th className="px-4 py-3 font-semibold">Geolocation</th>
              <th className="px-4 py-3 font-semibold">Device</th>
              <th className="px-4 py-3 font-semibold">Risk & Level</th>
              <th className="px-4 py-3 font-semibold">Last Active</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="size-5 animate-spin text-primary" />
                    <span>Loading registered users…</span>
                  </div>
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <p className="text-sm text-destructive">Could not load users and security data.</p>
                  <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
                  <Button className="mt-3" variant="outline" size="sm" onClick={() => void refetch()}>
                    Try again
                  </Button>
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const isOnline = u.onlineStatus === "ONLINE";
              const isRecent = u.onlineStatus === "RECENTLY_ACTIVE";
              const mapQuery =
                u.lat != null && u.lng != null
                  ? `${u.lat},${u.lng}`
                  : u.location_label
                    ? encodeURIComponent(u.location_label)
                    : null;

              return (
                <tr key={u.id} className="hover:bg-muted/40 transition-colors">
                  {/* User Column */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {(u.full_name || u.email || "U").charAt(0).toUpperCase()}
                        <span
                          className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-card ${
                            u.account_locked
                              ? "bg-destructive"
                              : isOnline
                                ? "bg-success"
                                : isRecent
                                  ? "bg-warning"
                                  : "bg-muted-foreground"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <Link
                          to="/admin/users/$id"
                          params={{ id: u.id }}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {u.full_name || "Unnamed User"}
                        </Link>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {u.account_locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive border border-destructive/20">
                        <Lock className="size-3" /> Locked
                      </span>
                    ) : u.flagged_for_review ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground border border-warning/30">
                        Under review
                      </span>
                    ) : isOnline ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success border border-success/30">
                        <span className="size-1.5 rounded-full bg-success animate-ping" />
                        Online Now
                      </span>
                    ) : isRecent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning border border-warning/20">
                        Active today
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                        Offline
                      </span>
                    )}
                  </td>

                  {/* IP Address */}
                  <td className="px-4 py-3">
                    {u.lastIp ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-medium">{u.lastIp}</span>
                        <button
                          onClick={() => handleCopy(u.lastIp!)}
                          title="Copy IP"
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                          {copiedIp === u.lastIp ? (
                            <Check className="size-3 text-success" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Geolocation */}
                  <td className="px-4 py-3 text-xs">
                    {u.location_label ? (
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[140px]" title={u.location_label}>
                          {u.location_label}
                        </span>
                        {mapQuery && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open in Google Maps"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Not resolved</span>
                    )}
                    {u.lat != null && u.lng != null && (
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {u.lat.toFixed(3)}, {u.lng.toFixed(3)}
                      </div>
                    )}
                  </td>

                  {/* Device Info */}
                  <td className="px-4 py-3 text-xs">
                    {u.lastDevice ? (
                      <div>
                        <div className="font-medium truncate max-w-[130px]">
                          {u.lastDevice.deviceName ||
                            [u.lastDevice.browser, u.lastDevice.os].filter(Boolean).join(" · ") ||
                            "Device"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {u.deviceCount} registered {u.deviceCount === 1 ? "device" : "devices"}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No devices</span>
                    )}
                  </td>

                  {/* Risk Badge */}
                  <td className="px-4 py-3">
                    <RiskBadge score={u.riskScore} level={u.riskLevel} />
                  </td>

                  {/* Last Active */}
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {u.lastActiveAt ? formatWhen(u.lastActiveAt) : "Never"}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
                        <Link to="/admin/users/$id" params={{ id: u.id }}>
                          Investigate
                        </Link>
                      </Button>
                      {u.account_locked ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-success hover:bg-success/10"
                          disabled={quickAction.isPending}
                          onClick={() => quickAction.mutate({ userId: u.id, action: "UNLOCK" })}
                          title="Unlock account"
                        >
                          <Unlock className="size-3" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                          disabled={quickAction.isPending}
                          onClick={() => quickAction.mutate({ userId: u.id, action: "LOCK" })}
                          title="Lock account"
                        >
                          <Lock className="size-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && !rows.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No users match the search and filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
