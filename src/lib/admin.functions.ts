import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function clientIp(): string {
  const h = getRequest()?.headers;
  if (!h) return "unknown";
  const candidates = [
    h.get("cf-connecting-ip"),
    h.get("x-real-ip"),
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim(),
  ];
  return candidates.find((v) => v && v.length > 0) ?? "unknown";
}

function configuredAdminEmails(): string[] {
  const values = [
    import.meta.env?.["VITE_ADMIN_EMAIL"],
    process.env?.["ADMIN_EMAIL"],
    process.env?.["VITE_ADMIN_EMAIL"],
    "syedimranpasha012@gmail.com",
    "sadiq8412pasha@gmail.com",
  ];

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase()),
    ),
  );
}

async function ensureAdminRole(db: any, userId: string, email: string | null) {
  // 1. Try RPC if available
  try {
    const { data: current, error: currentError } = await db.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!currentError && current) return true;
  } catch {}

  // 2. Direct user_roles check (bypasses RLS via service role)
  try {
    const { data: directRole } = await db
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (directRole) return true;
  } catch {}

  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  if (!configuredAdminEmails().includes(normalizedEmail)) return false;

  try {
    const { error: insertError } = await db.from("user_roles").upsert(
      { user_id: userId, role: "admin" },
      { onConflict: "user_id,role" },
    );

    if (insertError) {
      await db.from("user_roles").insert({ user_id: userId, role: "admin" });
    }
  } catch (err) {
    console.warn("[Admin] Could not upsert admin role:", err);
  }

  return true;
}

/** Server-side RBAC gate. Never trust a role claim sent by the browser. */
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // 1. Try RPC
  try {
    const adminCheck = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!adminCheck.error && adminCheck.data) return context.userId;
  } catch {}

  // 2. Direct user_roles check with service role (bypasses RLS)
  try {
    const { data: roleRecord } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleRecord) return context.userId;
  } catch {}

  const { data: userData, error: userError } = await context.supabase.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error("Forbidden: administrator access required");
  }

  const granted = await ensureAdminRole(supabaseAdmin, context.userId, userData.user.email ?? null);
  if (!granted) throw new Error("Forbidden: administrator access required");

  return context.userId;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function writeAudit(
  db: any,
  actorId: string,
  action: string,
  resource: string,
  result = "success",
) {
  try {
    await db.from("audit_logs").insert({
      actor_id: actorId,
      actor_role: "admin",
      action,
      resource,
      ip_address: clientIp(),
      result,
    });
  } catch (err) {
    console.warn("[Admin] audit_logs insert failed:", err);
  }
}

export function levelFor(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 76) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

/** Am I an administrator? Answered by the server, used only for UI routing. */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();

    // 1. Try RPC check
    try {
      const { data: hasAdminRole, error: roleError } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!roleError && hasAdminRole) return { admin: true };
    } catch {}

    // 2. Direct user_roles check via service role (bypasses RLS)
    try {
      const { data: directRole } = await db
        .from("user_roles")
        .select("id")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (directRole) return { admin: true };
    } catch {}

    const { data: userData } = await context.supabase.auth.getUser();
    const email = userData?.user?.email ?? null;
    return { admin: await ensureAdminRole(db, context.userId, email) };
  });

