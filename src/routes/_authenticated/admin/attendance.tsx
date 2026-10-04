import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, FileSpreadsheet, FileText, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AdminShell } from "@/components/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportAttendanceAuditPdf, exportToCsv } from "@/lib/report-export";
import {
  deleteAttendanceLog,
  getAttendanceLogs,
  getConnectionInfo,
  notifyAttendanceChange,
  saveAttendanceLog,
} from "@/lib/security.functions";

const statuses = ["Present", "Late", "Absent", "Leave"] as const;
type AttendanceStatus = (typeof statuses)[number];

type AttendanceRecord = {
  id: string;
  userId?: string | null;
  name: string;
  rollNumber: string;
  date: string;
  status: AttendanceStatus;
  note: string;
  ipAddress: string;
  createdAt?: string;
  updatedAt?: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function currentConnection(
  getServerConnection: () => Promise<{ ip: string; location: string | null; userAgent: string }>,
) {
  const connection = await getServerConnection();
  if (connection.ip !== "unknown") return connection;

  try {
    const response = await fetch("https://api64.ipify.org?format=json");
    if (!response.ok) return connection;
    const result = (await response.json()) as { ip?: unknown };
    return typeof result.ip === "string" ? { ...connection, ip: result.ip } : connection;
  } catch {
    return connection;
  }
}

export const Route = createFileRoute("/_authenticated/admin/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Dashboard — Sentinel Admin" },
      { name: "description", content: "Manually record and review administrator and user attendance." },
    ],
  }),
  component: AdminAttendance,
});

