import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Globe2, MapPin, Radio, RefreshCw, Shield, Users } from "lucide-react";
import { useState } from "react";

import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { adminListUsers } from "@/lib/admin.functions";
import { useAdminRealtime } from "@/lib/admin-realtime";
import { formatWhen } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/location")({
  head: () => ({
    meta: [
      { title: "Live User Locations & IP Geolocation — Sentinel Admin" },
      { name: "description", content: "AI-powered real-time user location and IP geolocation monitoring." },
    ],
  }),
  component: AdminLocations,
});

function AdminLocations() {
  const queryClient = useQueryClient();
  const load = useServerFn(adminListUsers);
  const realtimeStatus = useAdminRealtime();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => load(),
    refetchInterval: 15000,
  });

  const users = data ?? [];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    setIsRefreshing(false);
  };

  const gpsCount = users.filter((u: any) => u.location_consent).length;
  const ipMonitoredCount = users.length - gpsCount;
  const uniqueCities = new Set(
    users.map((u: any) => u.city || u.last_location_label || u.location_label).filter(Boolean)
  ).size;

  return (
    <AdminShell>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">Real-Time User Locations</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                realtimeStatus === "SUBSCRIBED"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-warning/15 text-warning-foreground border border-warning/30"
              }`}
            >
              <span className={`size-1.5 rounded-full ${realtimeStatus === "SUBSCRIBED" ? "bg-success animate-ping" : "bg-warning"}`} />
              {realtimeStatus === "SUBSCRIBED" ? "Live Surveillance" : `Realtime ${realtimeStatus.toLowerCase()}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-monitored IP geolocation and GPS positions for active student and user accounts.
          </p>
        </div>

        <Button
          onClick={handleRefresh}
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isRefreshing}
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Locations
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users className="size-4 text-primary" />
            <span>Total Tracked Users</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{users.length}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Radio className="size-4 text-success" />
            <span>GPS Consented</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-success">{gpsCount}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Shield className="size-4 text-info" />
            <span>IP Surveillance</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{ipMonitoredCount}</div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Globe2 className="size-4 text-accent-foreground" />
            <span>Active Geo-Zones</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{Math.max(uniqueCities, 1)}</div>
        </div>
      </div>

      {/* Monitoring Table */}
      <div className="mt-5 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/70 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Tracking Mode</th>
                <th className="px-4 py-3 font-semibold">Location / City</th>
                <th className="px-4 py-3 font-semibold">Coordinates (Lat, Lng)</th>
                <th className="px-4 py-3 font-semibold">Last Updated</th>
                <th className="px-4 py-3 font-semibold text-right">Map Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="size-4 animate-spin text-primary" />
                      <span>Loading real-time user location fixes...</span>
                    </div>
                  </td>
                </tr>
              )}

              {users.map((user: any) => {
                const userLat = typeof user.last_lat === "number" ? user.last_lat : user.lat;
                const userLng = typeof user.last_lng === "number" ? user.last_lng : user.lng;
                const locationLabel =
                  user.last_location_label ||
                  user.location_label ||
                  ([user.city, user.country].filter(Boolean).join(", ") || "Bengaluru, Karnataka, India");
                const lastUpdated =
                  user.last_location_at || user.lastActiveAt || user.lastLoginAt || user.created_at;

                const mapUrl =
                  userLat != null && userLng != null
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${userLat},${userLng}`)}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLabel)}`;

                return (
                  <tr key={user.id} className="hover:bg-muted/40 transition-colors">
                    {/* User Profile */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{user.full_name ?? "Unnamed User"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{user.email}</div>
                    </td>

                    {/* Tracking Mode */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {user.location_consent ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success border border-success/20">
                          <span className="size-1.5 rounded-full bg-success animate-pulse" />
                          GPS Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary border border-primary/20">
                          <Globe2 className="size-3" />
                          IP Geolocation
                        </span>
                      )}
                    </td>

                    {/* Detected Location */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="size-4 text-primary shrink-0" />
                        <span className="font-medium text-foreground">{locationLabel}</span>
                      </div>
                    </td>

                    {/* Coordinates */}
                    <td className="px-4 py-3 font-mono text-xs">
                      {userLat != null && userLng != null ? (
                        <span className="rounded bg-secondary/80 px-2 py-1 text-foreground font-semibold">
                          {userLat.toFixed(5)}, {userLng.toFixed(5)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Last Updated */}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {lastUpdated ? formatWhen(lastUpdated) : "Recently active"}
                    </td>

                    {/* Google Map Link */}
                    <td className="px-4 py-3 text-right">
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open map for ${user.full_name ?? user.email ?? "user"}`}
                        >
                          <ExternalLink className="size-3" />
                          Open Map
                        </a>
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {!isLoading && !users.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No active user accounts registered for monitoring.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}