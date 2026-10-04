import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Globe2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AdminShell, RiskBadge } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { adminAuditLog, adminSecurityEvents } from "@/lib/admin.functions";
import { getAttendanceLogs } from "@/lib/security.functions";
import {
  exportAttendanceAuditPdf,
  exportSecurityAuditPdf,
  exportToCsv,
  exportUnifiedCompliancePdf,
  type AttendanceReportItem,
  type SecurityEventReportItem,
  type SystemAuditItem,
} from "@/lib/report-export";
import { formatWhen, prettyEvent } from "@/lib/user-data";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  head: () => ({
    meta: [
      { title: "Compliance & Audit Reports — Sentinel Admin" },
      {
        name: "description",
        content: "Generate and export SOC 2, ISO 27001, security, and attendance audit reports in PDF and CSV format.",
      },
    ],
  }),
  component: AdminReports,
});

type ReportCategory = "security" | "attendance" | "audit" | "unified";
type TimeRange = "all" | "today" | "7d" | "30d";

function AdminReports() {
  const [category, setCategory] = useState<ReportCategory>("security");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const loadSecurityEvents = useServerFn(adminSecurityEvents);
  const loadAttendance = useServerFn(getAttendanceLogs);
  const loadAudit = useServerFn(adminAuditLog);

  // Queries
  const securityQuery = useQuery({
    queryKey: ["admin", "reports", "security"],
    queryFn: () => loadSecurityEvents({ data: { highRiskOnly: false } }),
  });

  const attendanceQuery = useQuery({
    queryKey: ["admin", "reports", "attendance"],
    queryFn: async () => {
      const res = await loadAttendance({ data: { limit: 500 } });
      return (res ?? []) as AttendanceReportItem[];
    },
  });

  const auditQuery = useQuery({
    queryKey: ["admin", "reports", "audit"],
    queryFn: () => loadAudit(),
  });

  // Date filtering helper
  const isWithinRange = (dateStr?: string | null) => {
    if (!dateStr || timeRange === "all") return true;
    const date = new Date(dateStr).getTime();
    const now = Date.now();
    if (timeRange === "today") return now - date <= 24 * 60 * 60 * 1000;
    if (timeRange === "7d") return now - date <= 7 * 24 * 60 * 60 * 1000;
    if (timeRange === "30d") return now - date <= 30 * 24 * 60 * 60 * 1000;
    return true;
  };

  // Filtered datasets
  const filteredSecurity = useMemo(() => {
    const raw = (securityQuery.data ?? []) as any[];
    return raw.filter((item) => {
      if (!isWithinRange(item.created_at)) return false;
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        item.event_type?.toLowerCase().includes(q) ||
        item.ip_address?.toLowerCase().includes(q) ||
        item.region?.toLowerCase().includes(q) ||
        item.user?.email?.toLowerCase().includes(q) ||
        item.user?.full_name?.toLowerCase().includes(q)
      );
    });
  }, [securityQuery.data, timeRange, searchFilter]);

  const filteredAttendance = useMemo(() => {
    const raw = (attendanceQuery.data ?? []) as AttendanceReportItem[];
    return raw.filter((item) => {
      if (!isWithinRange(item.date || item.createdAt)) return false;
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        item.name?.toLowerCase().includes(q) ||
        item.rollNumber?.toLowerCase().includes(q) ||
        item.status?.toLowerCase().includes(q) ||
        item.ipAddress?.toLowerCase().includes(q)
      );
    });
  }, [attendanceQuery.data, timeRange, searchFilter]);

  const filteredAudit = useMemo(() => {
    const raw = (auditQuery.data ?? []) as SystemAuditItem[];
    return raw.filter((item) => {
      if (!isWithinRange(item.created_at)) return false;
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        item.action?.toLowerCase().includes(q) ||
        item.actor_role?.toLowerCase().includes(q) ||
        item.resource?.toLowerCase().includes(q) ||
        item.ip_address?.toLowerCase().includes(q)
      );
    });
  }, [auditQuery.data, timeRange, searchFilter]);

  // Formatted items for export
  const formattedSecurityItems: SecurityEventReportItem[] = useMemo(() => {
    return filteredSecurity.map((e) => ({
      id: e.id,
      created_at: e.created_at,
      event_type: prettyEvent(e.event_type),
      user_email: e.user?.email,
      user_name: e.user?.full_name,
      ip_address: e.ip_address,
      region: e.region,
      device: e.device_summary ?? (e.device ? `${e.device.browser || ""} ${e.device.os || ""}`.trim() : "—"),
      risk_score: e.risk_score ?? 0,
      risk_level: e.risk_level ?? "LOW",
      status: e.status ?? "Processed",
    }));
  }, [filteredSecurity]);

  // Export handlers
  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      if (category === "security") {
        const headers = ["Timestamp", "Event Type", "User Name", "Email", "IP Address", "Region", "Device", "Risk Score", "Risk Level", "Status"];
        const rows = formattedSecurityItems.map((s) => [
          s.created_at,
          s.event_type,
          s.user_name || "—",
          s.user_email || "—",
          s.ip_address || "—",
          s.region || "—",
          s.device || "—",
          s.risk_score,
          s.risk_level,
          s.status,
        ]);
        exportToCsv(`Sentinel_Security_Audit_${stamp}`, headers, rows);
        toast.success("Security Audit CSV exported successfully!");
      } else if (category === "attendance") {
        const headers = ["Date", "Member Name", "Roll / Staff ID", "Status", "Verified IP", "Notes", "Recorded At"];
        const rows = filteredAttendance.map((a) => [
          a.date,
          a.name,
          a.rollNumber || "—",
          a.status,
          a.ipAddress || "—",
          a.note || "—",
          a.createdAt || "—",
        ]);
        exportToCsv(`Sentinel_Attendance_Audit_${stamp}`, headers, rows);
        toast.success("Attendance Audit CSV exported successfully!");
      } else if (category === "audit") {
        const headers = ["Timestamp", "Action", "Actor Role", "Actor ID", "Resource", "IP Address", "Result"];
        const rows = filteredAudit.map((a) => [
          a.created_at,
          a.action,
          a.actor_role || "—",
          a.actor_id || "—",
          a.resource || "—",
          a.ip_address || "—",
          a.result || "—",
        ]);
        exportToCsv(`Sentinel_System_Audit_${stamp}`, headers, rows);
        toast.success("System Audit Log CSV exported successfully!");
      } else {
        // Unified CSV
        const headers = ["Report Domain", "Timestamp", "Entity / Action", "Identity / Name", "IP Address", "Risk / Status"];
        const secRows = formattedSecurityItems.map((s) => ["Security", s.created_at, s.event_type, s.user_email || "—", s.ip_address || "—", s.risk_level]);
        const attRows = filteredAttendance.map((a) => ["Attendance", a.date, a.status, a.name, a.ipAddress || "—", a.status]);
        exportToCsv(`Sentinel_Unified_Compliance_${stamp}`, headers, [...secRows, ...attRows]);
        toast.success("Unified Master Compliance CSV exported successfully!");
      }
    } catch (err: any) {
      toast.error("Failed to generate CSV", { description: err?.message });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = () => {
    setIsExporting(true);
    try {
      const scopeLabel = timeRange === "all" ? "All-Time Records" : timeRange === "today" ? "Last 24 Hours" : timeRange === "7d" ? "Past 7 Days" : "Past 30 Days";
      if (category === "security") {
        if (!formattedSecurityItems.length) {
          toast.warning("No security records in the selected filter range.");
          return;
        }
        exportSecurityAuditPdf(formattedSecurityItems, { dateRange: scopeLabel, generatedBy: "Sentinel Admin" });
        toast.success("Security Audit PDF report generated and downloaded!");
      } else if (category === "attendance") {
        if (!filteredAttendance.length) {
          toast.warning("No attendance records in the selected filter range.");
          return;
        }
        exportAttendanceAuditPdf(filteredAttendance, { dateRange: scopeLabel, generatedBy: "Sentinel Admin" });
        toast.success("Attendance Compliance PDF report generated!");
      } else {
        // Unified / System Audit
        exportUnifiedCompliancePdf(formattedSecurityItems, filteredAttendance, filteredAudit, {
          dateRange: scopeLabel,
          generatedBy: "Chief Information Security Officer",
        });
        toast.success("Unified Master Compliance Dossier generated!");
      }
    } catch (err: any) {
      toast.error("Failed to generate PDF", { description: err?.message });
    } finally {
      setIsExporting(false);
    }
  };

  // KPIs
  const totalEvents = filteredSecurity.length;
  const highRiskEvents = filteredSecurity.filter((s) => (s.risk_score ?? 0) >= 55).length;
  const uniqueIps = new Set(filteredSecurity.map((s) => s.ip_address).filter(Boolean)).size;
  const totalAttendance = filteredAttendance.length;
  const attendancePresent = filteredAttendance.filter((a) => a.status === "Present" || a.status === "Late").length;
  const attendanceRate = totalAttendance > 0 ? Math.round((attendancePresent / totalAttendance) * 100) : 100;

  return (
    <AdminShell>
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Compliance & Audit Reports</h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              Enterprise Exporter
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate formal, tamper-evident security audit dossiers and attendance verification sheets in PDF and CSV format.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 border-border shadow-xs"
            onClick={handleExportCsv}
            disabled={isExporting}
          >
            <FileSpreadsheet className="size-4 text-emerald-600" />
            Export CSV
          </Button>
          <Button
            className="gap-2 bg-navy text-navy-foreground shadow-xs hover:bg-navy/90"
            onClick={handleExportPdf}
            disabled={isExporting}
          >
            <FileText className="size-4 text-blue-400" />
            Download PDF Report
          </Button>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Security Telemetry</span>
            <ShieldCheck className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{totalEvents}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Monitored authentication logs</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-destructive">High-Risk Flags</span>
            <AlertTriangle className="size-4 text-destructive" />
          </div>
          <div className="mt-2 text-2xl font-bold text-destructive">{highRiskEvents}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Anomalies requiring human review</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Observed IP Nodes</span>
            <Globe2 className="size-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{uniqueIps}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Distinct geolocation origins</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-600">Attendance Rate</span>
            <ClipboardCheck className="size-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{attendanceRate}%</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{totalAttendance} total verified entries</p>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs md:flex-row md:items-center md:justify-between">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory("security")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              category === "security"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <ShieldAlert className="size-3.5" />
            Security & Threat Audit
          </button>
          <button
            onClick={() => setCategory("attendance")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              category === "attendance"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <ClipboardCheck className="size-3.5" />
            Workforce Attendance
          </button>
          <button
            onClick={() => setCategory("audit")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              category === "audit"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="size-3.5" />
            System Audit Log
          </button>
          <button
            onClick={() => setCategory("unified")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              category === "unified"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            }`}
          >
            <FileText className="size-3.5" />
            Master SOC 2 / ISO Dossier
          </button>
        </div>

        {/* Date Filter & Search */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-background px-2.5 py-1 text-xs">
            <Calendar className="mr-1.5 size-3.5 text-muted-foreground" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="bg-transparent font-medium outline-hidden"
            >
              <option value="all">All-Time</option>
              <option value="today">Today (24h)</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div className="flex items-center rounded-lg border border-border bg-background px-2.5 py-1 text-xs">
            <Filter className="mr-1.5 size-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search in report…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-32 bg-transparent outline-hidden sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* Live Data Preview Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-2xs">
        <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {category === "security" && `Security Telemetry Preview (${formattedSecurityItems.length} records)`}
            {category === "attendance" && `Attendance Register Preview (${filteredAttendance.length} records)`}
            {category === "audit" && `System Audit Log Preview (${filteredAudit.length} records)`}
            {category === "unified" && `Unified Dossier Preview (${formattedSecurityItems.length + filteredAttendance.length} records)`}
          </div>
          <span className="text-[11px] text-muted-foreground">
            Included in PDF & CSV exports
          </span>
        </div>

        <div className="max-h-[480px] overflow-auto">
          {category === "security" && (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Timestamp</th>
                  <th className="px-3.5 py-2.5 font-medium">Event Type</th>
                  <th className="px-3.5 py-2.5 font-medium">User Account</th>
                  <th className="px-3.5 py-2.5 font-medium">Verified IP</th>
                  <th className="px-3.5 py-2.5 font-medium">Region</th>
                  <th className="px-3.5 py-2.5 font-medium">Device Fingerprint</th>
                  <th className="px-3.5 py-2.5 font-medium">Threat Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {formattedSecurityItems.map((item, idx) => (
                  <tr key={item.id ?? idx} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3.5 py-2 text-muted-foreground">
                      {formatWhen(item.created_at)}
                    </td>
                    <td className="px-3.5 py-2 font-medium">{item.event_type}</td>
                    <td className="px-3.5 py-2">
                      <div className="font-medium text-foreground">{item.user_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{item.user_email || "System"}</div>
                    </td>
                    <td className="px-3.5 py-2 font-mono text-[11px]">{item.ip_address || "—"}</td>
                    <td className="px-3.5 py-2">{item.region || "—"}</td>
                    <td className="px-3.5 py-2 text-muted-foreground">{item.device}</td>
                    <td className="px-3.5 py-2">
                      <RiskBadge level={item.risk_level} score={item.risk_score} />
                    </td>
                  </tr>
                ))}
                {!formattedSecurityItems.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No security records match your selected filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {category === "attendance" && (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Date</th>
                  <th className="px-3.5 py-2.5 font-medium">Name</th>
                  <th className="px-3.5 py-2.5 font-medium">Roll / Staff ID</th>
                  <th className="px-3.5 py-2.5 font-medium">Status</th>
                  <th className="px-3.5 py-2.5 font-medium">Logged IP</th>
                  <th className="px-3.5 py-2.5 font-medium">Audit Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAttendance.map((item, idx) => (
                  <tr key={item.id ?? idx} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3.5 py-2 text-muted-foreground font-mono">{item.date}</td>
                    <td className="px-3.5 py-2 font-medium">{item.name}</td>
                    <td className="px-3.5 py-2 font-mono text-muted-foreground">{item.rollNumber || "—"}</td>
                    <td className="px-3.5 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          item.status === "Present"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : item.status === "Late"
                            ? "bg-amber-500/10 text-amber-600"
                            : item.status === "Absent"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-blue-500/10 text-blue-600"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-2 font-mono text-[11px]">{item.ipAddress || "—"}</td>
                    <td className="px-3.5 py-2 text-muted-foreground">{item.note || "Standard verification"}</td>
                  </tr>
                ))}
                {!filteredAttendance.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No attendance records match your selected filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {category === "audit" && (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">Timestamp</th>
                  <th className="px-3.5 py-2.5 font-medium">Action</th>
                  <th className="px-3.5 py-2.5 font-medium">Actor</th>
                  <th className="px-3.5 py-2.5 font-medium">Resource</th>
                  <th className="px-3.5 py-2.5 font-medium">IP Address</th>
                  <th className="px-3.5 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAudit.map((item, idx) => (
                  <tr key={item.id ?? idx} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-3.5 py-2 text-muted-foreground">{formatWhen(item.created_at)}</td>
                    <td className="px-3.5 py-2 font-medium">{item.action}</td>
                    <td className="px-3.5 py-2 text-muted-foreground">{item.actor_role || "Admin"}</td>
                    <td className="px-3.5 py-2 font-mono text-[11px]">{item.resource || "—"}</td>
                    <td className="px-3.5 py-2 font-mono text-[11px]">{item.ip_address || "—"}</td>
                    <td className="px-3.5 py-2">{item.result || "—"}</td>
                  </tr>
                ))}
                {!filteredAudit.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No system audit entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {category === "unified" && (
            <div className="p-6 text-center">
              <FileText className="mx-auto size-12 text-primary/80" />
              <h3 className="mt-3 text-base font-semibold">Master Enterprise Compliance Dossier</h3>
              <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                The Master Dossier merges verified security events, geofenced staff attendance records, and administrator system audit trails into an executive, multi-page ISO 27001 / SOC 2 formatted document.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <Button size="sm" onClick={handleExportPdf} className="gap-2">
                  <Download className="size-4" /> Download Complete Master PDF
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportCsv} className="gap-2">
                  <FileSpreadsheet className="size-4" /> Export Combined CSV
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
