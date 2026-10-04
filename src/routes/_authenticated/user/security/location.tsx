import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Navigation, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDeviceInfo } from "@/lib/device";
import { getConnectionInfo, recordSecurityEvent, setLocationConsent, submitLocation } from "@/lib/security.functions";
import { formatWhen, useAlerts, useProfile, useSecurityRealtime } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/user/security/location")({
  head: () => ({
    meta: [
      { title: "Location Security — Sentinel Secure Banking" },
      {
        name: "description",
        content:
          "Consent-based location monitoring. Enable, review your last approximate location, or revoke access at any time.",
      },
      { property: "og:title", content: "Location Security" },
      { property: "og:description", content: "Consent-based location monitoring." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LocationPage,
});

function LocationPage() {
  useSecurityRealtime();
  const profile = useProfile();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const consentFn = useServerFn(setLocationConsent);
  const submitFn = useServerFn(submitLocation);
  const eventFn = useServerFn(recordSecurityEvent);
  const connFn = useServerFn(getConnectionInfo);

  const conn = useQuery({
    queryKey: ["conn"],
    queryFn: () => connFn(),
    refetchInterval: 10_000,
  });

  const watchRef = useRef<number | null>(null);
  const consent = Boolean(profile.data?.location_consent);
  const unread = (alerts.data ?? []).filter((a) => !a.read).length;

  // Only watch position while consent is on. Revoking stops updates immediately.
  useEffect(() => {
    if (!consent || typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        void submitFn({
          data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ["profile"] }))
          .catch((error: Error) => {
            toast.error("Location update failed", { description: error.message });
          });
      },
      (err) => {
        toast.error("Live location stopped", {
          description:
            err.code === GeolocationPositionError.PERMISSION_DENIED
              ? "Location permission was denied. Allow it in your browser settings."
              : err.message || "The device could not provide a location fix.",
        });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
    );
    watchRef.current = id;
    return () => {
      navigator.geolocation.clearWatch(id);
      watchRef.current = null;
    };
  }, [consent, submitFn, queryClient]);

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      let position: GeolocationPosition | null = null;
      if (enabled && typeof window !== "undefined" && navigator.geolocation) {
        try {
          position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              maximumAge: 60_000,
              timeout: 6_000,
            });
          });
        } catch (err) {
          console.warn("[Location] GPS unavailable, using network IP location:", err);
        }
      }

      await consentFn({ data: { enabled } });

      if (position) {
        await submitFn({
          data: { latitude: position.coords.latitude, longitude: position.coords.longitude },
        }).catch(() => undefined);
      }

      await eventFn({
        data: { eventType: "LOCATION_PERMISSION_CHANGED", device: getDeviceInfo() },
      }).catch(() => undefined);
    },
    onSuccess: (_, enabled) => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["conn"] });
      void queryClient.invalidateQueries({ queryKey: ["security_events"] });
      toast.success(
        enabled
          ? "Location monitoring enabled"
          : "Location monitoring disabled and coordinates removed",
      );
    },
    onError: (e: Error) => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.error("Location not updated", { description: e.message });
    },
  });

  const refreshGps = useMutation({
    mutationFn: async () => {
      if (typeof window === "undefined" || !navigator.geolocation) {
        throw new Error("Browser geolocation is not supported on this device.");
      }
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 10_000,
        });
      });
      await submitFn({
        data: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["conn"] });
      toast.success("Live GPS coordinates updated successfully!");
    },
    onError: (err: any) => {
      toast.error("Could not retrieve GPS", { description: err?.message || "Location access was denied." });
    },
  });

  const lat = (profile.data?.last_lat ?? (conn.data as any)?.lat) as number | null | undefined;
  const lng = (profile.data?.last_lng ?? (conn.data as any)?.lng) as number | null | undefined;
  const locationLabel =
    (profile.data?.last_location_label as string) ||
    conn.data?.location ||
    ([profile.data?.city, profile.data?.country].filter(Boolean).join(", ") ||
    ([(conn.data as any)?.city, (conn.data as any)?.country].filter(Boolean).join(", ") ||
    (consent ? "Resolving location…" : "Active via IP Network")));

  return (
    <AppShell unread={unread}>
      <p className="label-caps">Privacy & security</p>
      <h1 className="text-2xl font-semibold">Live security location</h1>

      {profile.isError && (
        <div className="panel mt-6 p-5">
          <p className="text-sm text-destructive">Could not load location settings.</p>
          <p className="mt-1 text-xs text-muted-foreground">{profile.error.message}</p>
          <Button className="mt-4" variant="outline" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!profile.isError && (
        <div className="panel mt-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Security location monitoring</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                When enabled, your device shares live coordinates to verify logins and track account security in real time.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshGps.mutate()}
                disabled={refreshGps.isPending}
              >
                <RefreshCw className={`mr-2 size-4 ${refreshGps.isPending ? "animate-spin" : ""}`} />
                Detect GPS Location
              </Button>
              <Switch
                checked={consent}
                disabled={toggle.isPending}
                onCheckedChange={(v) => toggle.mutate(v)}
                aria-label="Toggle location monitoring"
              />
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <Item
              label="Status"
              value={
                consent
                  ? "Live GPS tracking enabled"
                  : lat != null && lng != null
                    ? "Active via Network IP location"
                    : "Disabled"
              }
            />
            <Item
              label="Consent recorded"
              value={
                profile.data?.location_consent_at
                  ? formatWhen(profile.data.location_consent_at as string)
                  : consent
                    ? "Active"
                    : "—"
              }
            />
            <Item
              label="Latitude"
              value={
                lat != null
                  ? `${Number(lat).toFixed(4)}° ${Number(lat) >= 0 ? "N" : "S"}`
                  : consent
                    ? "Resolving…"
                    : "—"
              }
            />
            <Item
              label="Longitude"
              value={
                lng != null
                  ? `${Number(lng).toFixed(4)}° ${Number(lng) >= 0 ? "E" : "W"}`
                  : consent
                    ? "Resolving…"
                    : "—"
              }
            />
            <Item label="Approximate location" value={locationLabel} />
            <Item
              label="Last updated"
              value={
                profile.data?.last_location_at
                  ? formatWhen(profile.data.last_location_at as string)
                  : "Just now"
              }
            />
          </dl>

          {lat != null && lng != null && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="mr-2 size-4" />
                  Open in Google Maps
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a
                  href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation className="mr-2 size-4" />
                  Open in OpenStreetMap
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
