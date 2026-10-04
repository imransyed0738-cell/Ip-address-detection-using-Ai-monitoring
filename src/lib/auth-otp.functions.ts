import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Schemas
export const forgotPasswordOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export const resetPasswordWithOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  otp: z.string().trim().length(6, "Enter the 6-digit code."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const registrationOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  fullName: z.string().optional(),
});

export const verifyRegistrationOtpInput = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  otp: z.string().trim().length(6, "Enter the 6-digit verification code."),
});

export const registerVerifiedUserInput = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  otp: z.string().trim().length(6, "Enter the 6-digit verification code."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().trim().min(2, "Enter your full name."),
});

// Resilient OTP store backed by globalThis + local disk persistence
interface StoredOtpRecord {
  tokenHash: string;
  expiresAt: number;
  attempts: number;
}

declare global {
  var __sentinel_otp_store_v2: Map<string, StoredOtpRecord> | undefined;
}

const memoryOtpStore: Map<string, StoredOtpRecord> =
  globalThis.__sentinel_otp_store_v2 ??
  (globalThis.__sentinel_otp_store_v2 = new Map<string, StoredOtpRecord>());

async function hashOtp(token: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function saveOtp(key: string, record: StoredOtpRecord): Promise<void> {
  memoryOtpStore.set(key, record);
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    let stored: Record<string, StoredOtpRecord> = {};
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      stored = JSON.parse(raw);
    } catch {}
    stored[key] = record;
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");
  } catch (err) {
    console.warn("[OTP Store] Error writing to disk:", err);
  }
}

async function loadOtp(key: string): Promise<StoredOtpRecord | undefined> {
  const inMem = memoryOtpStore.get(key);
  if (inMem) return inMem;
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const stored = JSON.parse(raw) as Record<string, StoredOtpRecord>;
    const rec = stored[key];
    if (rec) {
      memoryOtpStore.set(key, rec);
      return rec;
    }
  } catch {}
  return undefined;
}

async function deleteOtp(key: string): Promise<void> {
  memoryOtpStore.delete(key);
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), ".otp-storage.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const stored = JSON.parse(raw) as Record<string, StoredOtpRecord>;
    delete stored[key];
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");
  } catch {}
}

