import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ClipboardCheck, ClipboardList, FileSpreadsheet, LogOut, MapPin, ShieldAlert, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { amIAdmin } from "@/lib/admin.functions";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/admin/dashboard", label: "Overview", icon: ShieldAlert },
  { to: "/admin/reports", label: "Reports & Audit", icon: FileSpreadsheet },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/admin/location", label: "Locations", icon: MapPin },
  { to: "/admin/events", label: "Security events", icon: AlertTriangle },
  { to: "/admin/audit", label: "Audit log", icon: ClipboardList },
] as const;

export function useAdminGuard() {
  const check = useServerFn(amIAdmin);
  return useQuery({ queryKey: ["am-i-admin"], queryFn: () => check(), staleTime: 60_000 });
}

export function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const guard = useAdminGuard();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/admin/login", replace: true });
  }

  if (guard.isLoading) {
    return <div className="p-10 text-sm text-muted-foreground">Verifying administrator access…</div>;
  }

  if (!guard.data?.admin) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <ShieldAlert className="mx-auto mb-3 size-8 text-destructive" />
        <h1 className="text-lg font-semibold">Administrator access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account does not hold the administrator role. Every admin API is enforced server-side,
          so no client change can grant access.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/user/dashboard" })}>
            Back to my account
          </Button>
          <Button onClick={signOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-navy text-navy-foreground print:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link to="/admin/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldAlert className="size-5" />
            Sentinel Security Operations
          </Link>
          <span className="rounded bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            Admin
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-navy-foreground hover:bg-white/10" onClick={signOut}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-56 print:hidden">
          <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
            {NAV.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname === to
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function RiskBadge({ score, level }: { score: number; level: string }) {
  const tone =
    level === "CRITICAL"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : level === "HIGH"
        ? "bg-warning/10 text-warning border-warning/30"
        : level === "MEDIUM"
          ? "bg-accent text-accent-foreground border-border"
          : "bg-success/10 text-success border-success/30";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", tone)}>
      {score}/100 · {level}
    </span>
  );
}
