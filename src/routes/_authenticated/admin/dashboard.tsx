import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Crosshair,
  ExternalLink,
  Globe2,
  Laptop,
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
import { adminOverview, adminUserAction, type MonitoredUser } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { getAdminAttendanceAlerts, getAttendanceLogs, lookupIpAddress } from "@/lib/security.functions";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Security Overview & Live User Monitoring — Sentinel Admin" },
      {
        name: "description",
        content: "Live security overview and real-time user monitoring of logins, IP locations, risk levels and accounts.",
      },
      { property: "og:title", content: "Security Overview & Live User Monitoring — Sentinel Admin" },
      { property: "og:description", content: "Live administrator security monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminDashboard,
});

function Stat({
  label,
  value,
  icon: Icon,
  trend,
  badge,
}: {
  label: string;
  value: number;
  icon: any;
  trend?: string;
  badge?: string;
}) {
  return (
    <div className="panel flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:border-border/80">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-secondary/80 text-foreground">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
            {badge && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success animate-pulse">
                {badge}
              </span>
            )}
          </div>
          <div className="label-caps text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
      {trend && <div className="text-[11px] font-medium text-muted-foreground">{trend}</div>}
    </div>
  );
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const load = useServerFn(adminOverview);
  const act = useServerFn(adminUserAction);
  const lookupFn = useServerFn(lookupIpAddress);
  const getLogsFn = useServerFn(getAttendanceLogs);
  const realtimeStatus = useAdminRealtime();

  const [ipToTrack, setIpToTrack] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"ALL" | "ONLINE" | "HIGH_RISK" | "LOCKED" | "REVIEW">("ALL");
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => load(),
    refetchInterval: 5000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["admin", "recentAttendance"],
    queryFn: () => getLogsFn({ data: { limit: 10 } }),
    refetchInterval: 10000,
  });

  const getAlertsFn = useServerFn(getAdminAttendanceAlerts);
  const attendanceAlertsQuery = useQuery({
    queryKey: ["admin", "attendanceAlerts"],
    queryFn: () => getAlertsFn(),
    refetchInterval: 10000,
  });

  const ipLookup = useMutation({
    mutationFn: (ip: string) => lookupFn({ data: { ip } }),
    onError: (error: Error) => toast.error("IP lookup failed", { description: error.message }),
  });

  const quickAction = useMutation({
    mutationFn: (input: { userId: string; action: any; note?: string }) =>
      act({ data: { userId: input.userId, action: input.action, ...(input.note ? { note: input.note } : {}) } }),
    onSuccess: (_, vars) => {
      toast.success(`Action '${vars.action}' completed successfully`);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Action failed");
    },
  });

  const monitoredUsers = (data?.monitoredUsers ?? []) as MonitoredUser[];

  const filteredUsers = monitoredUsers.filter((u) => {
    const matchesQuery = `${u.full_name ?? ""} ${u.email ?? ""} ${u.lastIp ?? ""} ${u.location_label ?? ""}`
      .toLowerCase()
      .includes(userSearch.toLowerCase());
    if (!matchesQuery) return false;

    if (userFilter === "ONLINE") return u.onlineStatus === "ONLINE";
    if (userFilter === "HIGH_RISK") return u.riskScore >= 51;
    if (userFilter === "LOCKED") return u.account_locked;
    if (userFilter === "REVIEW") return u.flagged_for_review;
    return true;
  });

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIp(text);
    toast.success("IP copied to clipboard");
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const handleTrackIp = (ip: string) => {
    setIpToTrack(ip);
    ipLookup.mutate(ip);
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  return (
    <AdminShell>
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Security & User Monitoring Dashboard</h1>
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
            Continuous real-time surveillance of user authentication, active IPs, device metadata, geolocation, and risk posture.
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
          <Link to="/admin/attendance" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ClipboardCheck className="mr-1.5 size-3.5" /> Attendance Dashboard
          </Link>
        </div>
      </div>

      {/* Top Stat Metrics Grid */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Registered Users"
          value={data?.users ?? 0}
          icon={Users}
          trend="Total in database"
        />
        <Stat
          label="Online Now"
          value={data?.onlineNowCount ?? 0}
          icon={Wifi}
          badge="Live"
          trend="Active past 15 min"
        />
        <Stat
          label="Active Users (24h)"
          value={data?.activeUsers ?? 0}
          icon={Activity}
          trend="Logged in recently"
        />
        <Stat
          label="Live IP Addresses"
          value={data?.liveIpCount ?? 0}
          icon={MapPin}
          trend="Unique observed IPs"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Geo Regions Monitored"
          value={data?.geoRegions ?? 0}
          icon={Globe2}
          trend="Global locations"
        />
        <Stat
          label="Security Events (24h)"
          value={data?.events24 ?? 0}
          icon={ShieldCheck}
          trend="Authentication & ops"
        />
        <Stat
          label="High-Risk Anomalies"
          value={data?.highRiskCount ?? 0}
          icon={ShieldAlert}
          trend="Score >= 51"
        />
        <Stat
          label="Locked Accounts"
          value={data?.locked ?? 0}
          icon={Lock}
          trend="Security isolation"
        />
      </div>

      {/* MAIN LIVE USER MONITORING MATRIX */}
      <section className="panel mt-8 p-5 border border-border rounded-xl bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Live User Monitoring Matrix</h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {filteredUsers.length} of {monitoredUsers.length} Users
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Real-time monitoring of all registered user accounts with live status, IP addresses, geolocations, devices, and risk scores.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/users" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Full User Registry <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search user by name, email, IP or location…"
              className="pl-9 text-sm"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={userFilter === "ALL" ? "default" : "outline"}
              onClick={() => setUserFilter("ALL")}
              className="h-8 text-xs"
            >
              All ({monitoredUsers.length})
            </Button>
            <Button
              size="sm"
              variant={userFilter === "ONLINE" ? "default" : "outline"}
              onClick={() => setUserFilter("ONLINE")}
              className="h-8 text-xs flex items-center gap-1"
            >
              <span className="size-2 rounded-full bg-success animate-pulse" />
              Online ({monitoredUsers.filter((u) => u.onlineStatus === "ONLINE").length})
            </Button>
            <Button
              size="sm"
              variant={userFilter === "HIGH_RISK" ? "default" : "outline"}
              onClick={() => setUserFilter("HIGH_RISK")}
              className="h-8 text-xs"
            >
              High Risk ({monitoredUsers.filter((u) => u.riskScore >= 51).length})
            </Button>
            <Button
              size="sm"
              variant={userFilter === "LOCKED" ? "default" : "outline"}
              onClick={() => setUserFilter("LOCKED")}
              className="h-8 text-xs"
            >
              Locked ({monitoredUsers.filter((u) => u.account_locked).length})
            </Button>
            <Button
              size="sm"
              variant={userFilter === "REVIEW" ? "default" : "outline"}
              onClick={() => setUserFilter("REVIEW")}
              className="h-8 text-xs"
            >
              Under Review ({monitoredUsers.filter((u) => u.flagged_for_review).length})
            </Button>
          </div>
        </div>

        {/* User Monitoring Table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">User & Identity</th>
                <th className="px-4 py-3 font-semibold">Live Status</th>
                <th className="px-4 py-3 font-semibold">Observed IP Address</th>
                <th className="px-4 py-3 font-semibold">Geolocation</th>
                <th className="px-4 py-3 font-semibold">Device & Platform</th>
                <th className="px-4 py-3 font-semibold">Risk & Security</th>
                <th className="px-4 py-3 font-semibold">Last Active</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="size-5 animate-spin text-primary" />
                      <span>Loading real-time user surveillance data…</span>
                    </div>
                  </td>
                </tr>
              )}

              {filteredUsers.map((user) => {
                const isOnline = user.onlineStatus === "ONLINE";
                const isRecent = user.onlineStatus === "RECENTLY_ACTIVE";
                const mapQuery =
                  user.lat != null && user.lng != null
                    ? `${user.lat},${user.lng}`
                    : user.location_label
                      ? encodeURIComponent(user.location_label)
                      : null;

                return (
                  <tr
                    key={user.id}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    {/* User Identity */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {(user.full_name || user.email || "U").charAt(0).toUpperCase()}
                          <span
                            className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-card ${
                              user.account_locked
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
                            params={{ id: user.id }}
                            className="font-medium text-foreground hover:text-primary hover:underline flex items-center gap-1"
                          >
                            <span className="truncate">{user.full_name || "Unnamed User"}</span>
                          </Link>
                          <div className="text-xs text-muted-foreground truncate">{user.email || "No email"}</div>
                        </div>
                      </div>
                    </td>

                    {/* Live Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {user.account_locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive border border-destructive/20">
                          <Lock className="size-3" /> Locked
                        </span>
                      ) : user.flagged_for_review ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground border border-warning/30">
                          Review
                        </span>
                      ) : isOnline ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success border border-success/30">
                          <span className="size-1.5 rounded-full bg-success animate-ping" />
                          Online Now
                        </span>
                      ) : isRecent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning border border-warning/20">
                          Recent
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                          Offline
                        </span>
                      )}
                    </td>

                    {/* IP Address */}
                    <td className="px-4 py-3">
                      {user.lastIp ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-medium">{user.lastIp}</span>
                          <button
                            onClick={() => handleCopy(user.lastIp!)}
                            title="Copy IP"
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                          >
                            {copiedIp === user.lastIp ? (
                              <Check className="size-3 text-success" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                          <button
                            onClick={() => handleTrackIp(user.lastIp!)}
                            title="Track this IP"
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-accent transition-colors"
                          >
                            <Crosshair className="size-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Geolocation */}
                    <td className="px-4 py-3 text-xs">
                      {user.location_label ? (
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[140px]" title={user.location_label}>
                            {user.location_label}
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
                      {user.lat != null && user.lng != null && (
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {user.lat.toFixed(3)}, {user.lng.toFixed(3)}
                        </div>
                      )}
                    </td>

                    {/* Device & Platform */}
                    <td className="px-4 py-3 text-xs">
                      {user.lastDevice ? (
                        <div>
                          <div className="font-medium truncate max-w-[130px]">
                            {user.lastDevice.deviceName ||
                              [user.lastDevice.browser, user.lastDevice.os].filter(Boolean).join(" · ") ||
                              "Device"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {user.deviceCount} registered {user.deviceCount === 1 ? "device" : "devices"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No devices</span>
                      )}
                    </td>

                    {/* Risk & Security */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <RiskBadge score={user.riskScore} level={user.riskLevel} />
                        {user.riskReasons.length > 0 && (
                          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={user.riskReasons.join(", ")}>
                            {user.riskReasons[0]}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Last Active */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                      {user.lastActiveAt ? formatWhen(user.lastActiveAt) : "Never"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                          <Link to="/admin/users/$id" params={{ id: user.id }}>
                            Investigate
                          </Link>
                        </Button>
                        {user.account_locked ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs text-success hover:bg-success/10"
                            disabled={quickAction.isPending}
                            onClick={() => quickAction.mutate({ userId: user.id, action: "UNLOCK" })}
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
                            onClick={() => quickAction.mutate({ userId: user.id, action: "LOCK" })}
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

              {!isLoading && !filteredUsers.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    No users found matching the selected filter or search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* IP TRACKER SECTION */}
      <section className="panel mt-8 p-5 border border-border rounded-xl bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair className="size-5 text-accent" />
              <p className="label-caps font-semibold">Live IP & Location Resolver</p>
            </div>
            <h2 className="mt-1 text-lg font-semibold">Track Public IP Address</h2>
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
              Resolve real-time geographic location, autonomous system (ASN), ISP, and matching registered user devices for any IP.
            </p>
          </div>
        </div>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const ip = ipToTrack.trim();
            if (ip) ipLookup.mutate(ip);
          }}
        >
          <Input
            className="font-mono sm:max-w-md text-sm"
            placeholder="e.g. 103.156.19.45 or 8.8.8.8"
            aria-label="Public IP address"
            value={ipToTrack}
            onChange={(event) => setIpToTrack(event.target.value)}
          />
          <Button type="submit" disabled={!ipToTrack.trim() || ipLookup.isPending}>
            <Crosshair className="mr-2 size-4" />
            {ipLookup.isPending ? "Resolving Location…" : "Track IP"}
          </Button>
        </form>

        {ipLookup.data && (
          <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Device Match</div>
              <div className="mt-1 text-sm font-medium">{ipLookup.data.deviceName ?? "External Public IP"}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Resolved IP</div>
              <div className="mt-1 font-mono text-xs font-semibold">{ipLookup.data.ip}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Location</div>
              <div className="mt-1 text-sm">{ipLookup.data.publicAddress}</div>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">Network / ISP</div>
              <div className="mt-1 text-sm">{ipLookup.data.organization ?? "ISP unavailable"}</div>
            </div>
            <div className="flex items-end rounded-lg border border-border bg-background p-3">
              {ipLookup.data.latitude != null && ipLookup.data.longitude != null ? (
                <Button asChild size="sm" variant="outline" className="w-full">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ipLookup.data.latitude},${ipLookup.data.longitude}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="mr-1.5 size-3.5" />
                    Open Maps
                  </a>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Coordinates unavailable</span>
              )}
            </div>
          </div>
        )}
        {ipLookup.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {ipLookup.error.message}
          </p>
        )}
      </section>

      {/* RECENT SECURITY EVENTS */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Security Activity Stream</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recent authentication attempts, logins, and security events across all users.
            </p>
          </div>
          <Link
            to="/admin/events"
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            View all security events →
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">IP address</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">User</th>
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
              {(data?.recent ?? []).map((e: any) => (
                <tr key={e.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{formatWhen(e.created_at)}</td>
                  <td className="px-3 py-2 font-medium text-xs">{prettyEvent(e.event_type)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ip_address ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {[e.device_type, e.browser, e.os].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.location_label ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <RiskBadge score={e.risk_score} level={e.risk_level} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
                      {e.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {e.user ? (
                      <Link
                        to="/admin/users/$id"
                        params={{ id: e.user_id }}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        <div className="font-medium text-xs">{e.user.full_name ?? "User"}</div>
                        <div className="text-[11px] text-muted-foreground">{e.user.email}</div>
                      </Link>
                    ) : e.user_id ? (
                      <Link
                        to="/admin/users/$id"
                        params={{ id: e.user_id }}
                        className="text-primary underline-offset-2 hover:underline text-xs"
                      >
                        Investigate
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoading && !(data?.recent ?? []).length && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No security events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* CENTRAL ATTENDANCE HISTORY */}
      <section className="panel mt-8 p-5 border border-border rounded-xl bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-5 text-accent" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-lg">Central User Attendance Logs</h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {(attendanceQuery.data ?? []).length} Records
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Live records of attendance entries submitted or modified by users and administrators.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/attendance">
                Full Attendance Operations <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Student / User</th>
                <th className="px-3 py-2 font-semibold">Roll / ID</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Note</th>
                <th className="px-3 py-2 font-semibold">Observed IP</th>
                <th className="px-3 py-2 font-semibold">Recorded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attendanceQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Loading attendance records…
                  </td>
                </tr>
              ) : (attendanceQuery.data ?? []).length ? (
                (attendanceQuery.data ?? []).map((record: any) => (
                  <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-xs">
                      {record.date}
                    </td>
                    <td className="px-3 py-2 font-medium text-xs">
                      {record.name}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {record.rollNumber}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          record.status === "Present"
                            ? "bg-success/10 text-success border border-success/20"
                            : record.status === "Late"
                              ? "bg-warning/20 text-warning-foreground border border-warning/30"
                              : record.status === "Absent"
                                ? "bg-destructive/10 text-destructive border border-destructive/20"
                                : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {record.note || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {record.ipAddress || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {record.createdAt ? formatWhen(record.createdAt) : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No attendance records logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ATTENDANCE CHANGE ALERTS */}
      <section className="panel mt-8 p-5 border border-border rounded-xl bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-lg">Attendance Change Alerts</h2>
                <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                  {(attendanceAlertsQuery.data ?? []).length} Events
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                History of all attendance records that were <strong>deleted</strong> or <strong>modified</strong> by administrators or users.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void attendanceAlertsQuery.refetch()}
            disabled={attendanceAlertsQuery.isFetching}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${attendanceAlertsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Alert</th>
                <th className="px-3 py-2 font-semibold">Details</th>
                <th className="px-3 py-2 font-semibold">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {attendanceAlertsQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="size-4 animate-spin text-primary" />
                      Loading attendance alerts…
                    </div>
                  </td>
                </tr>
              ) : (attendanceAlertsQuery.data ?? []).length ? (
                (attendanceAlertsQuery.data ?? []).map((alert) => {
                  const isDeleted = alert.title.toLowerCase().includes("deleted");
                  const isModified = alert.title.toLowerCase().includes("modified");
                  const severityColor =
                    alert.severity === "HIGH" || alert.severity === "CRITICAL"
                      ? "bg-destructive/10 text-destructive border border-destructive/20"
                      : alert.severity === "MEDIUM"
                        ? "bg-warning/15 text-warning-foreground border border-warning/30"
                        : "bg-secondary text-muted-foreground";
                  const rowBg = isDeleted
                    ? "bg-destructive/5 hover:bg-destructive/10"
                    : isModified
                      ? "bg-warning/5 hover:bg-warning/10"
                      : "hover:bg-muted/30";

                  return (
                    <tr key={alert.id} className={`transition-colors ${rowBg}`}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                        {formatWhen(alert.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {isDeleted ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive border border-destructive/20">
                              🗑️ Deleted
                            </span>
                          ) : isModified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground border border-warning/30">
                              ✏️ Modified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary border border-primary/20">
                              📋 Marked
                            </span>
                          )}
                          <span className="font-medium text-xs">{alert.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-sm">
                        <span className="line-clamp-2" title={alert.description}>
                          {alert.description}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${severityColor}`}>
                          {alert.severity}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-sm">
                    No attendance change alerts recorded yet. Alerts appear here when records are deleted or modified.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
