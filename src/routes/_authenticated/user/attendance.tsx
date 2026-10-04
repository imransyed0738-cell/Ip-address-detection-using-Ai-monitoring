import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/user/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Dashboard — Sentinel Secure Banking" },
      {
        name: "description",
        content: "Manually record and review your attendance history.",
      },
    ],
  }),
  component: AttendanceDashboard,
});

function AttendanceDashboard() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("Present");
  const [note, setNote] = useState("");

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
    queryKey: ["attendance", "logs", "user"],
    queryFn: async () => {
      const result = await getLogsFn({ data: { limit: 100 } });
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
      setNote("");

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
      toast.success(`Deleted attendance record for ${record.date}`);

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

  const records = attendanceQuery.data ?? [];

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)),
    [records],
  );
  const presentCount = records.filter((record) => record.status === "Present").length;
  const lateCount = records.filter((record) => record.status === "Late").length;

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
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-caps">Daily records</p>
          <h1 className="text-2xl font-semibold">Attendance dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add attendance with your name, roll number, and the current server-observed IP address.
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
            <Link to="/user/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Summary label="Total records" value={records.length} />
        <Summary label="Present" value={presentCount} tone="success" />
        <Summary label="Late" value={lateCount} tone="warning" />
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
            <Label htmlFor="attendance-name">Name</Label>
            <Input
              id="attendance-name"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-roll">Roll number</Label>
            <Input
              id="attendance-roll"
              placeholder="e.g. CS-024"
              value={rollNumber}
              onChange={(event) => setRollNumber(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-status">Status</Label>
            <select
              id="attendance-status"
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
            <Label htmlFor="attendance-note">Note (optional)</Label>
            <Input
              id="attendance-note"
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
          The IP is observed by the server and refreshed automatically. Records are stored centrally in the database.
        </p>
      </section>

      <section className="panel mt-6 p-5">
        <h2 className="font-semibold">Attendance history</h2>
        {attendanceQuery.isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <RefreshCw className="mx-auto mb-2 size-5 animate-spin" />
            Loading your attendance history…
          </div>
        ) : sortedRecords.length ? (
          <div className="mt-4 divide-y divide-border">
            {sortedRecords.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center gap-3 py-3">
                <time className="w-32 text-sm font-medium" dateTime={record.date}>
                  {record.date}
                </time>
                <div className="min-w-40">
                  <div className="text-sm font-medium">{record.name || "Unknown"}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {record.rollNumber || "No roll number"}
                  </div>
                </div>
                <span className={statusClass(record.status)}>{record.status}</span>
                <span className="min-w-40 flex-1 text-sm text-muted-foreground">
                  {record.note || "No note added"}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {record.ipAddress || "IP unavailable"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete attendance for ${record.date}`}
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
            No attendance records yet. Add your first day above.
          </p>
        )}
      </section>
    </AppShell>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <div className="panel p-4">
      <p className="label-caps">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}
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

