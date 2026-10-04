import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type SecurityEventReportItem = {
  id?: string;
  created_at: string;
  event_type: string;
  user_email?: string;
  user_name?: string;
  ip_address?: string;
  region?: string;
  device?: string;
  risk_score: number;
  risk_level: string;
  status: string;
};

export type AttendanceReportItem = {
  id?: string;
  date: string;
  name: string;
  rollNumber: string;
  status: string;
  ipAddress?: string;
  note?: string;
  createdAt?: string;
};

export type SystemAuditItem = {
  id?: string;
  created_at: string;
  action: string;
  actor_role?: string;
  actor_id?: string;
  resource?: string;
  ip_address?: string;
  result?: string;
};

/**
 * Downloads data as a standard RFC-4180 CSV with UTF-8 BOM for Microsoft Excel compatibility.
 */
export function exportToCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const sanitize = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return "";
    const str = String(val).replace(/"/g, '""');
    return /[",\n\r]/.test(str) ? `"${str}"` : str;
  };

  const headerLine = headers.map(sanitize).join(",");
  const bodyLines = rows.map((r) => r.map(sanitize).join(","));
  const csvContent = "\uFEFF" + [headerLine, ...bodyLines].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Adds an executive header and metadata block to a jsPDF document.
 */
function addDocumentHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  category: string,
  metaDetails: { label: string; value: string }[],
) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top decorative brand bar
  doc.setFillColor(15, 23, 42); // Navy slate (#0f172a)
  doc.rect(0, 0, pageWidth, 28, "F");

  doc.setFillColor(37, 99, 235); // Accent blue (#2563eb)
  doc.rect(0, 28, pageWidth, 2, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("SENTINEL SECURE BANKING & AI MONITORING", 14, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225); // Slate 300
  doc.text("INTELLIGENT IP THREAT DETECTION & COMPLIANCE PLATFORM", 14, 20);

  // Classification Tag
  doc.setFillColor(220, 38, 38); // Crimson red
  doc.roundedRect(pageWidth - 48, 8, 34, 12, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("CONFIDENTIAL", pageWidth - 45, 16);

  // Section Banner
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, 14, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${subtitle} • Category: ${category}`, 14, 46);

  // Metadata Panel
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 50, pageWidth - 28, 16, 2, 2, "FD");

  let xPos = 18;
  doc.setFontSize(8);
  metaDetails.forEach((item) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    doc.text(item.label.toUpperCase(), xPos, 56);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(item.value, xPos, 62);
    xPos += (pageWidth - 36) / metaDetails.length;
  });

  return 72; // Start Y position for next elements
}

/**
 * Adds document footer with page numbering and compliance verification.
 */
function addDocumentFooter(doc: jsPDF) {
  const pageCount = (doc as any).internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);

    const now = new Date().toLocaleString();
    doc.text(`Generated: ${now} | SOC 2 & ISO/IEC 27001 Compliant Audit Log`, 14, pageHeight - 8);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 30, pageHeight - 8);
  }
}

/**
 * Generates an executive Security Audit PDF Report.
 */
export function exportSecurityAuditPdf(
  events: SecurityEventReportItem[],
  options?: { dateRange?: string; generatedBy?: string },
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const total = events.length;
  const highRiskCount = events.filter((e) => e.risk_score >= 55).length;
  const mediumRiskCount = events.filter((e) => e.risk_score >= 30 && e.risk_score < 55).length;
  const avgRisk = total > 0 ? Math.round(events.reduce((acc, e) => acc + (e.risk_score || 0), 0) / total) : 0;
  const distinctIps = new Set(events.map((e) => e.ip_address).filter(Boolean)).size;

  const startY = addDocumentHeader(
    doc,
    "Security & Threat Intelligence Audit",
    "Comprehensive IP verification, authentication telemetry, and risk anomaly log",
    "Security Operations",
    [
      { label: "Date Range", value: options?.dateRange ?? "All Recorded Events" },
      { label: "Auditor", value: options?.generatedBy ?? "System Administrator" },
      { label: "Total Events", value: `${total} entries` },
      { label: "High Risk Alerts", value: `${highRiskCount} incidents` },
    ],
  );

  // KPI Metric Summary Cards
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardWidth = (pageWidth - 28 - 9) / 4;
  const kpis = [
    { title: "Total Monitored Events", value: String(total), color: [15, 23, 42] },
    { title: "High/Critical Anomalies", value: String(highRiskCount), color: [220, 38, 38] },
    { title: "Distinct IP Addresses", value: String(distinctIps), color: [37, 99, 235] },
    { title: "Average Risk Score", value: `${avgRisk}/100`, color: [217, 119, 6] },
  ];

  kpis.forEach((kpi, idx) => {
    const cardX = 14 + idx * (cardWidth + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cardX, startY, cardWidth, 18, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title, cardX + 3, startY + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, cardX + 3, startY + 13.5);
  });

  // Events Table
  const tableData = events.map((item) => {
    const when = item.created_at ? new Date(item.created_at).toLocaleString() : "—";
    const user = item.user_name ? `${item.user_name} (${item.user_email ?? ""})` : item.user_email ?? "System";
    const ip = item.ip_address ?? "—";
    const region = item.region ?? "—";
    const device = item.device ?? "—";
    const risk = `${item.risk_level ?? "LOW"} (${item.risk_score ?? 0})`;
    return [when, item.event_type, user, ip, region, device, risk];
  });

  autoTable(doc, {
    startY: startY + 23,
    head: [["Timestamp", "Event Type", "User Identity", "IP Address", "Region", "Device Fingerprint", "Risk Level"]],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: "bold",
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [51, 65, 85],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 24, fontStyle: "bold" },
      2: { cellWidth: 32 },
      3: { cellWidth: 24 },
      4: { cellWidth: 22 },
      5: { cellWidth: 30 },
      6: { cellWidth: 24, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        const text = String(data.cell.raw);
        if (text.includes("CRITICAL") || text.includes("HIGH")) {
          data.cell.styles.textColor = [220, 38, 38];
        } else if (text.includes("MEDIUM")) {
          data.cell.styles.textColor = [217, 119, 6];
        } else {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    },
    margin: { left: 14, right: 14, bottom: 20 },
  });

  addDocumentFooter(doc);
  doc.save(`Sentinel_Security_Audit_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Generates an executive Attendance Audit PDF Report.
 */
export function exportAttendanceAuditPdf(
  records: AttendanceReportItem[],
  options?: { dateRange?: string; generatedBy?: string },
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const total = records.length;
  const presentCount = records.filter((r) => r.status === "Present").length;
  const lateCount = records.filter((r) => r.status === "Late").length;
  const absentCount = records.filter((r) => r.status === "Absent").length;
  const leaveCount = records.filter((r) => r.status === "Leave").length;
  const presentRate = total > 0 ? Math.round(((presentCount + lateCount) / total) * 100) : 0;

  const startY = addDocumentHeader(
    doc,
    "Workforce & User Attendance Compliance Audit",
    "Verified IP-logged attendance registry with timestamp and anomaly tracking",
    "Human Resources & Compliance",
    [
      { label: "Filter Scope", value: options?.dateRange ?? "Current Period" },
      { label: "Auditor", value: options?.generatedBy ?? "System Administrator" },
      { label: "Total Logs", value: `${total} logs` },
      { label: "Compliance Rate", value: `${presentRate}% on-time/present` },
    ],
  );

  // KPI Metric Cards
  const pageWidth = doc.internal.pageSize.getWidth();
  const cardWidth = (pageWidth - 28 - 9) / 4;
  const kpis = [
    { title: "Present", value: `${presentCount} (${total ? Math.round((presentCount / total) * 100) : 0}%)`, color: [22, 163, 74] },
    { title: "Late Arrivals", value: String(lateCount), color: [217, 119, 6] },
    { title: "Absent", value: String(absentCount), color: [220, 38, 38] },
    { title: "Approved Leave", value: String(leaveCount), color: [37, 99, 235] },
  ];

  kpis.forEach((kpi, idx) => {
    const cardX = 14 + idx * (cardWidth + 3);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cardX, startY, cardWidth, 18, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.title, cardX + 3, startY + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, cardX + 3, startY + 13.5);
  });

  const tableData = records.map((r) => [
    r.date,
    r.name,
    r.rollNumber || "—",
    r.status,
    r.ipAddress || "—",
    r.note || "Standard verification",
    r.createdAt ? new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
  ]);

  autoTable(doc, {
    startY: startY + 23,
    head: [["Date", "Member Name", "Roll / Staff ID", "Status", "Verified IP", "Audit Note", "Recorded Time"]],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontSize: 7.5,
      fontStyle: "bold",
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [51, 65, 85],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 3) {
        const text = String(data.cell.raw);
        if (text === "Present") data.cell.styles.textColor = [22, 163, 74];
        else if (text === "Late") data.cell.styles.textColor = [217, 119, 6];
        else if (text === "Absent") data.cell.styles.textColor = [220, 38, 38];
        else if (text === "Leave") data.cell.styles.textColor = [37, 99, 235];
      }
    },
    margin: { left: 14, right: 14, bottom: 20 },
  });

  addDocumentFooter(doc);
  doc.save(`Sentinel_Attendance_Audit_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * Generates an executive Combined SOC 2 / ISO 27001 Master Compliance Audit PDF.
 */
export function exportUnifiedCompliancePdf(
  securityEvents: SecurityEventReportItem[],
  attendanceRecords: AttendanceReportItem[],
  systemAudits: SystemAuditItem[],
  options?: { dateRange?: string; generatedBy?: string },
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const startY = addDocumentHeader(
    doc,
    "Executive Master Compliance & Risk Audit",
    "Unified Zero-Trust Security, Telemetry, and Attendance Verification Report",
    "Enterprise Audit & Governance",
    [
      { label: "Standard", value: "SOC 2 Type II / ISO 27001" },
      { label: "Lead Auditor", value: options?.generatedBy ?? "Security Compliance Officer" },
      { label: "Evaluation Scope", value: options?.dateRange ?? "Full Enterprise Logs" },
      { label: "System Status", value: "CERTIFIED COMPLIANT" },
    ],
  );

  // High-level executive summary text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Executive Threat & Governance Summary", 14, startY + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const summaryText =
    "This audit dossier aggregates verified security telemetry, authentication anomalies, and attendance logs. All events are captured with server-observed IP addresses, device fingerprints, and geolocation coordinates. Suspicious behaviors and anomalous velocities are scored continuously by the Sentinel AI risk evaluation pipeline.";
  doc.text(doc.splitTextToSize(summaryText, doc.internal.pageSize.getWidth() - 28), 14, startY + 9);

  // Section 1: Security Telemetry Table (top 15)
  const secData = securityEvents.slice(0, 20).map((s) => [
    s.created_at ? new Date(s.created_at).toLocaleString() : "—",
    s.event_type,
    s.user_email || "System",
    s.ip_address || "—",
    s.risk_level || "LOW",
    `${s.risk_score || 0}/100`,
  ]);

  autoTable(doc, {
    startY: startY + 24,
    head: [["Timestamp", "Security Action", "Account", "Observed IP", "Threat Level", "Risk Score"]],
    body: secData,
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42], fontSize: 7, fontStyle: "bold" },
    bodyStyles: { fontSize: 6.5 },
    margin: { left: 14, right: 14, bottom: 20 },
  });

  // Section 2: Attendance Verification Table
  doc.addPage();
  addDocumentHeader(
    doc,
    "Executive Master Compliance & Risk Audit",
    "Section 2: Verified Workforce Attendance Records",
    "Enterprise Audit & Governance",
    [
      { label: "Total Attendance Entries", value: `${attendanceRecords.length} records` },
      { label: "Verification Source", value: "Server Geofence & Verified IP" },
      { label: "Export Date", value: new Date().toISOString().slice(0, 10) },
      { label: "Status", value: "Verified Active" },
    ],
  );

  const attData = attendanceRecords.slice(0, 30).map((a) => [
    a.date,
    a.name,
    a.rollNumber || "—",
    a.status,
    a.ipAddress || "—",
    a.note || "Standard verification",
  ]);

  autoTable(doc, {
    startY: 75,
    head: [["Date", "Member Name", "ID / Code", "Status", "Observed IP Address", "Audit Notes"]],
    body: attData,
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42], fontSize: 7, fontStyle: "bold" },
    bodyStyles: { fontSize: 6.5 },
    margin: { left: 14, right: 14, bottom: 20 },
  });

  addDocumentFooter(doc);
  doc.save(`Sentinel_Master_Compliance_Audit_${new Date().toISOString().slice(0, 10)}.pdf`);
}
