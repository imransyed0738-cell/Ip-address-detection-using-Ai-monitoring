import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type AdminRealtimeStatus = "CONNECTING" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT";

export function useAdminRealtime(): AdminRealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminRealtimeStatus>("CONNECTING");

  useEffect(() => {
    const channel = supabase
      .channel("admin-security-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "security_events" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "security_alerts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_logs" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_logs" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "security_risk_assessments" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      })
      .subscribe((nextStatus) => {
        if (
          nextStatus === "SUBSCRIBED" ||
          nextStatus === "CHANNEL_ERROR" ||
          nextStatus === "TIMED_OUT"
        ) {
          setStatus(nextStatus);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return status;
}