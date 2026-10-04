import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  Bell,
  ClipboardCheck,
  Crosshair,
  Globe2,
  Lock,
  MapPin,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import {
  getConnectionInfo,
  lookupIpAddress,
  lockAccount,
  recordSecurityEvent,
  terminateOtherSessions,
  getAttendanceLogs,
  saveAttendanceLog,
  submitLocation,
} from "@/lib/security.functions";
import {
  formatWhen,
  prettyEvent,
  useAlerts,
  useDevices,
  useProfile,
  useSecurityEvents,
  useSecurityRealtime,
} from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/dashboard")({
  head: () => ({
    meta: [
      { title: "Security Dashboard — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Your live account security posture: 2FA, sessions, devices, IP and alerts.",
      },
      { property: "og:title", content: "Security Dashboard" },
      { property: "og:description", content: "Live account security posture." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  useSecurityRealtime();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const events = useSecurityEvents(10);
  const alerts = useAlerts();
  const devices = useDevices();
  const [confirmLock, setConfirmLock] = useState(false);
  const [ipToTrack, setIpToTrack] = useState("");

  const connFn = useServerFn(getConnectionInfo);
  const conn = useQuery({
    queryKey: ["conn"],
    queryFn: () => connFn(),
    refetchInterval: 10000,
  });
  const lookupFn = useServerFn(lookupIpAddress);
  const ipLookup = useMutation({
    mutationFn: (ip: string) => lookupFn({ data: { ip } }),
    onError: (error: Error) => toast.error("IP lookup failed", { description: error.message }),
  });

  const mfa = useQuery({
    queryKey: ["mfa"],
    queryFn: async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      return (data?.totp ?? []).some((f) => f.status === "verified");
    },
  });

  const emailVerified = useQuery({
    queryKey: ["email-verified"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return Boolean(data.user?.email_confirmed_at ?? data.user?.confirmed_at);
    },
  });

  const lockFn = useServerFn(lockAccount);
  const terminateFn = useServerFn(terminateOtherSessions);
  const eventFn = useServerFn(recordSecurityEvent);
  const currentKey = typeof window === "undefined" ? "" : getDeviceInfo().deviceKey;

  const submitLocationFn = useServerFn(submitLocation);

  useEffect(() => {
    let active = true;
    async function ensureCurrentDevice() {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user || !active) return;
        const info = getDeviceInfo();

        await eventFn({
          data: {
            eventType: "LOGIN_SUCCESS",
            device: info,
            note: "Active dashboard session",
          },
        }).catch((err) => console.warn("[Security] Event record warning:", err));

        // Auto-sync browser GPS if available and consented
        if (typeof window !== "undefined" && navigator.geolocation && profile.data?.location_consent) {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              if (!active) return;
              try {
                await submitLocationFn({
                  data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
                });
                if (active) {
                  void queryClient.invalidateQueries({ queryKey: ["profile"] });
                }
              } catch {}
            },
            () => {},
            { enableHighAccuracy: false, maximumAge: 60_000, timeout: 5_000 }
          );
        }

        if (active) {
          await Promise.all([
            queryClient.refetchQueries({ queryKey: ["profile"] }),
            queryClient.refetchQueries({ queryKey: ["devices"] }),
            queryClient.refetchQueries({ queryKey: ["security_events"] }),
            queryClient.refetchQueries({ queryKey: ["security_alerts"] }),
            queryClient.refetchQueries({ queryKey: ["conn"] }),
          ]);
        }
      } catch (err) {
        console.warn("Device monitoring check:", err);
      }
    }
    void ensureCurrentDevice();
    return () => {
      active = false;
    };
  }, [eventFn, queryClient, profile.data?.location_consent, submitLocationFn]);

  const lockMutation = useMutation({
    mutationFn: () => lockFn(),
    onSuccess: async () => {
      toast.success("Account locked. You have been signed out everywhere.");
      await supabase.auth.signOut();
      window.location.href = "/auth";
    },
    onError: (e: Error) => toast.error("Could not lock account", { description: e.message }),
  });

  const terminateMutation = useMutation({
    mutationFn: () => terminateFn(),
    onSuccess: () => {
      toast.success("All other sessions were signed out.");
      void queryClient.invalidateQueries({ queryKey: ["security_events"] });
    },
    onError: (e: Error) => toast.error("Could not sign out sessions", { description: e.message }),
  });

  // User Dashboard Attendance
  const todayStr = new Date().toISOString().slice(0, 10);
  const [attDate, setAttDate] = useState(todayStr);
  const [attRoll, setAttRoll] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sentinel_user_roll") || "";
    }
    return "";
  });
  const [attName, setAttName] = useState("");
  const [attStatus, setAttStatus] = useState<"Present" | "Late" | "Absent" | "Leave">("Present");
  const [attNote, setAttNote] = useState("");

  const getAttendanceFn = useServerFn(getAttendanceLogs);
  const saveAttendanceFn = useServerFn(saveAttendanceLog);

  const userAttendance = useQuery({
    queryKey: ["attendance", "logs", "user"],
    queryFn: async () => {
      const res = await getAttendanceFn({ data: { limit: 10 } });
      return (res ?? []) as any[];
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (profile.data?.full_name && !attName) {
      setAttName(profile.data.full_name);
    }
  }, [profile.data?.full_name, attName]);

  const saveAttMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      rollNumber: string;
      date: string;
      status: "Present" | "Late" | "Absent" | "Leave";
      note?: string;
      ipAddress?: string;
    }) => saveAttendanceFn({ data: payload }),
    onSuccess: (res, vars) => {
      if (typeof window !== "undefined") {
        localStorage.setItem("sentinel_user_roll", vars.rollNumber);
      }
      toast.success(`Attendance marked as ${vars.status} for ${vars.date}`);
      setAttNote("");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "recentAttendance"] });
    },
    onError: (err: Error) => {
      toast.error("Failed to submit attendance", { description: err.message });
    },
  });

  const unread = (alerts.data ?? []).filter((a) => !a.read).length;
  const trustedDevices = (devices.data ?? []).filter((d) => d.trusted).length;
  const monitoringError = events.error ?? devices.error ?? alerts.error;
  const monitoringLoading = events.isLoading || devices.isLoading || alerts.isLoading;

  const score =
    (mfa.data ? 40 : 0) +
    (emailVerified.data ? 25 : 0) +
    (profile.data?.location_consent ? 10 : 0) +
    (trustedDevices > 0 ? 15 : 0) +
    (unread === 0 ? 10 : 0);

  const lat = (profile.data?.last_lat ?? (conn.data as any)?.lat) as number | null | undefined;
  const lng = (profile.data?.last_lng ?? (conn.data as any)?.lng) as number | null | undefined;
  const approximateLocation =
    profile.data?.last_location_label ||
    conn.data?.location ||
    ([profile.data?.city, profile.data?.country].filter(Boolean).join(", ") ||
    ([(conn.data as any)?.city, (conn.data as any)?.country].filter(Boolean).join(", ") ||
    "Detecting location…"));

  return (
    <AppShell unread={unread}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Account security</p>
          <h1 className="text-2xl font-semibold">
            Welcome, {profile.data?.full_name ?? "account holder"}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/user/security">
              <Settings className="mr-2 size-4" /> Settings
            </Link>
          </Button>
          <Button variant="outline" onClick={() => terminateMutation.mutate()} disabled={terminateMutation.isPending}>
            Sign out other sessions
          </Button>
          <Button variant="destructive" onClick={() => setConfirmLock(true)}>
            <Lock className="mr-2 size-4" /> Lock account
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        <QuickLink
          to="/user/security/location"
          icon={MapPin}
          label="Live geo tracking"
          value={profile.data?.location_consent ? "Enabled" : "Enable location"}
          detail={
            profile.data?.last_location_label ||
            conn.data?.location ||
            "Consent-based device location"
          }
          tone={profile.data?.location_consent ? "success" : "warning"}
        />
        <QuickLink
          to="/user/devices"
          icon={Smartphone}
          label="Device security"
          value={`${devices.data?.length ?? 0} registered`}
          detail={`${trustedDevices} trusted device${trustedDevices === 1 ? "" : "s"}`}
        />
        <QuickLink
          to="/user/security/activity"
          icon={Activity}
          label="Security activity"
          value={events.data?.[0] ? prettyEvent(events.data[0].event_type) : "No events yet"}
          detail={events.data?.[0] ? formatWhen(events.data[0].created_at) : "View login and location events"}
        />
        <QuickLink
          to="/user/attendance"
          icon={ClipboardCheck}
          label="Attendance dashboard"
          value="Manual check-in"
          detail="Record your attendance for any date"
        />
      </div>

      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MapPin className="size-5 text-accent" />
              <p className="label-caps">Geo Location & Network</p>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Live device location & public IP</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Real-time geographic location and connection security for your active session and account protection.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/user/security/location">
                <MapPin className="mr-2 size-4" />
                Location settings
              </Link>
            </Button>
            {lat != null && lng != null && (
              <Button asChild size="sm">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Globe2 className="mr-2 size-4" />
                  Open in Google Maps
                </a>
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <LookupDetail
            label="Location status"
            value={profile.data?.location_consent ? "Live monitoring enabled" : "Network IP location"}
          />
          <LookupDetail
            label="Current public IP"
            value={conn.data?.ip ?? "Detecting public IP…"}
            mono
          />
          <LookupDetail
            label="Approximate location"
            value={approximateLocation}
          />
          <LookupDetail
            label="Coordinates"
            value={
              lat != null && lng != null
                ? `${Number(lat).toFixed(4)}° ${Number(lat) >= 0 ? "N" : "S"}, ${Number(lng).toFixed(4)}° ${Number(lng) >= 0 ? "E" : "W"}`
                : "Active via IP"
            }
            mono
          />
        </div>
      </section>

      {/* Daily Attendance Check-In Section */}
      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-5 text-accent" />
              <p className="label-caps">Attendance System</p>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Mark your daily attendance</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Submit your attendance for today. Your record is securely saved and automatically monitored by administrators in real time.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/user/attendance">
              Full attendance history →
            </Link>
          </Button>
        </div>

        <form
          className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!attName.trim() || !attRoll.trim() || !attDate) return;
            saveAttMutation.mutate({
              name: attName.trim(),
              rollNumber: attRoll.trim(),
              date: attDate,
              status: attStatus,
              note: attNote.trim(),
              ipAddress: conn.data?.ip ?? "Unavailable",
            });
          }}
        >
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="dash-att-name">
              Full name
            </label>
            <Input
              id="dash-att-name"
              placeholder="Your name"
              value={attName}
              onChange={(e) => setAttName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="dash-att-roll">
              Roll / Employee ID
            </label>
            <Input
              id="dash-att-roll"
              placeholder="e.g. CS-024 / EMP-101"
              value={attRoll}
              onChange={(e) => setAttRoll(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="dash-att-date">
              Date
            </label>
            <Input
              id="dash-att-date"
              type="date"
              value={attDate}
              onChange={(e) => setAttDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="dash-att-status">
              Status
            </label>
            <select
              id="dash-att-status"
              value={attStatus}
              onChange={(e) => setAttStatus(e.target.value as any)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Absent">Absent</option>
              <option value="Leave">Leave</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="dash-att-note">
              Note (optional)
            </label>
            <Input
              id="dash-att-note"
              placeholder="Add short note…"
              value={attNote}
              onChange={(e) => setAttNote(e.target.value)}
            />
          </div>

          <div>
            <Button
              type="submit"
              className="w-full"
              disabled={saveAttMutation.isPending}
            >
              {saveAttMutation.isPending ? "Submitting…" : "Mark attendance"}
            </Button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-full bg-success"></span>
            <span>Observed public IP: <strong className="font-mono text-foreground">{conn.data?.ip ?? "Detecting…"}</strong></span>
          </div>
          <span>Stored centrally &bull; Live sync with Admin Dashboard</span>
        </div>

        {/* Recent Attendance Mini Table */}
        {(userAttendance.data ?? []).length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Your Recent Check-Ins</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1.5">Date</th>
                    <th className="py-1.5">Roll / ID</th>
                    <th className="py-1.5">Status</th>
                    <th className="py-1.5">Note</th>
                    <th className="py-1.5">Observed IP</th>
                  </tr>
                </thead>
                <tbody>
                  {(userAttendance.data ?? []).slice(0, 3).map((r: any) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-2 font-medium">{r.date}</td>
                      <td className="py-2 font-mono text-xs">{r.rollNumber}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            r.status === "Present"
                              ? "bg-success/10 text-success"
                              : r.status === "Late"
                                ? "bg-warning/20 text-warning-foreground"
                                : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{r.note || "—"}</td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">{r.ipAddress || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair className="size-5 text-accent" />
              <p className="label-caps">IP tracker</p>
            </div>
            <h2 className="mt-2 text-lg font-semibold">Check a public IP address</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Get the approximate public location and network details for an IPv4 or IPv6 address.
              A device name is shown only when it matches one of your registered devices.
            </p>
          </div>
        </div>

        <form
          className="mt-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const ip = ipToTrack.trim();
            if (ip) ipLookup.mutate(ip);
          }}
        >
          <Input
            className="font-mono sm:max-w-md"
            placeholder="e.g. 8.8.8.8"
            aria-label="Public IP address"
            value={ipToTrack}
            onChange={(event) => setIpToTrack(event.target.value)}
          />
          <Button type="submit" disabled={!ipToTrack.trim() || ipLookup.isPending}>
            <Crosshair className="mr-2 size-4" />
            {ipLookup.isPending ? "Checking…" : "Track IP"}
          </Button>
        </form>

        {ipLookup.data && (
          <div className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <LookupDetail
              label="Device name"
              value={ipLookup.data.deviceName ?? "Unknown from public IP"}
            />
            <LookupDetail label="IP address" value={ipLookup.data.ip} mono />
            <LookupDetail label="Public address (approx.)" value={ipLookup.data.publicAddress} />
            <LookupDetail
              label="Network"
              value={ipLookup.data.organization ?? "Organization unavailable"}
            />
          </div>
        )}
        {ipLookup.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {ipLookup.error.message}
          </p>
        )}
      </section>

      <section className="panel mt-6 border-l-4 border-accent px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-caps">Monitoring status</p>
            <p className="text-sm font-medium">
              {monitoringLoading
                ? "Loading security activity and devices…"
                : monitoringError
                  ? "Monitoring needs attention"
                  : "Security activity and devices are being monitored"}
            </p>
            {monitoringError && (
              <p className="mt-1 text-xs text-destructive">{monitoringError.message}</p>
            )}
          </div>
          {monitoringError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["security_events"] });
                void queryClient.invalidateQueries({ queryKey: ["devices"] });
                void queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
              }}
            >
              Retry monitoring
            </Button>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={ShieldCheck}
          label="Security score"
          value={`${score}/100`}
          hint={score >= 80 ? "Strong" : score >= 50 ? "Improve 2FA & devices" : "At risk"}
          tone={score >= 80 ? "success" : score >= 50 ? "warning" : "danger"}
        />
        <Stat
          icon={UserCheck}
          label="Two-step auth"
          value={mfa.data ? "Enabled" : "Disabled"}
          hint={mfa.data ? "Authenticator app" : "Turn it on in Security"}
          tone={mfa.data ? "success" : "danger"}
        />
        <Stat
          icon={Bell}
          label="Email verification"
          value={emailVerified.data ? "Verified" : "Pending"}
          tone={emailVerified.data ? "success" : "warning"}
        />
        <Stat
          icon={MapPin}
          label="Location monitoring"
          value={profile.data?.location_consent ? "Enabled" : "Off"}
          hint={profile.data?.last_location_label || conn.data?.location || "No consented location"}
          tone={profile.data?.location_consent ? "success" : "muted"}
        />
        <Stat icon={Smartphone} label="Registered devices" value={String(devices.data?.length ?? 0)} hint={`${trustedDevices} trusted`} />
        <Link to="/user/notifications" className="block transition-transform hover:scale-[1.02]">
          <Stat icon={Bell} label="Unread alerts" value={String(unread)} hint="View notification history →" tone={unread ? "warning" : "success"} />
        </Link>
        <Stat
          icon={Globe2}
          label="Current IP"
          value={conn.data?.ip ?? "…"}
          hint={conn.data?.location || profile.data?.last_location_label || "Region unavailable"}
        />
        <Stat
          icon={Activity}
          label="Last event"
          value={events.data?.[0] ? prettyEvent(events.data[0].event_type) : "None"}
          hint={events.data?.[0] ? formatWhen(events.data[0].created_at) : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Registered devices</h2>
            <Link to="/user/devices" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {devices.isLoading && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                Loading devices…
              </li>
            )}
            {devices.isError && (
              <li className="px-5 py-8 text-center text-sm text-destructive">
                Could not load devices.
              </li>
            )}
            {!devices.isLoading &&
              !devices.isError &&
              (devices.data ?? []).slice(0, 6).map((d) => {
                const isCurrent = d.device_key === currentKey;
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="font-medium">{d.device_name || "Device"}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.device_type ?? "Unknown"} · {d.browser ?? "—"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {d.last_ip ?? "—"}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {d.last_seen ? formatWhen(d.last_seen as string) : "—"}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        THIS DEVICE
                      </span>
                    )}
                    {d.trusted && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        TRUSTED
                      </span>
                    )}
                  </li>
                );
              })}
            {!devices.isLoading && !devices.isError && devices.data?.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No devices registered yet.
              </li>
            )}
          </ul>
        </section>

        <section className="panel">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Live security activity</h2>
            <Link to="/user/security/activity" className="text-xs text-accent hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {events.isLoading && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                Loading activity…
              </li>
            )}
            {events.isError && (
              <li className="px-5 py-8 text-center text-sm text-destructive">
                Could not load security activity.
              </li>
            )}
            {!events.isLoading &&
              !events.isError &&
              (events.data ?? []).slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
                >
                  <span className="font-medium">{prettyEvent(e.event_type)}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.ip_address ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.device_type ?? "Unknown"} · {e.browser ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.location_label ?? "Unknown"}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatWhen(e.created_at)}
                  </span>
                  <RiskPill level={e.risk_level} />
                </li>
              ))}
            {!events.isLoading && !events.isError && events.data?.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No security events recorded yet.
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* Notification & Alert History Panel */}
      <section className="panel mt-6">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">Notification & Alert History</h2>
            {unread > 0 ? (
              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
                {unread} unread
              </span>
            ) : (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {(alerts.data ?? []).length} total
              </span>
            )}
          </div>
          <Link to="/user/notifications" className="flex items-center gap-1 text-xs text-accent hover:underline">
            <span>View all in alerts dashboard</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>

        <ul className="divide-y divide-border">
          {alerts.isLoading && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              Loading notification history…
            </li>
          )}
          {alerts.isError && (
            <li className="px-5 py-8 text-center text-sm text-destructive">
              Could not load notification history.
            </li>
          )}
          {!alerts.isLoading &&
            !alerts.isError &&
            (alerts.data ?? []).slice(0, 5).map((a) => {
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
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-secondary/20 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {isAttendance ? (
                      <ClipboardCheck className="size-4 shrink-0 text-success" />
                    ) : a.severity === "CRITICAL" || a.severity === "HIGH" ? (
                      <ShieldAlert className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <Bell className="size-4 shrink-0 text-accent" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{a.title}</span>
                        {!a.read && (
                          <span className="size-1.5 rounded-full bg-accent inline-block" title="Unread notification" />
                        )}
                      </div>
                      {a.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>
                      )}
                    </div>
                  </div>

                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                      isDeleted || a.severity === "CRITICAL" || a.severity === "HIGH"
                        ? "bg-destructive/10 text-destructive"
                        : isModified || a.severity === "MEDIUM"
                          ? "bg-warning/15 text-warning-foreground"
                          : "bg-success/10 text-success"
                    }`}
                  >
                    {isDeleted ? "DELETED" : isModified ? "MODIFIED" : isAttendance ? "ATTENDANCE" : a.severity}
                  </span>

                  <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                    {formatWhen(a.created_at)}
                  </span>
                </li>
              );
            })}
          {!alerts.isLoading && !alerts.isError && (alerts.data ?? []).length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              No notifications recorded yet.
            </li>
          )}
        </ul>

        {(alerts.data ?? []).length > 5 && (
          <div className="border-t border-border px-5 py-2.5 bg-secondary/10 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Showing 5 of {(alerts.data ?? []).length} notifications
            </span>
            <Link to="/user/notifications" className="text-accent hover:underline font-medium">
              View all notifications history →
            </Link>
          </div>
        )}
      </section>

      <AlertDialog open={confirmLock} onOpenChange={setConfirmLock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock this account?</AlertDialogTitle>
            <AlertDialogDescription>
              All sessions are terminated immediately and sign-in stays blocked until support
              restores access. Use this if you suspect unauthorised activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => lockMutation.mutate()}>Lock account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function LookupDetail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="label-caps">{label}</p>
      <p className={`mt-1 break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  value,
  detail,
  tone = "muted",
}: {
  to: "/user/security/location" | "/user/devices" | "/user/security/activity" | "/user/attendance";
  icon: typeof MapPin;
  label: string;
  value: string;
  detail: string;
  tone?: "success" | "warning" | "muted";
}) {
  const color = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-accent";
  return (
    <Link to={to} className="panel block p-5 transition-colors hover:border-accent/60 hover:bg-secondary/40">
      <div className="flex items-center gap-2">
        <Icon className={`size-5 ${color}`} />
        <span className="label-caps">{label}</span>
      </div>
      <p className="mt-4 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <span className="mt-4 inline-block text-xs font-medium text-accent">Open security view →</span>
    </Link>
  );
}

export function RiskPill({ level }: { level: string }) {
  const tone =
    level === "CRITICAL" || level === "HIGH"
      ? "bg-destructive/10 text-destructive"
      : level === "MEDIUM"
        ? "bg-warning/15 text-warning-foreground"
        : "bg-success/10 text-success";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${tone}`}>
      {level}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "muted",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${color}`} />
        <span className="label-caps">{label}</span>
      </div>
      <p className="mt-2 truncate text-lg font-semibold">{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