/** Generates a secure 6-digit OTP, stores its hash, and dispatches it via Gmail SMTP */
export const sendForgotPasswordOtp = createServerFn({ method: "POST" })
  .validator((d: unknown) => forgotPasswordOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();

    // Generate random 6-digit OTP
    const crypto = await import("crypto");
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + ((array[0] || 0) % 900000));

    const tokenHash = await hashOtp(`forgot:${normalizedEmail}:${otp}`);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store in resilient cache
    await saveOtp(`forgot:${normalizedEmail}`, {
      tokenHash,
      expiresAt,
      attempts: 0,
    });

    // Dispatch email via Gmail SMTP
    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    const mailResult = await sendNotificationEmail({
      to: normalizedEmail,
      subject: `Your Password Reset OTP: ${otp} - Sentinel Security`,
      text: `Hello,\n\nA password reset request was initiated for your Sentinel account.\n\nYour 6-digit OTP is:\n\n${otp}\n\nThis code is valid for 10 minutes. Do NOT share this code with anyone.\n\nRegards,\nSentinel Security Team`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
          <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Password Reset Verification</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">A password reset request was initiated for your Sentinel account (<strong>${normalizedEmail}</strong>).</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
            <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; margin-bottom: 6px;">One-Time Verification Code</div>
            <div style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 0.3em; color: #1e40af;">${otp}</div>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
        </div>
      `,
    });

    console.log(`[Auth] Dispatched forgot-password OTP to ${normalizedEmail}. Success: ${mailResult.success}`);

    return {
      sent: true,
      delivered: mailResult.success,
      provider: mailResult.provider,
      error: mailResult.error,
    };
  });

/** Verifies the 6-digit OTP and updates the user's password directly in Supabase */
export const resetPasswordWithOtp = createServerFn({ method: "POST" })
  .validator((d: unknown) => resetPasswordWithOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashOtp(`forgot:${normalizedEmail}:${data.otp.trim()}`);

    const cached = await loadOtp(`forgot:${normalizedEmail}`);
    if (!cached) {
      throw new Error("No verification code found. Please request a new code.");
    }
    if (cached.expiresAt <= Date.now()) {
      await deleteOtp(`forgot:${normalizedEmail}`);
      throw new Error("This verification code has expired. Please request a new one.");
    }
    if (cached.attempts >= 5) {
      await deleteOtp(`forgot:${normalizedEmail}`);
      throw new Error("Too many failed attempts. Please request a new code.");
    }
    if (cached.tokenHash !== tokenHash) {
      cached.attempts += 1;
      await saveOtp(`forgot:${normalizedEmail}`, cached);
      throw new Error("Invalid 6-digit verification code. Please check your email.");
    }

    // Update password in Supabase
    let updatedByServer = false;
    let errorMessage = "";

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Try database RPC if available
      try {
        const { data: rpcSuccess, error: rpcError } = await (supabaseAdmin as any).rpc("reset_user_password_by_email", {
          p_email: normalizedEmail,
          p_password: data.password,
        });
        if (!rpcError && rpcSuccess) {
          updatedByServer = true;
        }
      } catch {
        // RPC fallback
      }

      // 2. Try Admin API using service_role key
      if (!updatedByServer) {
        try {
          const { data: userList, error: listError } = await supabaseAdmin.auth.admin.listUsers();
          const foundUser = userList?.users?.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );

          if (foundUser) {
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
              foundUser.id,
              { password: data.password, email_confirm: true }
            );
            if (!updateError) {
              updatedByServer = true;
            } else {
              errorMessage = updateError.message;
            }
          } else {
            // User doesn't exist yet in this database - create with the new password!
            const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
              email: normalizedEmail,
              password: data.password,
              email_confirm: true,
            });

            if (!createError && createdUser?.user) {
              updatedByServer = true;
            } else {
              errorMessage = createError?.message || "Could not set password for this account";
            }
          }
        } catch (adminErr: any) {
          errorMessage = adminErr?.message || "Admin API error";
        }
      }

      if (updatedByServer) {
        // OTP verified and password set! Clean up cache
        await deleteOtp(`forgot:${normalizedEmail}`);

        // Send confirmation email via Gmail SMTP
        try {
          const { sendNotificationEmail } = await import("@/lib/mailer.server");
          await sendNotificationEmail({
            to: normalizedEmail,
            subject: "Your Sentinel password has been changed",
            text: `Hello,\n\nYour Sentinel Security account password was successfully changed.\n\nRegards,\nSentinel Security Team`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
                <h2 style="color: #111827; margin-top: 0;">Password Changed Successfully ✅</h2>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Hello,</p>
                <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Your Sentinel Security account password for <strong>${normalizedEmail}</strong> has been successfully changed.</p>
                <div style="margin: 20px 0; padding: 14px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 14px;">
                  Your password has been updated. You can now sign in with your new password.
                </div>
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
              </div>
            `,
          });
        } catch {}
      }
    } catch (e: any) {
      console.error("[Auth] Reset password error:", e);
      errorMessage = errorMessage || e?.message || "Unknown error resetting password";
    }

    if (!updatedByServer) {
      throw new Error(
        errorMessage ||
          "Could not update password in database. Please check your credentials."
      );
    }

    return { success: true, verified: true, updatedByServer: true };
  });