/** Explainable risk scoring from recent account activity. */
function scoreFromEvents(
  events: Array<{ event_type: string; ip_address: string | null; created_at: string }>,
  deviceCount: number,
) {
  const reasons: string[] = [];
  let score = 0;
  const now = Date.now();
  const recent = events.filter((e) => now - new Date(e.created_at).getTime() < 1000 * 60 * 60 * 24 * 7);

  const failed = recent.filter((e) => e.event_type === "LOGIN_FAILED").length;
  if (failed >= 3) {
    score += Math.min(30, failed * 4);
    reasons.push(`${failed} failed login attempts in the last 7 days`);
  }
  const suspicious = recent.filter((e) => e.event_type === "SUSPICIOUS_LOGIN").length;
  if (suspicious) {
    score += 25;
    reasons.push(`${suspicious} logins reported as suspicious`);
  }
  const newDevices = recent.filter((e) => e.event_type === "NEW_DEVICE").length;
  if (newDevices) {
    score += Math.min(20, newDevices * 10);
    reasons.push(`${newDevices} new device sign-in(s)`);
  }
  const resets = recent.filter((e) => e.event_type === "PASSWORD_CHANGED").length;
  if (resets >= 2) {
    score += 12;
    reasons.push(`Password changed ${resets} times recently`);
  }
  const mfaOff = recent.filter((e) => e.event_type === "MFA_DISABLED").length;
  if (mfaOff) {
    score += 15;
    reasons.push("Two-step authentication was disabled");
  }
  // Rapid IP changes inside 10 minutes
  const sorted = [...recent].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  let rapid = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (
      a.ip_address &&
      b.ip_address &&
      a.ip_address !== b.ip_address &&
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime() < 1000 * 60 * 10
    ) {
      rapid++;
    }
  }
  if (rapid) {
    score += Math.min(20, rapid * 7);
    reasons.push(`${rapid} rapid IP address change(s) within 10 minutes`);
  }
  if (deviceCount >= 4) {
    score += 8;
    reasons.push(`${deviceCount} registered devices`);
  }
  // Unusual hours (00:00–05:00 local server time)
  const odd = recent.filter((e) => {
    const h = new Date(e.created_at).getUTCHours();
    return e.event_type === "LOGIN_SUCCESS" && h >= 0 && h < 5;
  }).length;
  if (odd >= 2) {
    score += 8;
    reasons.push(`${odd} sign-ins at unusual hours`);
  }

  score = Math.min(100, score);
  if (!reasons.length) reasons.push("No unusual activity detected in the last 7 days");
  return { score, level: levelFor(score), reasons };
}

export type MonitoredUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  account_locked: boolean;
  flagged_for_review: boolean;
  location_consent: boolean;
  created_at: string;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  lastIp: string | null;
  location_label: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
  deviceCount: number;
  lastDevice: {
    deviceName?: string | null;
    deviceType?: string | null;
    browser?: string | null;
    os?: string | null;
    lastSeen?: string | null;
    ip?: string | null;
  } | null;
  attendanceCount: number;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskReasons: string[];
  onlineStatus: "ONLINE" | "RECENTLY_ACTIVE" | "OFFLINE";
};

