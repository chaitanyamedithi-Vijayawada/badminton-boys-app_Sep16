import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "Badminton Boys <notifications@badmintonboys.org>";

interface SessionEmailPayload {
  type: "session";
  to: string;
  playerName: string;
  day: string;
  week: string;
  sessionDate: string;
  sessionTime: string;
  hoursPlayed: number;
  courtsCount: number;
  playersCount: number;
  perPerson: number;
  guestCount: number;
  totalDeducted: number;
  oldBalance: number;
  newBalance: number;
  allPlayers: string[];
}

interface TopUp {
  date: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string;
}

interface MonthlyEmailPayload {
  type: "monthly";
  to: string;
  playerName: string;
  month: string;
  sessionsAttended: number;
  totalDeducted: number;
  currentBalance: number;
  sessionDetails: { date: string; day: string; perPerson: number; guests: number }[];
  attendanceRate: number;
  topUps: TopUp[];
}

interface TopUpEmailPayload {
  type: "topup";
  to: string;
  playerName: string;
  amount: number;
  oldBalance: number;
  newBalance: number;
  confirmedBy: string;
  note?: string;
}

type EmailPayload = SessionEmailPayload | MonthlyEmailPayload | TopUpEmailPayload;

function balanceColor(balance: number): string {
  if (balance < 0) return "#ef4444";
  if (balance < 15) return "#f59e0b";
  return "#22c55e";
}