/** Generates and sends a 6-digit verification code to verify user email before creating their account */
export const sendRegistrationOtp = createServerFn({ method: "POST" })
  .validator((d: unknown) => registrationOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const name = data.fullName?.trim() || "User";

    const crypto = await import("crypto");
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + ((array[0] || 0) % 900000));

    const tokenHash = await hashOtp(`register:${normalizedEmail}:${otp}`);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    await saveOtp(`register:${normalizedEmail}`, {
      tokenHash,
      expiresAt,
      attempts: 0,
    });

    const { sendNotificationEmail } = await import("@/lib/mailer.server");
    const mailResult = await sendNotificationEmail({
      to: normalizedEmail,
      subject: `Your Registration Verification Code: ${otp} - Sentinel Security`,
      text: `Hello ${name},\n\nYour 6-digit registration verification code is:\n\n${otp}\n\nThis code will expire in 10 minutes.\n\nBest regards,\nSentinel Security Team`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
          <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Complete Your Registration</h2>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Hello <strong>${name}</strong>,</p>
          <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Please enter the 6-digit verification code below to verify your email and create your account:</p>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #166534; margin-bottom: 6px;">Registration Verification Code</div>
            <div style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 0.3em; color: #15803d;">${otp}</div>
          </div>
          <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>.</p>
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
        </div>
      `,
    });

    console.log(`[Auth] Dispatched registration OTP to ${normalizedEmail}. Success: ${mailResult.success}`);

    return {
      sent: true,
      delivered: mailResult.success,
      provider: mailResult.provider,
      error: mailResult.error,
    };
  });

/** Verifies the 6-digit OTP entered by the user before creating their account */
export const verifyRegistrationOtp = createServerFn({ method: "POST" })
  .validator((d: unknown) => verifyRegistrationOtpInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashOtp(`register:${normalizedEmail}:${data.otp.trim()}`);

    const cached = await loadOtp(`register:${normalizedEmail}`);
    if (!cached) {
      throw new Error("No verification code found. Please request a new code.");
    }
    if (cached.expiresAt <= Date.now()) {
      await deleteOtp(`register:${normalizedEmail}`);
      throw new Error("This verification code has expired. Please request a new code.");
    }
    if (cached.attempts >= 5) {
      await deleteOtp(`register:${normalizedEmail}`);
      throw new Error("Too many failed attempts. Please request a new code.");
    }
    if (cached.tokenHash !== tokenHash) {
      cached.attempts += 1;
      await saveOtp(`register:${normalizedEmail}`, cached);
      throw new Error("Invalid 6-digit verification code. Please check your email.");
    }

    await deleteOtp(`register:${normalizedEmail}`);
    return { success: true };
  });

/**
 * Verifies the 6-digit OTP and creates/activates the user account in Supabase with email_confirm: true,
 * ensuring seamless immediate login and redirect to the user dashboard.
 */
export const registerVerifiedUser = createServerFn({ method: "POST" })
  .validator((d: unknown) => registerVerifiedUserInput.parse(d))
  .handler(async ({ data }) => {
    const normalizedEmail = data.email.trim().toLowerCase();
    const tokenHash = await hashOtp(`register:${normalizedEmail}:${data.otp.trim()}`);

    const cached = await loadOtp(`register:${normalizedEmail}`);
    if (!cached) {
      throw new Error("No verification code found. Please request a new code.");
    }
    if (cached.expiresAt <= Date.now()) {
      await deleteOtp(`register:${normalizedEmail}`);
      throw new Error("This verification code has expired. Please request a new one.");
    }
    if (cached.attempts >= 5) {
      await deleteOtp(`register:${normalizedEmail}`);
      throw new Error("Too many failed attempts. Please request a new code.");
    }
    if (cached.tokenHash !== tokenHash) {
      cached.attempts += 1;
      await saveOtp(`register:${normalizedEmail}`, cached);
      throw new Error("Invalid 6-digit verification code. Please check your email.");
    }

    // OTP is valid! Clean up OTP record
    await deleteOtp(`register:${normalizedEmail}`);

    let userId: string | null = null;
    let createdOrUpdated = false;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // 1. Attempt to create user with email_confirm: true
      try {
        const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password: data.password,
          email_confirm: true,
          user_metadata: {
            full_name: data.fullName,
          },
        });

        if (!createError && createdUser?.user) {
          userId = createdUser.user.id;
          createdOrUpdated = true;
        }
      } catch (err) {
        console.warn("[Register] Admin createUser attempt:", err);
      }

      // 2. If user already exists in auth, update password and mark email confirmed
      if (!createdOrUpdated) {
        try {
          const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
          const existingUser = userList?.users?.find(
            (u) => u.email?.toLowerCase() === normalizedEmail
          );

          if (existingUser) {
            const { data: updated, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
              existingUser.id,
              {
                password: data.password,
                email_confirm: true,
                user_metadata: {
                  full_name: data.fullName,
                },
              }
            );

            if (!updateError && updated?.user) {
              userId = updated.user.id;
              createdOrUpdated = true;
            }
          }
        } catch (listErr) {
          console.warn("[Register] Admin list/update attempt:", listErr);
        }
      }

      // 3. Upsert profile in profiles table
      if (userId) {
        try {
          await supabaseAdmin.from("profiles").upsert(
            {
              id: userId,
              email: normalizedEmail,
              full_name: data.fullName,
              account_locked: false,
              flagged_for_review: false,
              require_password_reset: false,
            },
            { onConflict: "id" }
          );
        } catch (profErr) {
          console.warn("[Register] Profile upsert warning:", profErr);
        }
      }
    } catch (adminErr) {
      console.warn("[Register] Admin error:", adminErr);
    }

    // 4. Send official welcome email notification
    try {
      const { sendNotificationEmail } = await import("@/lib/mailer.server");
      await sendNotificationEmail({
        to: normalizedEmail,
        subject: "Welcome to Sentinel Security - Account Created",
        text: `Hello ${data.fullName},\n\nYour Sentinel Security account has been successfully created and verified for ${normalizedEmail}.\n\nYou are now signed in and can access your security dashboard.\n\nBest regards,\nSentinel Security Team`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #ffffff;">
            <h2 style="color: #111827; margin-top: 0; font-size: 20px;">Welcome to Sentinel Security! 🎉</h2>
            <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Hello <strong>${data.fullName}</strong>,</p>
            <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">Your Sentinel account for <strong>${normalizedEmail}</strong> has been successfully created and verified.</p>
            <div style="margin: 20px 0; padding: 14px 18px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 14px; font-weight: 500;">
              ✓ Email verified & account activated successfully
            </div>
            <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">You can now view real-time security events, monitor login IP addresses, and manage your account security posture from your dashboard.</p>
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">Sentinel Security Notification System</p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn("[Register] Welcome email send error:", mailErr);
    }

    return {
      success: true,
      verified: true,
      createdOrUpdated,
      email: normalizedEmail,
    };
  });