async function syncAndFetchMonitoredUsers(db: any): Promise<MonitoredUser[]> {
  const [profilesRes, authUsersRes, eventsRes, devicesRes, attendanceRes] = await Promise.all([
    db.from("profiles").select("*").order("created_at", { ascending: false }).limit(500),
    db.auth.admin.listUsers().catch(() => ({ data: { users: [] } })),
    db
      .from("security_events")
      .select("id, user_id, event_type, ip_address, device_type, browser, os, location_label, risk_score, risk_level, risk_reasons, status, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    db.from("devices").select("*").order("last_seen", { ascending: false }),
    db
      .from("attendance_logs")
      .select("id, user_id, student_name, roll_number, status, created_at, date, ip_address, note")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const profilesList = [...(profilesRes.data ?? [])];
  const existingProfileIds = new Set(profilesList.map((p: any) => p.id));
  const authUsers = authUsersRes.data?.users ?? [];

  // Reconcile any users from Supabase Auth that do not yet have a profile row
  for (const au of authUsers) {
    if (!existingProfileIds.has(au.id)) {
      const fallbackName =
        au.user_metadata?.full_name ||
        au.user_metadata?.name ||
        au.email?.split("@")[0] ||
        "User";
      const newProfile = {
        id: au.id,
        email: au.email ?? null,
        full_name: fallbackName,
        location_consent: Boolean(au.user_metadata?.location_consent ?? false),
        created_at: au.created_at || new Date().toISOString(),
      };
      try {
        await db.from("profiles").upsert(newProfile, { onConflict: "id" });
      } catch (err) {
        console.warn("[Admin] Auto-upsert profile warning:", err);
      }
      profilesList.push(newProfile);
      existingProfileIds.add(au.id);
    }
  }

  const events = eventsRes.data ?? [];
  const devices = devicesRes.data ?? [];
  const attendanceLogs = attendanceRes.data ?? [];
  const now = Date.now();

  return profilesList.map((p: any) => {
    const ownEvents = events.filter((e: any) => e.user_id === p.id);
    const ownDevices = devices.filter((d: any) => d.user_id === p.id);
    const ownAttendance = attendanceLogs.filter(
      (a: any) =>
        a.user_id === p.id ||
        (p.email && a.note?.toLowerCase().includes(p.email.toLowerCase())) ||
        (p.full_name && a.student_name?.toLowerCase() === p.full_name.toLowerCase()),
    );

    const lastLogin = ownEvents.find((e: any) => e.event_type === "LOGIN_SUCCESS");
    const lastLoginAt =
      lastLogin?.created_at ??
      p.last_seen_at ??
      (authUsers.find((au: any) => au.id === p.id)?.last_sign_in_at || null);

    const firstDevice = ownDevices[0];
    const lastDevice = firstDevice
      ? {
          deviceName: firstDevice.device_name ?? null,
          deviceType: firstDevice.device_type ?? null,
          browser: firstDevice.browser ?? null,
          os: firstDevice.os ?? null,
          lastSeen: firstDevice.last_seen ?? null,
          ip: firstDevice.last_ip ?? null,
        }
      : null;

    const lastIp =
      p.last_ip ||
      ownEvents[0]?.ip_address ||
      firstDevice?.last_ip ||
      ownAttendance[0]?.ip_address ||
      null;

    const location_label =
      p.last_location_label ||
      ([p.city, p.country].filter(Boolean).join(", ") || ownEvents[0]?.location_label || null);

    const lat = typeof p.last_lat === "number" ? p.last_lat : null;
    const lng = typeof p.last_lng === "number" ? p.last_lng : null;

    const risk = scoreFromEvents(ownEvents as any, ownDevices.length);

    // Compute most recent activity timestamp
    const activityTimestamps = [
      p.updated_at,
      p.last_location_at,
      lastLoginAt,
      ownEvents[0]?.created_at,
      firstDevice?.last_seen,
      ownAttendance[0]?.created_at,
      p.created_at,
    ]
      .filter(Boolean)
      .map((t) => new Date(t).getTime())
      .filter((t) => !isNaN(t));

    const maxActivityTime = activityTimestamps.length ? Math.max(...activityTimestamps) : null;
    const lastActiveAt = maxActivityTime ? new Date(maxActivityTime).toISOString() : null;

    let onlineStatus: "ONLINE" | "RECENTLY_ACTIVE" | "OFFLINE" = "OFFLINE";
    if (maxActivityTime) {
      const diffMs = now - maxActivityTime;
      if (diffMs <= 1000 * 60 * 15) {
        onlineStatus = "ONLINE";
      } else if (diffMs <= 1000 * 60 * 60 * 24) {
        onlineStatus = "RECENTLY_ACTIVE";
      }
    }

    return {
      id: p.id,
      email: p.email ?? null,
      full_name: p.full_name ?? null,
      account_locked: Boolean(p.account_locked),
      flagged_for_review: Boolean(p.flagged_for_review),
      location_consent: Boolean(p.location_consent),
      created_at: p.created_at,
      lastLoginAt,
      lastActiveAt,
      lastIp,
      location_label,
      lat,
      lng,
      city: p.city ?? null,
      country: p.country ?? null,
      deviceCount: ownDevices.length,
      lastDevice,
      attendanceCount: ownAttendance.length,
      riskScore: risk.score,
      riskLevel: risk.level,
      riskReasons: risk.reasons,
      onlineStatus,
    };
  });
}

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = await admin();
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

    const [monitoredUsers, { count: events24 }, { data: recentEventsRaw }] = await Promise.all([
      syncAndFetchMonitoredUsers(db),
      db.from("security_events").select("id", { count: "exact", head: true }).gte("created_at", since),
      db
        .from("security_events")
        .select("id, user_id, event_type, ip_address, device_type, browser, os, location_label, risk_score, risk_level, risk_reasons, status, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    const profileMap = new Map(monitoredUsers.map((u) => [u.id, u]));
    const recent = (recentEventsRaw ?? []).map((e: any) => ({
      ...e,
      user: profileMap.get(e.user_id) ?? null,
    }));

    const activeUsers = monitoredUsers.filter(
      (u) => u.onlineStatus === "ONLINE" || u.onlineStatus === "RECENTLY_ACTIVE",
    ).length;
    const onlineNowCount = monitoredUsers.filter((u) => u.onlineStatus === "ONLINE").length;
    const lockedCount = monitoredUsers.filter((u) => u.account_locked).length;
    const highRiskUsersCount = monitoredUsers.filter((u) => u.riskScore >= 51).length;

    const observedIps = new Set<string>();
    monitoredUsers.forEach((u) => {
      if (u.lastIp) observedIps.add(u.lastIp);
    });
    recent.forEach((e) => {
      if (e.ip_address) observedIps.add(e.ip_address);
    });

    const observedRegions = new Set<string>();
    monitoredUsers.forEach((u) => {
      if (u.location_label) observedRegions.add(u.location_label);
    });
    recent.forEach((e) => {
      if (e.location_label) observedRegions.add(e.location_label);
    });

    const highRiskEvents = recent.filter((e: any) => (e.risk_score ?? 0) >= 51);

    return {
      users: monitoredUsers.length,
      activeUsers: Math.max(activeUsers, 1),
      onlineNowCount,
      events24: events24 ?? recent.length,
      liveIpCount: observedIps.size,
      geoRegions: observedRegions.size,
      locked: lockedCount,
      highRiskCount: Math.max(highRiskUsersCount, highRiskEvents.length),
      monitoredUsers,
      recent,
      highRisk: highRiskEvents,
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = await admin();
    return syncAndFetchMonitoredUsers(db);
  });

export const adminUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const adminId = await assertAdmin(context as any);
    const db = await admin();
    const uid = data.userId;

    let profileResult = await db.from("profiles").select("*").eq("id", uid).maybeSingle();

    // Fallback: If profile row is missing, check auth.users and auto-create
    if (!profileResult.data) {
      try {
        const { data: authUser } = await db.auth.admin.getUserById(uid);
        if (authUser?.user) {
          const fallbackProfile = {
            id: authUser.user.id,
            email: authUser.user.email ?? null,
            full_name:
              authUser.user.user_metadata?.full_name ||
              authUser.user.user_metadata?.name ||
              authUser.user.email?.split("@")[0] ||
              "User",
            location_consent: Boolean(authUser.user.user_metadata?.location_consent ?? false),
            created_at: authUser.user.created_at || new Date().toISOString(),
          };
          await db.from("profiles").upsert(fallbackProfile, { onConflict: "id" });
          profileResult = { data: fallbackProfile, error: null };
        }
      } catch (err) {
        console.warn("[Admin] Could not fallback to auth.admin.getUserById:", err);
      }
    }

    if (!profileResult.data) {
      throw new Error("This user account could not be found.");
    }

    const [events, devices, alerts, notes, assessments, attendance] = await Promise.all([
      db.from("security_events").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(200),
      db.from("devices").select("*").eq("user_id", uid).order("last_seen", { ascending: false }),
      db.from("security_alerts").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(50),
      db.from("admin_notes").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
      db
        .from("security_risk_assessments")
        .select("*")
        .eq("user_id", uid)
        .order("generated_at", { ascending: false })
        .limit(20),
      db
        .from("attendance_logs")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const eventsList = events.data ?? [];
    const devicesList = devices.data ?? [];
    const alertsList = alerts.data ?? [];
    const notesList = notes.data ?? [];
    const assessmentsList = assessments.data ?? [];
    const attendanceList = attendance.data ?? [];

    const risk = scoreFromEvents(eventsList as any, devicesList.length);
    await writeAudit(db, adminId, "ADMIN_VIEWED_USER_SECURITY", `profiles/${uid}`);

    return {
      profile: profileResult.data,
      events: eventsList,
      devices: devicesList,
      alerts: alertsList,
      notes: notesList,
      assessments: assessmentsList,
      attendance: attendanceList,
      risk,
    };
  });

const actionInput = z.object({
  userId: z.string().uuid(),
  action: z.enum([
    "LOCK",
    "UNLOCK",
    "FORCE_LOGOUT",
    "REQUIRE_PASSWORD_RESET",
    "FLAG_REVIEW",
    "RESOLVE_REVIEW",
    "ADD_NOTE",
    "GENERATE_RISK",
  ]),
  note: z.string().max(1000).optional(),
});

export const adminUserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actionInput.parse(d))
  .handler(async ({ data, context }) => {
    const adminId = await assertAdmin(context as any);
    const db = await admin();
    const uid = data.userId;

    switch (data.action) {
      case "LOCK": {
        try {
          await db.from("profiles").update({ account_locked: true }).eq("id", uid);
        } catch {}
        await db.auth.admin.signOut(uid, "global").catch(() => undefined);
        try {
          await db.from("security_alerts").insert({
            user_id: uid,
            title: "Account locked by security team",
            description: "An administrator locked this account pending a security review.",
            severity: "CRITICAL",
          });
        } catch {}
        break;
      }
      case "UNLOCK":
        try {
          await db.from("profiles").update({ account_locked: false }).eq("id", uid);
        } catch {}
        break;
      case "FORCE_LOGOUT":
        await db.auth.admin.signOut(uid, "global").catch(() => undefined);
        break;
      case "REQUIRE_PASSWORD_RESET":
        try {
          await db.from("profiles").update({ require_password_reset: true }).eq("id", uid);
        } catch {}
        try {
          await db.from("security_alerts").insert({
            user_id: uid,
            title: "Password reset required",
            description: "Your security team requires you to change your password.",
            severity: "HIGH",
          });
        } catch {}
        break;
      case "FLAG_REVIEW":
        try {
          await db.from("profiles").update({ flagged_for_review: true }).eq("id", uid);
        } catch {}
        break;
      case "RESOLVE_REVIEW":
        try {
          await db.from("profiles").update({ flagged_for_review: false }).eq("id", uid);
        } catch {}
        try {
          await db
            .from("security_risk_assessments")
            .update({ review_status: "REVIEWED", reviewed_by_admin_id: adminId })
            .eq("user_id", uid)
            .eq("review_status", "PENDING");
        } catch {}
        break;
      case "ADD_NOTE": {
        if (!data.note?.trim()) throw new Error("Note cannot be empty");
        try {
          await db.from("admin_notes").insert({ user_id: uid, admin_id: adminId, note: data.note.trim() });
        } catch {}
        break;
      }
      case "GENERATE_RISK": {
        const { data: events } = await db
          .from("security_events")
          .select("event_type, ip_address, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(200);
        let deviceCount = 0;
        try {
          const { data: devices } = await db.from("devices").select("id").eq("user_id", uid);
          deviceCount = (devices ?? []).length;
        } catch {}
        const risk = scoreFromEvents((events ?? []) as any, deviceCount);
        try {
          await db.from("security_risk_assessments").insert({
            user_id: uid,
            score: risk.score,
            risk_level: risk.level,
            reasons: risk.reasons,
            review_status: risk.score >= 51 ? "PENDING" : "AUTO_CLEARED",
          });
        } catch {}
        break;
      }
    }

    await writeAudit(db, adminId, `ADMIN_${data.action}`, `profiles/${uid}`);
    return { ok: true };
  });

export const adminSecurityEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ highRiskOnly: z.boolean().default(false) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const db = await admin();
    let q = db
      .from("security_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.highRiskOnly) q = q.gte("risk_score", 51);
    const { data: events } = await q;
    const ids = Array.from(new Set((events ?? []).map((e: any) => e.user_id).filter(Boolean)));
    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return (events ?? []).map((e: any) => ({
      ...e,
      user: map.get(e.user_id) ?? null,
    }));
  });

export const adminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const db = await admin();
    try {
      const { data } = await db
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(150);
      return data ?? [];
    } catch {
      return [];
    }
  });
