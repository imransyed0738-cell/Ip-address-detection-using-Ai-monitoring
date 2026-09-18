import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceInfo } from "@/lib/device";
import {
  recordSecurityEvent,
  sendWelcomeRegistrationEmail,
} from "@/lib/security.functions";
import {
  sendForgotPasswordOtp,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  resetPasswordWithOtp,
} from "@/lib/auth-otp.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Sign in or open a Sentinel account with verified email and two-step protection.",
      },
      { property: "og:title", content: "Sign in — Sentinel Secure Banking" },
      { property: "og:description", content: "Secure sign-in with two-step authentication." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Use at least 8 characters"),
  confirm: z.string(),
});

type PendingRegisterData = {
  full_name: string;
  email: string;
  password: string;
};

async function afterSignIn() {
  const device = getDeviceInfo();
  try {
    const result = await recordSecurityEvent({
      data: { eventType: "LOGIN_SUCCESS", device },
    });
    if (result.riskScore >= 30) {
      toast.warning(`Login flagged: ${result.riskLevel}`, {
        description: result.reasons.join(", "),
      });
    }
  } catch {
    // event logging must never block sign-in
  }
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"idle" | "mfa">("idle");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotInputEmail, setForgotInputEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [otpResendIn, setOtpResendIn] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isResetPasswordMode, setIsResetPasswordMode] = useState(false);

  // Registration OTP flow
  const [pendingRegisterData, setPendingRegisterData] = useState<PendingRegisterData | null>(null);
  const [registerOtpInput, setRegisterOtpInput] = useState("");
  const [registerOtpResendIn, setRegisterOtpResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (otpResendIn <= 0) return;
    const t = setTimeout(() => setOtpResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [otpResendIn]);

  useEffect(() => {
    if (registerOtpResendIn <= 0) return;
    const t = setTimeout(() => setRegisterOtpResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [registerOtpResendIn]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") ?? params.get("error");
    if (!oauthError) return;

    toast.error("Google sign-in failed", { description: oauthError.replace(/\+/g, " ") });
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("error");
    cleanUrl.searchParams.delete("error_code");
    cleanUrl.searchParams.delete("error_description");
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }, []);

  useEffect(() => {
    const hash = window.location.hash || "";
    const isRecovery =
      hash.includes("type=recovery") ||
      new URLSearchParams(window.location.search).get("type") === "recovery";

    if (isRecovery) {
      setIsResetPasswordMode(true);
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsResetPasswordMode(true);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session && !isRecovery) {
        void supabase.auth.signOut();
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  async function continueAfterPassword() {
    // Wait up to 2s for the session to be persisted (brokeredPreviewStorage is async).
    let sessionReady = false;
    for (let i = 0; i < 8; i++) {
      const { data: s } = await supabase.auth.getSession();
      if (s.session?.access_token) {
        sessionReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!sessionReady) {
      // Session not available — sign-in still may have worked, try navigating anyway
      await afterSignIn();
      navigate({ to: "/user/dashboard", replace: true });
      return;
    }

    // Check MFA requirement — wrapped in try/catch so a failure never blocks navigation
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verified = factors?.totp?.find((f) => f.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          setMode("mfa");
          return;
        }
      }
    } catch {
      // MFA check failure must never block navigation — proceed to dashboard
    }

    await afterSignIn();
    navigate({ to: "/user/dashboard", replace: true });
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setLoginError(null);
    if (!email || !password) {
      setLoginError("Email and password are required.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setBusy(false);
      setLoginError(error.message);
      toast.error("Sign-in failed", { description: error.message });
      return;
    }
    setLoginError(null);
    await continueAfterPassword();
    setBusy(false);
  }

  async function handleMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) {
      toast.error("Invalid code", { description: error.message });
      return;
    }
    await afterSignIn();
    navigate({ to: "/user/dashboard", replace: true });
  }

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const parsed = registerSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    if (parsed.data.password !== parsed.data.confirm) {
      toast.error("Passwords do not match");
      return;
    }

    const { full_name, email, password } = parsed.data;
    setBusy(true);

    try {
      // Step 1: Dispatch registration OTP via Gmail SMTP
      const otpRes = await sendRegistrationOtp({
        data: {
          email,
          fullName: full_name,
        },
      });

      setPendingRegisterData({ full_name, email, password });
      setRegisterOtpInput("");
      setRegisterOtpResendIn(60);

      if (otpRes?.delivered) {
        toast.success("Verification code sent!", {
          description: `We sent a 6-digit OTP to ${email}. Enter it below to activate your account.`,
        });
      } else {
        toast.info("Verification code dispatched", {
          description: `Sent to ${email}. Check your inbox and spam folder.`,
        });
      }
    } catch (err: any) {
      toast.error("Could not send verification code", {
        description: err?.message || "Please check your email address and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resendRegisterOtp() {
    if (!pendingRegisterData || registerOtpResendIn > 0) return;
    setBusy(true);
    setRegisterOtpResendIn(60);
    try {
      const res = await sendRegistrationOtp({
        data: {
          email: pendingRegisterData.email,
          fullName: pendingRegisterData.full_name,
        },
      });
      if (res?.delivered) {
        toast.success("New verification code sent!", {
          description: `A fresh 6-digit OTP was sent to ${pendingRegisterData.email}.`,
        });
      } else {
        toast.info("New code dispatched", {
          description: `Sent to ${pendingRegisterData.email}. Check inbox or spam.`,
        });
      }
    } catch (err: any) {
      toast.error("Could not resend code", { description: err?.message || "Error resending OTP" });
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyRegisterOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingRegisterData) return;
    const token = registerOtpInput.replace(/\D/g, "");
    if (token.length !== 6) {
      toast.error("Please enter the complete 6-digit OTP code.");
      return;
    }

    setBusy(true);
    try {
      // Step 2: Verify the 6-digit OTP
      await verifyRegistrationOtp({
        data: {
          email: pendingRegisterData.email,
          otp: token,
        },
      });

      // Step 3: Create the user account in Supabase
      const { full_name, email, password } = pendingRegisterData;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`,
          data: { full_name },
        },
      });

      if (error) {
        const weakPassword =
          error.code === "weak_password" || /weak password|known to be weak|pwned/i.test(error.message);
        if (weakPassword) {
          toast.error("Password too weak", {
            description: "Use 12+ characters with uppercase, lowercase, numbers, and special characters.",
          });
          return;
        }
        toast.error("Registration failed", { description: error.message });
        return;
      }

      // Step 4: Dispatch the official welcome email notification
      try {
        await sendWelcomeRegistrationEmail({ data: { email, fullName: full_name } });
      } catch {
        // non-blocking
      }

      let session = data.session;
      if (!session) {
        const signInRes = await supabase.auth.signInWithPassword({ email, password });
        if (signInRes.data?.session) {
          session = signInRes.data.session;
        }
      }

      toast.success("Account created successfully! 🎉", {
        description: `Welcome to Sentinel Security, ${full_name}!`,
      });

      setPendingRegisterData(null);

      if (session) {
        await continueAfterPassword();
        return;
      }

      setPendingEmail(email);
      setResendIn(60);
    } catch (err: any) {
      toast.error("Verification failed", {
        description: err?.message || "Invalid or expired verification code.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (!pendingEmail || resendIn > 0) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingEmail });
    setBusy(false);
    setResendIn(60);
    if (error) toast.error("Could not resend", { description: error.message });
    else toast.success("Confirmation email sent again");
  }

  async function handleForgot(e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    const email = forgotInputEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Please enter your registered email address.");
      return;
    }
    setBusy(true);
    setRecoveryEmail(email);
    setForgotMode(false);
    setOtpResendIn(60);

    try {
      // Dispatch OTP via server (Gmail SMTP)
      const res = await sendForgotPasswordOtp({ data: { email } });
      if (res?.delivered) {
        toast.success("Verification code sent!", {
          description: `Check your email inbox (${email}) for the 6-digit OTP notification.`,
        });
      } else {
        toast.info("Verification code dispatched", {
          description: `Sent to ${email}. Check your inbox and spam folder.`,
        });
      }

      // Also trigger Supabase native recovery in background
      try {
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
      } catch {
        // non-blocking
      }
    } catch (err: any) {
      toast.error("Could not send verification code", {
        description: err?.message || "Please check the email address and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resendForgotPasswordOtp() {
    if (!recoveryEmail || otpResendIn > 0) return;
    setBusy(true);
    setOtpResendIn(60);
    try {
      const res = await sendForgotPasswordOtp({ data: { email: recoveryEmail } });

      if (res?.delivered) {
        toast.success("New code sent!", {
          description: `Check your email for the new 6-digit OTP code.`,
        });
      } else {
        toast.info("New code dispatched", {
          description: `Sent to ${recoveryEmail}. Check your inbox and spam folder.`,
        });
      }
    } catch (err: any) {
      toast.error("Could not resend code", { description: err?.message || "Failed to resend" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRecovery(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!recoveryEmail) return;
    const form = new FormData(e.currentTarget);
    const token = String(form.get("token") ?? "").replace(/\D/g, "");
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const passwordCheck = registerSchema.shape.password.safeParse(password);

    if (token.length !== 6) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    if (!passwordCheck.success) {
      toast.error(passwordCheck.error.issues[0]?.message ?? "Choose a stronger password.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);

    // Try custom server OTP verification first
    try {
      const result = await resetPasswordWithOtp({
        data: {
          email: recoveryEmail,
          otp: token,
          password,
        },
      });

      if (result?.updatedByServer) {
        setRecoveryEmail(null);
        toast.success("Password reset successfully! 🎉", {
          description: "Signing you into your dashboard...",
        });

        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: recoveryEmail,
          password,
        });

        setBusy(false);

        if (!signInErr) {
          await afterSignIn();
          navigate({ to: "/user/dashboard", replace: true });
        } else {
          toast.info("Password updated!", { description: "Please sign in with your new password." });
        }
        return;
      }

      // If OTP verified but server didn't update (no service role), try client update paths.
      if (result?.verified) {
        // First try direct recovery verification which may create a session
        try {
          const { data: recData, error: recErr } = await supabase.auth.verifyOtp({
            email: recoveryEmail,
            token,
            type: "recovery",
          });
          if (!recErr && recData?.session) {
            const { error: updateErr } = await supabase.auth.updateUser({ password });
            if (!updateErr) {
              setBusy(false);
              setRecoveryEmail(null);
              toast.success("Password reset successfully! 🎉", {
                description: "You can now sign in with your new password.",
              });
              return;
            }
          }
        } catch {
          // ignore and continue to fallback
        }

        // Fallback: ask Supabase to send a one-time magic-link / token, then verify using 'email' type
        try {
          const { error: otpErr } = await supabase.auth.signInWithOtp({
            email: recoveryEmail,
            options: { shouldCreateUser: false },
          });

          if (!otpErr) {
            const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
              email: recoveryEmail,
              token,
              type: "email",
            });
            if (!verifyErr && verifyData?.session) {
              const { error: updateErr } = await supabase.auth.updateUser({ password });
              if (!updateErr) {
                setBusy(false);
                setRecoveryEmail(null);
                toast.success("Password reset successfully! 🎉", {
                  description: "You can now sign in with your new password.",
                });
                return;
              }
            }
          }
        } catch {
          // ignore fallback errors
        }

        // If we reach here the OTP was valid on the server but we couldn't create a client session.
        setBusy(false);
        toast.info("Code verified!", {
          description: "Please check your email for the direct reset link to complete updating your password.",
        });
        return;
      }
    } catch (customErr: any) {
      // OTP invalid or expired — show error
      setBusy(false);
      toast.error("Verification failed", {
        description: customErr?.message || "Invalid or expired verification code. Please request a new one.",
      });
      return;
    }
  }

  async function handleUpdatePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      toast.error("Could not update password", { description: error.message });
      return;
    }

    toast.success("Password updated successfully! 🎉", {
      description: "Welcome back! You are now signed in.",
    });
    setIsResetPasswordMode(false);
    window.location.hash = "";
    await afterSignIn();
    navigate({ to: "/user/dashboard", replace: true });
  }

  if (isResetPasswordMode) {
    return (
      <Screen>
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Set New Password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your new account password below.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Minimum 8 characters"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm Password</Label>
            <Input
              id="confirm-new-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter new password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Updating…" : "Update Password"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setIsResetPasswordMode(false);
              window.location.hash = "";
            }}
          >
            Back to sign in
          </Button>
        </form>
      </Screen>
    );
  }

  if (forgotMode) {
    return (
      <Screen>
        <form onSubmit={handleForgot} className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Forgot your password?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your registered email address to receive a 6-digit verification code.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Registered Email</Label>
            <Input
              id="forgot-email"
              type="email"
              placeholder="user@example.com"
              value={forgotInputEmail}
              onChange={(e) => setForgotInputEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || !forgotInputEmail.trim()}>
            {busy ? "Sending OTP…" : "Send verification code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setForgotMode(false);
              setForgotInputEmail("");
            }}
          >
            Back to sign in
          </Button>
        </form>
      </Screen>
    );
  }

  if (pendingRegisterData) {
    return (
      <Screen>
        <form onSubmit={handleVerifyRegisterOtp} className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Verify Your Email Address</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              We sent a 6-digit verification code to{" "}
              <span className="font-semibold text-foreground">{pendingRegisterData.email}</span>
            </p>
            <button
              type="button"
              onClick={() => setPendingRegisterData(null)}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Wrong email or details? Edit registration
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="register-otp">6-Digit Verification Code</Label>
              <button
                type="button"
                disabled={busy || registerOtpResendIn > 0}
                onClick={resendRegisterOtp}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {registerOtpResendIn > 0 ? `Resend in ${registerOtpResendIn}s` : "Resend code"}
              </button>
            </div>
            <Input
              id="register-otp"
              name="registerOtp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={registerOtpInput}
              onChange={(e) => setRegisterOtpInput(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="text-center font-mono text-xl tracking-[0.4em] font-semibold"
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy || registerOtpInput.length !== 6}>
            {busy ? "Verifying & Creating Account…" : "Verify & Create Account"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setPendingRegisterData(null)}
          >
            Back to registration
          </Button>
        </form>
      </Screen>
    );
  }

  if (recoveryEmail) {
    return (
      <Screen>
        <form onSubmit={handleRecovery} className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold">Enter Verification Code</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the 6-digit OTP sent to{" "}
              <span className="font-medium text-foreground">{recoveryEmail}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setRecoveryEmail(null);
                setForgotMode(true);
              }}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Wrong email? Change address
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="recovery-token">6-Digit OTP Code</Label>
              <button
                type="button"
                disabled={busy || otpResendIn > 0}
                onClick={resendForgotPasswordOtp}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {otpResendIn > 0 ? `Resend in ${otpResendIn}s` : "Resend code"}
              </button>
            </div>
            <Input
              id="recovery-token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="text-center font-mono text-xl tracking-[0.4em] font-semibold"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-password">New password</Label>
            <Input id="recovery-password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-confirm">Confirm new password</Label>
            <Input id="recovery-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Verify Code and Reset Password"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setRecoveryEmail(null);
              setForgotMode(false);
            }}
          >
            Back to sign in
          </Button>
        </form>
      </Screen>
    );
  }

  if (pendingEmail) {
    return (
      <Screen>
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">Account created — confirm your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{pendingEmail}</span>. Open it to activate
            the account. Sign-in stays blocked until the address is confirmed.
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing in your inbox? Check spam or promotions.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={resendConfirmation}
            disabled={busy || resendIn > 0}
          >
            {resendIn > 0 ? `Resend available in ${resendIn}s` : "Resend confirmation email"}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setPendingEmail(null)}>
            Back to sign in
          </Button>
        </div>
      </Screen>
    );
  }

  if (mode === "mfa") {
    return (
      <Screen>
        <form onSubmit={handleMfa} className="space-y-4">
          <h1 className="text-xl font-semibold">Two-step verification</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
          />
          <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <Tabs defaultValue="login">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Sign in securely"}
            </Button>
            {loginError && (
              <p role="alert" className="text-sm text-destructive">
                {loginError}
              </p>
            )}
          </form>
          <button
            type="button"
            onClick={() => setForgotMode(true)}
            className="mt-3 text-sm text-accent underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
        </TabsContent>

        <TabsContent value="register" className="mt-6">
          <form onSubmit={handleRegister} className="space-y-3">
            <Field label="Full name" name="full_name" required />
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Password" name="password" type="password" required />
              <Field label="Confirm password" name="confirm" type="password" required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <Link to="/admin/login" className="block">
          <Button variant="secondary" className="w-full">
            Admin sign in
          </Button>
        </Link>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-accent" />
          Sentinel Secure Banking
        </Link>
        <div className="panel p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  ...rest
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
    </div>
  );
}
