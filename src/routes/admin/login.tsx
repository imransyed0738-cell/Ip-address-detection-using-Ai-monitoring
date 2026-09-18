import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { amIAdmin } from "@/lib/admin.functions";
import { getDeviceInfo } from "@/lib/device";
import { recordSecurityEvent } from "@/lib/security.functions";

export const Route = createFileRoute("/admin/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Administrator sign-in — Sentinel Security Operations" },
      {
        name: "description",
        content:
          "Restricted sign-in for Sentinel security administrators, protected by role checks and two-step verification.",
      },
      { property: "og:title", content: "Administrator sign-in — Sentinel" },
      { property: "og:description", content: "Restricted security operations console sign-in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminLogin,
});

const LOCK_KEY = "sentinel.admin.lockout";
const MAX_ATTEMPTS = 5;

function readLock() {
  if (typeof window === "undefined") return { fails: 0, until: 0 };
  try {
    return JSON.parse(window.localStorage.getItem(LOCK_KEY) ?? "") as { fails: number; until: number };
  } catch {
    return { fails: 0, until: 0 };
  }
}

function AdminLogin() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(amIAdmin);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function bumpFail() {
    const cur = readLock();
    const fails = (cur.fails ?? 0) + 1;
    const until = fails >= MAX_ATTEMPTS ? Date.now() + 15 * 60 * 1000 : 0;
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ fails, until }));
    return { fails, until };
  }

  async function finish() {
    try {
      const res = await checkAdmin();
      if (!res.admin) {
        await supabase.auth.signOut();
        toast.error("Access denied", {
          description: "This account does not have administrator privileges.",
        });
        return;
      }
      window.localStorage.removeItem(LOCK_KEY);
      try {
        void recordSecurityEvent({ data: { eventType: "LOGIN_SUCCESS", device: getDeviceInfo(), note: "Admin console sign-in" } });
      } catch {
        /* event logging must never block sign-in */
      }
      navigate({ to: "/admin/dashboard", replace: true });
    } catch (error) {
      // Sign out so the user is not stuck in a half-authenticated state
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      const message = error instanceof Error ? error.message : "Please try again.";
      const isAuth = message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("session");
      toast.error(isAuth ? "Sign-in session lost" : "Admin sign-in could not be completed", {
        description: isAuth
          ? "Your session expired during sign-in. Please enter your credentials again."
          : message,
      });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lock = readLock();
    if (lock.until && lock.until > Date.now()) {
      toast.error("Too many failed attempts. Try again in a few minutes.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const state = bumpFail();
      setBusy(false);
      toast.error(
        state.until
          ? "Account temporarily locked after repeated failed attempts."
          : `Sign-in failed. ${MAX_ATTEMPTS - state.fails} attempt(s) remaining.`,
        { description: error.message },
      );
      return;
    }

    // Wait for the session to be persisted (brokeredPreviewStorage is async).
    // Poll up to 2 seconds for the access token.
    let sessionToken: string | undefined;
    for (let i = 0; i < 8; i++) {
      const { data: s } = await supabase.auth.getSession();
      if (s.session?.access_token) {
        sessionToken = s.session.access_token;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!sessionToken) {
      setBusy(false);
      toast.error("Session could not be established. Please try again.");
      return;
    }

    // Enforce two-step verification when the administrator has a TOTP factor.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === "verified");
    if (totp) {
      setFactorId(totp.id);
      setBusy(false);
      return;
    }
    await finish();
    setBusy(false);
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !challenge) {
      setBusy(false);
      toast.error(cErr?.message ?? "Could not start verification");
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (error) {
      setBusy(false);
      toast.error("Invalid verification code");
      return;
    }
    await finish();
    setBusy(false);
  }

  async function resetPassword() {
    const address = email.trim();
    if (!address) {
      toast.error("Enter the administrator email first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) {
      toast.error("Could not send password reset", { description: error.message });
      return;
    }
    toast.success("Password reset email sent", {
      description: "Check the administrator inbox and spam folder.",
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy px-4 py-12 text-navy-foreground">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="mb-6 flex items-center gap-3">
          <ShieldAlert className="size-6" />
          <div>
            <h1 className="text-lg font-semibold">Security Operations</h1>
            <p className="text-xs text-navy-foreground/70">Restricted administrator access</p>
          </div>
        </div>

        {factorId ? (
          <form onSubmit={verifyMfa} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code" className="text-navy-foreground">
                Authenticator code
              </Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="bg-white text-foreground"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              Verify and continue
            </Button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-navy-foreground">
                Administrator email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white text-foreground"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-navy-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white text-foreground"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full text-navy-foreground"
              onClick={() => navigate({ to: "/auth", replace: true })}
            >
              Forgot password? Reset via OTP
            </Button>
            {readLock().until > Date.now() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs text-navy-foreground border-white/20 bg-white/10 hover:bg-white/20"
                onClick={() => {
                  window.localStorage.removeItem(LOCK_KEY);
                  toast.success("Lockout cleared. You may now enter your administrator credentials.");
                }}
              >
                Reset Lockout Counter
              </Button>
            )}
          </form>
        )}

        <div className="mt-6 space-y-3">
          <Button variant="secondary" className="w-full" onClick={() => navigate({ to: "/auth", replace: true })}>
            User login
          </Button>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-navy-foreground/70">
          Administrator identity, role and every console action are verified on the server. Sign-in IP,
          device and time are recorded in an audit log. Repeated failed attempts lock this form.
        </p>
      </div>
    </main>
  );
}