function sessionEmailHtml(p: SessionEmailPayload): string {
  const dayLabel = p.day.charAt(0).toUpperCase() + p.day.slice(1);
  const dateFormatted = new Date(p.sessionDate + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const weekFormatted = new Date(p.week + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const newBalColor = balanceColor(p.newBalance);
  const oldBalColor = balanceColor(p.oldBalance);

  const guestLine = p.guestCount > 0
    ? `<tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Guests brought</td><td style="padding:5px 0;color:#f1f5f9;font-size:13px;text-align:right;">${p.guestCount}</td></tr>`
    : "";
  const totalLine = p.guestCount > 0
    ? `<tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Total deducted</td><td style="padding:5px 0;color:#f87171;font-size:13px;font-weight:700;text-align:right;">−$${p.totalDeducted.toFixed(2)}</td></tr>`
    : "";

  const playerPills = p.allPlayers.map(n =>
    `<span style="display:inline-block;background:#1e3a5f;color:#7dd3fc;font-size:12px;padding:4px 12px;border-radius:20px;margin:3px 2px;border:1px solid #1e4a7a;">${n}</span>`
  ).join("");

  const lowBalWarning = p.newBalance < 15
  ? `<div style="margin-top:16px;background:#1c0a0a;border:1px solid #7f1d1d;border-radius:10px;padding:12px 14px;font-size:13px;color:#fca5a5;">⚠️ Your balance is low. Please send money via Interac e-Transfer to <strong>arun.gedela@gmail.com</strong> to top up.</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:500px;margin:0 auto;padding:24px 16px 48px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#064e3b 0%,#065f46 40%,#0f766e 100%);border-radius:20px 20px 0 0;padding:36px 24px 28px;text-align:center;border:1px solid #065f46;border-bottom:none;">
    <div style="font-size:44px;margin-bottom:12px;">🏸</div>
    <div style="font-size:26px;font-weight:800;color:#ecfdf5;letter-spacing:-0.5px;">Session Complete!</div>
    <div style="margin-top:10px;display:inline-block;background:rgba(0,0,0,0.25);border-radius:99px;padding:5px 16px;">
      <span style="font-size:13px;color:#6ee7b7;font-weight:600;">${dayLabel}</span>
      <span style="font-size:13px;color:#4b7c68;margin:0 6px;">·</span>
      <span style="font-size:13px;color:#6ee7b7;">${dateFormatted}</span>
    </div>
  </div>

  <!-- Body -->
  <div style="background:#0a1520;border:1px solid #1e3a5f;border-top:none;border-radius:0 0 20px 20px;padding:24px;">

    <!-- Greeting -->
    <div style="font-size:15px;color:#94a3b8;margin-bottom:22px;line-height:1.5;">
      Hey <strong style="color:#f1f5f9;">${p.playerName}</strong> 👋 — here's your recap for today's session.
    </div>

    <!-- Session info chips -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
      <div style="background:linear-gradient(135deg,#1e1b4b,#312e81);border:1px solid #4338ca;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">📅</div>
        <div style="font-size:10px;color:#a5b4fc;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Week</div>
        <div style="font-size:11px;color:#e0e7ff;font-weight:700;">${weekFormatted}</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a2e1a,#14532d);border:1px solid #16a34a;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">📆</div>
        <div style="font-size:10px;color:#86efac;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Day</div>
        <div style="font-size:11px;color:#dcfce7;font-weight:700;">${dayLabel}</div>
      </div>
      <div style="background:linear-gradient(135deg,#1c1917,#292524);border:1px solid #d97706;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">⏰</div>
        <div style="font-size:10px;color:#fcd34d;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Time</div>
        <div style="font-size:11px;color:#fef3c7;font-weight:700;">${p.sessionTime}</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a1a2e,#1e3a5f);border:1px solid #0284c7;border-radius:12px;padding:12px 8px;text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">⏱️</div>
        <div style="font-size:10px;color:#7dd3fc;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;">Hours</div>
        <div style="font-size:11px;color:#e0f2fe;font-weight:700;">${p.hoursPlayed} hrs</div>
      </div>
    </div>

    <!-- Session stats -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Session Stats</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Courts booked</td><td style="padding:5px 0;color:#f1f5f9;font-size:13px;text-align:right;font-weight:600;">${p.courtsCount} courts</td></tr>
        <tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Total players</td><td style="padding:5px 0;color:#f1f5f9;font-size:13px;text-align:right;font-weight:600;">${p.playersCount} players</td></tr>
        <tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Cost per person</td><td style="padding:5px 0;color:#38bdf8;font-size:13px;text-align:right;font-weight:700;">$${p.perPerson.toFixed(2)}</td></tr>
        ${guestLine}
        ${totalLine}
      </table>
    </div>

    <!-- Balance change -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:20px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">Your Balance</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;text-align:center;padding:0 6px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Before</div>
            <div style="font-size:24px;font-weight:800;color:${oldBalColor};">$${p.oldBalance.toFixed(2)}</div>
          </td>
          <td style="width:34%;text-align:center;padding:0 6px;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Deducted</div>
            <div style="font-size:24px;font-weight:800;color:#f87171;">−$${p.totalDeducted.toFixed(2)}</div>
          </td>
          <td style="width:33%;text-align:center;padding:0 6px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">After</div>
            <div style="font-size:24px;font-weight:800;color:${newBalColor};">$${p.newBalance.toFixed(2)}</div>
          </td>
        </tr>
      </table>
      ${lowBalWarning}
    </div>

    <!-- Who played -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:16px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Who Played (${p.allPlayers.length})</div>
      <div>${playerPills}</div>
    </div>

  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:20px 0 0;font-size:11px;color:#1e3a5f;">
    Badminton Boys · Surrey Badminton Club · You're receiving this because you played today.
  </div>
</div>
</body>
</html>`;
}

function topUpEmailHtml(p: TopUpEmailPayload): string {
  const newBalColor = balanceColor(p.newBalance);
  const oldBalColor = balanceColor(p.oldBalance);
  const noteLine = p.note
    ? `<tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Note</td><td style="padding:5px 0;color:#f1f5f9;font-size:13px;text-align:right;font-weight:600;">${p.note}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:500px;margin:0 auto;padding:24px 16px 48px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f3d2e 0%,#0e7c5c 50%,#10b981 100%);border-radius:20px 20px 0 0;padding:36px 24px 28px;text-align:center;border:1px solid #0e7c5c;border-bottom:none;">
    <div style="font-size:44px;margin-bottom:12px;">💸</div>
    <div style="font-size:26px;font-weight:800;color:#ecfdf5;letter-spacing:-0.5px;">Top-Up Confirmed!</div>
    <div style="margin-top:10px;display:inline-block;background:rgba(0,0,0,0.25);border-radius:99px;padding:5px 16px;">
      <span style="font-size:13px;color:#6ee7b7;font-weight:600;">+$${p.amount.toFixed(2)} added</span>
    </div>
  </div>

  <!-- Body -->
  <div style="background:#0a1520;border:1px solid #1e3a5f;border-top:none;border-radius:0 0 20px 20px;padding:24px;">

    <div style="font-size:15px;color:#94a3b8;margin-bottom:22px;line-height:1.5;">
      Hey <strong style="color:#f1f5f9;">${p.playerName}</strong> 👋 — your payment has been confirmed by <strong style="color:#f1f5f9;">${p.confirmedBy}</strong>. Your balance has been updated.
    </div>

    <!-- Top-up info -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Transaction Details</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Amount received</td><td style="padding:5px 0;color:#4ade80;font-size:13px;text-align:right;font-weight:700;">+$${p.amount.toFixed(2)}</td></tr>
        <tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">Confirmed by</td><td style="padding:5px 0;color:#f1f5f9;font-size:13px;text-align:right;font-weight:600;">${p.confirmedBy}</td></tr>
        ${noteLine}
      </table>
    </div>

    <!-- Balance change -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:20px;margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;">Your Balance</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;text-align:center;padding:0 6px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Before</div>
            <div style="font-size:24px;font-weight:800;color:${oldBalColor};">$${p.oldBalance.toFixed(2)}</div>
          </td>
          <td style="width:34%;text-align:center;padding:0 6px;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Added</div>
            <div style="font-size:24px;font-weight:800;color:#4ade80;">+$${p.amount.toFixed(2)}</div>
          </td>
          <td style="width:33%;text-align:center;padding:0 6px;">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">After</div>
            <div style="font-size:24px;font-weight:800;color:${newBalColor};">$${p.newBalance.toFixed(2)}</div>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <div style="text-align:center;padding:20px 12px;color:#334155;font-size:11px;line-height:1.6;">
    Badminton Boys · Surrey Badminton Club · You're receiving this because a payment was confirmed for you.
  </div>
</div>
</body>
</html>`;
}

function monthlyEmailHtml(p: MonthlyEmailPayload): string {
  const balColor = balanceColor(p.currentBalance);
  const sessionRows = p.sessionDetails.map(s => {
    const dateStr = new Date(s.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const dayLabel = s.day === "saturday" ? "Sat" : "Tue";
    const guestNote = s.guests > 0 ? ` <span style="color:#f59e0b;font-size:11px;">(+${s.guests} guest)</span>` : "";
    const charged = s.perPerson * (1 + s.guests);
    return `<tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:13px;border-bottom:1px solid #1e293b;">${dateStr} <span style="color:#475569;">${dayLabel}</span>${guestNote}</td>
      <td style="padding:8px 0;color:#f87171;font-size:13px;text-align:right;font-weight:600;border-bottom:1px solid #1e293b;">−$${charged.toFixed(2)}</td>
    </tr>`;
  }).join("");

  const attendanceBar = Math.round(p.attendanceRate);
  const barColor = attendanceBar >= 70 ? "#22c55e" : attendanceBar >= 40 ? "#f59e0b" : "#ef4444";

  const topUpRows = p.topUps.map(t => {
    const dateStr = new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const beforeColor = balanceColor(t.balanceBefore);
    const afterColor = balanceColor(t.balanceAfter);
    return `<div style="background:#060d14;border:1px solid #166534;border-radius:10px;padding:14px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:12px;color:#4ade80;font-weight:700;">💰 Top-up Received</span>
        <span style="font-size:11px;color:#475569;">${dateStr}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:33%;text-align:center;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Before</div>
            <div style="font-size:18px;font-weight:800;color:${beforeColor};">$${t.balanceBefore.toFixed(2)}</div>
          </td>
          <td style="width:34%;text-align:center;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">Added</div>
            <div style="font-size:18px;font-weight:800;color:#4ade80;">+$${t.amount.toFixed(2)}</div>
          </td>
          <td style="width:33%;text-align:center;">
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:5px;">After</div>
            <div style="font-size:18px;font-weight:800;color:${afterColor};">$${t.balanceAfter.toFixed(2)}</div>
          </td>
        </tr>
      </table>
      ${t.note ? `<div style="margin-top:8px;font-size:11px;color:#475569;">${t.note}</div>` : ""}
    </div>`;
  }).join("");

  const topUpSection = p.topUps.length > 0
    ? `<div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Top-ups This Month</div>
        ${topUpRows}
      </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060d14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:500px;margin:0 auto;padding:24px 16px 48px;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#1e3a5f 100%);border-radius:20px 20px 0 0;padding:36px 24px 28px;text-align:center;border:1px solid #4338ca;border-bottom:none;">
    <div style="font-size:44px;margin-bottom:12px;">📊</div>
    <div style="font-size:26px;font-weight:800;color:#eef2ff;letter-spacing:-0.5px;">${p.month} Summary</div>
    <div style="margin-top:8px;font-size:13px;color:#818cf8;">Your monthly badminton stats</div>
  </div>

  <!-- Body -->
  <div style="background:#0a1520;border:1px solid #1e3a5f;border-top:none;border-radius:0 0 20px 20px;padding:24px;">

    <div style="font-size:15px;color:#94a3b8;margin-bottom:22px;line-height:1.5;">
      Hey <strong style="color:#f1f5f9;">${p.playerName}</strong> 👋 — here's your ${p.month} recap.
    </div>

    <!-- Top stats -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px;">
      <div style="background:linear-gradient(135deg,#1a2e1a,#14532d);border:1px solid #16a34a;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:#4ade80;">${p.sessionsAttended}</div>
        <div style="font-size:11px;color:#16a34a;margin-top:4px;font-weight:600;">Sessions</div>
      </div>
      <div style="background:linear-gradient(135deg,#1c0a0a,#450a0a);border:1px solid #b91c1c;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:#f87171;">$${p.totalDeducted.toFixed(2)}</div>
        <div style="font-size:11px;color:#b91c1c;margin-top:4px;font-weight:600;">Spent</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a1a2e,#1e3a5f);border:1px solid #0284c7;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:${balColor};">$${p.currentBalance.toFixed(2)}</div>
        <div style="font-size:11px;color:#0284c7;margin-top:4px;font-weight:600;">Balance</div>
      </div>
    </div>

    <!-- Attendance -->
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:16px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;">Attendance</div>
        <div style="font-size:14px;font-weight:800;color:${barColor};">${attendanceBar}%</div>
      </div>
      <div style="background:#1e293b;border-radius:99px;height:10px;overflow:hidden;">
        <div style="width:${attendanceBar}%;height:100%;background:linear-gradient(90deg,${barColor}88,${barColor});border-radius:99px;"></div>
      </div>
    </div>

    <!-- Top-ups -->
    ${topUpSection}

    <!-- Session breakdown -->
    ${p.sessionDetails.length > 0 ? `
    <div style="background:#060d14;border:1px solid #1e3a5f;border-radius:14px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Session Breakdown</div>
      <table style="width:100%;border-collapse:collapse;">
        ${sessionRows}
        <tr>
          <td style="padding:10px 0 0;color:#f1f5f9;font-size:13px;font-weight:700;">Total spent</td>
          <td style="padding:10px 0 0;color:#f87171;font-size:14px;font-weight:800;text-align:right;">−$${p.totalDeducted.toFixed(2)}</td>
        </tr>
      </table>
    </div>` : `<div style="text-align:center;color:#334155;font-size:13px;padding:20px;">No sessions attended this month.</div>`}

    ${p.currentBalance < 15 ? `
    <div style="background:#1c0a0a;border:1px solid #7f1d1d;border-radius:12px;padding:14px 16px;font-size:13px;color:#fca5a5;">
    ⚠️ Your balance is low ($${p.currentBalance.toFixed(2)}). Please send money via Interac e-Transfer to <strong>arun.gedela@gmail.com</strong> before the next session.
    </div>` : ""}
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:20px 0 0;font-size:11px;color:#1e3a5f;">
    Badminton Boys · Monthly summary · Sent on the 1st of each month.
  </div>
</div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Fail loudly if the Resend key was never configured. Previously this was
  // unchecked, so a missing key produced a silent "success" and no email ever
  // arrived — the single most common cause of "emails not working".
  if (!RESEND_API_KEY) {
    console.error("send-email: RESEND_API_KEY is not set");
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured in Supabase secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const payload: EmailPayload = await req.json();

    if (!payload?.to) {
      return new Response(JSON.stringify({ error: "Missing 'to' address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject = "";
    let html = "";

    if (payload.type === "session") {
      const dayLabel = payload.day.charAt(0).toUpperCase() + payload.day.slice(1);
      subject = `🏸 ${dayLabel} session done — ${payload.totalDeducted.toFixed(2)} deducted · Balance: ${payload.newBalance.toFixed(2)}`;
      html = sessionEmailHtml(payload);
    } else if (payload.type === "monthly") {
      subject = `📊 Your ${payload.month} Badminton Summary`;
      html = monthlyEmailHtml(payload);
    } else if (payload.type === "topup") {
      subject = `💸 Top-up confirmed — +$${payload.amount.toFixed(2)} · Balance: $${payload.newBalance.toFixed(2)}`;
      html = topUpEmailHtml(payload);
    } else {
      return new Response(JSON.stringify({ error: "Unknown email type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Await Resend and surface the real result. A single edge invocation sends
    // exactly one email, so awaiting here is fast and cannot be "EarlyDrop"
    // cancelled — once the function is running it completes server-side
    // regardless of whether the caller's device navigates away.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [payload.to], subject, html }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Resend rejected the send. The message names the exact cause, e.g.
      // "The badmintonboys.org domain is not verified" or a to-address
      // restriction while the account is in test mode.
      console.error("Resend error:", res.status, data);
      return new Response(
        JSON.stringify({ error: "Resend rejected the email", status: res.status, detail: data }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("Resend sent:", data?.id, "->", payload.to);
    return new Response(JSON.stringify({ success: true, id: data?.id ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});