function AdminAttendance() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("Present");
  const [note, setNote] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [dateFilter, setDateFilter] = useState<string>("");

  const connectionFn = useServerFn(getConnectionInfo);
  const getLogsFn = useServerFn(getAttendanceLogs);
  const saveLogFn = useServerFn(saveAttendanceLog);
  const deleteLogFn = useServerFn(deleteAttendanceLog);
  const notifyChangeFn = useServerFn(notifyAttendanceChange);

  const connection = useQuery({
    queryKey: ["attendance", "connection"],
    queryFn: () => currentConnection(() => connectionFn()),
    refetchInterval: 30_000,
  });

  const attendanceQuery = useQuery({
    queryKey: ["attendance", "logs", statusFilter, dateFilter],
    queryFn: async () => {
      const result = await getLogsFn({
        data: {
          status: statusFilter !== "All" ? statusFilter : undefined,
          date: dateFilter ? dateFilter : undefined,
          limit: 300,
        },
      });
      return (result ?? []) as AttendanceRecord[];
    },
    refetchInterval: 15_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      rollNumber: string;
      date: string;
      status: AttendanceStatus;
      note?: string;
      ipAddress?: string;
    }) => {
      const res = await saveLogFn({ data: payload });
      return res;
    },
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
      toast.success(`Attendance saved for ${vars.name} (${vars.rollNumber})`);
      setName("");
      setRollNumber("");
      setNote("");

      // Optional email notification for edits
      notifyChangeFn({
        data: {
          action: "modified",
          attendance: {
            name: vars.name,
            rollNumber: vars.rollNumber,
            date: vars.date,
            status: vars.status,
            note: vars.note ?? "",
            ipAddress: vars.ipAddress ?? "Unavailable",
          },
        },
      }).catch(() => undefined);
    },
    onError: (error: Error) => {
      toast.error("Failed to save attendance", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (record: AttendanceRecord) => {
      await deleteLogFn({ data: { id: record.id } });
      return record;
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: ["attendance", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["security_alerts"] });
      toast.success(`Deleted attendance record for ${record.name}`);

      notifyChangeFn({
        data: {
          action: "deleted",
          attendance: {
            name: record.name,
            rollNumber: record.rollNumber,
            date: record.date,
            status: record.status,
            note: record.note ?? "",
            ipAddress: record.ipAddress ?? "Unavailable",
          },
        },
      }).catch(() => undefined);
    },
    onError: (error: Error) => {
      toast.error("Failed to delete record", { description: error.message });
    },
  });

  const allRecords = attendanceQuery.data ?? [];

  const filteredRecords = useMemo(() => {
    if (!searchTerm.trim()) return allRecords;
    const q = searchTerm.trim().toLowerCase();
    return allRecords.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.rollNumber.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q) ||
        r.ipAddress.toLowerCase().includes(q),
    );
  }, [allRecords, searchTerm]);

  const presentCount = allRecords.filter((r) => r.status === "Present").length;
  const lateCount = allRecords.filter((r) => r.status === "Late").length;
  const absentCount = allRecords.filter((r) => r.status === "Absent").length;
  const leaveCount = allRecords.filter((r) => r.status === "Leave").length;

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !name.trim() || !rollNumber.trim()) return;

    saveMutation.mutate({
      name: name.trim(),
      rollNumber: rollNumber.trim(),
      date,
      status,
      note: note.trim(),
      ipAddress: connection.data?.ip ?? "Unavailable",
    });
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Central Attendance Database</p>
          <h1 className="text-2xl font-semibold">Attendance dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All user &amp; admin attendance logs stored securely in the database with public IP tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => attendanceQuery.refetch()}
            disabled={attendanceQuery.isFetching}
          >
            <RefreshCw className={`mr-2 size-4 ${attendanceQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild variant="outline">
            <Link to="/admin/dashboard">Back to overview</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Summary label="Total records" value={allRecords.length} />
        <Summary label="Present" value={presentCount} tone="success" />
        <Summary label="Late" value={lateCount} tone="warning" />
        <Summary label="Absent / Leave" value={absentCount + leaveCount} tone="danger" />
      </div>

      <section className="panel mt-6 p-5">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-5 text-accent" />
          <h2 className="font-semibold">Record attendance</h2>
        </div>
        <form
          className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end"
          onSubmit={handleSave}
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-attendance-name">Name</Label>
            <Input
              id="admin-attendance-name"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-attendance-roll">Roll number</Label>
            <Input
              id="admin-attendance-roll"
              placeholder="e.g. CS-024 / EMP-101"
              value={rollNumber}
              onChange={(event) => setRollNumber(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-attendance-date">Date</Label>
            <Input
              id="admin-attendance-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-attendance-status">Status</Label>
            <select
              id="admin-attendance-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {statuses.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-attendance-note">Note (optional)</Label>
            <Input
              id="admin-attendance-note"
              placeholder="Add a short note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Current IP address</Label>
            <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 font-mono text-xs">
              {connection.isLoading ? "Detecting…" : (connection.data?.ip ?? "Unavailable")}
            </div>
          </div>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save attendance"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Attendance records are saved directly to the database and viewable by all administrators in real time.
        </p>
      </section>

      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Attendance history &amp; audit log</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search name, roll #, note…"
                className="pl-8 text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="All">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Input
              type="date"
              className="h-9 w-36 text-xs"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
            {dateFilter && (
              <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} className="text-xs">
                Clear date
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs shadow-2xs"
                onClick={() => {
                  if (!filteredRecords.length) {
                    toast.warning("No attendance records to export");
                    return;
                  }
                  const stamp = new Date().toISOString().slice(0, 10);
                  const headers = ["Date", "Name", "Roll / Staff ID", "Status", "Verified IP", "Audit Note", "Created At"];
                  const rows = filteredRecords.map((r) => [r.date, r.name, r.rollNumber, r.status, r.ipAddress, r.note, r.createdAt]);
                  exportToCsv(`Sentinel_Attendance_${stamp}`, headers, rows);
                  toast.success("Attendance CSV exported successfully");
                }}
              >
                <FileSpreadsheet className="size-3.5 text-emerald-600" />
                Export CSV
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5 bg-navy text-navy-foreground text-xs shadow-2xs hover:bg-navy/90"
                onClick={() => {
                  if (!filteredRecords.length) {
                    toast.warning("No attendance records to export");
                    return;
                  }
                  exportAttendanceAuditPdf(filteredRecords, {
                    dateRange: dateFilter || "Current View",
                    generatedBy: "Sentinel Admin",
                  });
                  toast.success("Attendance PDF Audit Report generated");
                }}
              >
                <FileText className="size-3.5 text-blue-400" />
                Export PDF
              </Button>
            </div>
          </div>
        </div>

        {attendanceQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="mx-auto mb-2 size-5 animate-spin" />
            Loading attendance records from database…
          </div>
        ) : filteredRecords.length ? (
          <div className="mt-4 divide-y divide-border">
            {filteredRecords.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center gap-3 py-3">
                <time className="w-28 text-sm font-medium" dateTime={record.date}>
                  {record.date}
                </time>
                <div className="min-w-44">
                  <div className="text-sm font-medium">{record.name || "Unknown"}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {record.rollNumber || "No roll #"}
                  </div>
                </div>
                <span className={statusClass(record.status)}>{record.status}</span>
                <span className="min-w-40 flex-1 text-sm text-muted-foreground">
                  {record.note || "No note added"}
                </span>
                <span className="font-mono text-xs text-muted-foreground" title="Server-observed IP">
                  {record.ipAddress || "IP unavailable"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete attendance for ${record.name} on ${record.date}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(record)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {searchTerm || statusFilter !== "All" || dateFilter
              ? "No attendance records match your filter criteria."
              : "No attendance records found in the database. Add your first day above."}
          </p>
        )}
      </section>
    </AdminShell>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="panel p-4">
      <p className="label-caps">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${
          tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : tone === "danger"
                ? "text-destructive"
                : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function statusClass(status: AttendanceStatus) {
  if (status === "Present")
    return "rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success";
  if (status === "Late")
    return "rounded-full bg-warning/20 px-3 py-1 text-xs font-semibold text-warning-foreground";
  if (status === "Absent")
    return "rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive";
  return "rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground";
}

