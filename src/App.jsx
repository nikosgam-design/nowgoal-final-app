
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Save, ClipboardPaste, Trash2, BarChart3, BellRing, Search, Cloud, Send, RefreshCw, Smartphone } from "lucide-react";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from "firebase/firestore";

const STORAGE_KEY = "nowgoal_saved_predictions_v4";
const SETTINGS_KEY = "nowgoal_web_settings_v4";

const DEMO_LIVE_MATCHES = [
  { id: "live-1", sport: "football", league: "Super League", matchDate: "20-04-2026", matchTime: "19:30", home: "Fenerbahce", away: "Besiktas", raw: `Super League 20-04-2026 3-2 1-1 7-5
Fenerbahce
VS
Besiktas
74' 1-1 live football premier league win draw lose` },
  { id: "live-2", sport: "football", league: "Premier League", matchDate: "20-04-2026", matchTime: "21:00", home: "Brighton", away: "Newcastle", raw: `Premier League 20-04-2026 2-1 1-0 6-4
Brighton
VS
Newcastle
68' 1-0 live football win draw lose` },
  { id: "live-3", sport: "basketball", league: "NBA", matchDate: "20-04-2026", matchTime: "03:00", home: "Lakers", away: "Suns", raw: `NBA 20-04-2026 118-114 58-55 basketball nba win rate` },
];

const defaultSettings = {
  telegramBotToken: "",
  telegramChatId: "",
  firebaseApiKey: "",
  firebaseAuthDomain: "",
  firebaseProjectId: "",
  firebaseStorageBucket: "",
  firebaseMessagingSenderId: "",
  firebaseAppId: "",
};

const defaultThresholds = { o25: 68, btts: 65, ht05: 74, dc: 78, corn: 70, bkWin: 64, bkTot: 66 };

const CUP_KEYWORDS = ["CUP","COPA","COUPE","POKAL","BEKER","FA CUP","LEAGUE CUP","CHAMPIONS","EUROPA","CONFERENCE","SUPER CUP","WORLD CUP","PLAYOFF","PLAY-OFF","FRIENDLY","INT CF","ACL","FIBA"];

const styles = {
  app: { minHeight: "100vh", background: "#020617", color: "#e5e7eb", padding: 16 },
  container: { maxWidth: 1380, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  card: { background: "rgba(15,23,42,0.88)", border: "1px solid #1f2937", borderRadius: 24, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" },
  sectionTitle: { fontSize: 14, letterSpacing: 1, textTransform: "uppercase", color: "#94a3b8", fontWeight: 700, marginBottom: 12 },
  buttonBase: { border: "none", borderRadius: 16, padding: "12px 16px", color: "white", cursor: "pointer", fontWeight: 700 },
  input: { width: "100%", borderRadius: 16, border: "1px solid #334155", background: "#020617", color: "#e5e7eb", padding: "12px 14px", outline: "none" },
  textarea: { width: "100%", minHeight: 220, borderRadius: 16, border: "1px solid #334155", background: "#020617", color: "#e5e7eb", padding: "12px 14px", outline: "none", resize: "vertical" },
};

function safePct(count, total) { return total ? Math.round((count / total) * 100) : 0; }
function isCup(league = "") { const s = league.trim().toUpperCase(); return CUP_KEYWORDS.some((kw) => s.includes(kw)); }
function detectSport(raw) {
  const low = raw.toLowerCase();
  const basketHits = ["basketball", "nba", "euroleague", "fiba", "win rate", "q1 q2 q3"].filter((x) => low.includes(x)).length;
  const footballHits = ["football", "serie a", "la liga", "premier league", "win draw lose", "pts rank rate"].filter((x) => low.includes(x)).length;
  return basketHits > footballHits ? "basketball" : "football";
}
function guessTeams(raw) {
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) if (lines[i].toUpperCase() === "VS" && i > 0 && i < lines.length - 1) return [lines[i - 1], lines[i + 1]];
  const m = raw.match(/([A-Za-z0-9 .&\-()]{3,60})\s+vs\s+([A-Za-z0-9 .&\-()]{3,60})/i);
  if (m) return [m[1].trim(), m[2].trim()];
  return ["Home", "Away"];
}
function guessLeague(raw) {
  for (const pat of ["Serie A", "Premier League", "La Liga", "Bundesliga", "Ligue 1", "Euroleague", "NBA", "Basketball Bundesliga"]) if (raw.toLowerCase().includes(pat.toLowerCase())) return pat;
  const m = raw.match(/([A-Za-z ]+League|Serie A|Bundesliga|Ligue 1|La Liga)/i);
  return m ? m[1].trim() : "";
}
function guessMatchDateTime(raw) {
  const both = raw.match(/(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2})/);
  if (both) return { matchDate: both[1], matchTime: both[2] };
  const onlyDate = raw.match(/(\d{2}-\d{2}-\d{4})/);
  if (onlyDate) return { matchDate: onlyDate[1], matchTime: "--:--" };
  return { matchDate: "", matchTime: "--:--" };
}
function parseMatchRows(raw, sport) {
  const rows = [];
  const lines = raw.split(/\r?\n/).map((x) => x.trim());
  for (const line of lines) {
    if (!line || line.length < 12) continue;
    const dm = line.match(/(\d{2}-\d{2}-\d{4})/);
    if (!dm || dm.index == null) continue;
    const league = line.slice(0, dm.index).trim();
    if (!league || isCup(league)) continue;
    const after = line.slice(dm.index + dm[1].length);
    const scorePairs = [...after.matchAll(/(\d+)-(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (sport === "football") {
      const valid = scorePairs.filter(([a, b]) => a <= 20 && b <= 20);
      if (valid.length < 2) continue;
      const [hg, ag] = valid[0];
      const [h1, a1] = valid[1];
      const cornerPairs = scorePairs.filter(([a, b]) => a <= 25 && b <= 25);
      let hc = null, ac = null;
      if (cornerPairs.length >= 3) { hc = cornerPairs[2][0]; ac = cornerPairs[2][1]; }
      rows.push({ league, home_g: hg, away_g: ag, home_1h: h1, away_1h: a1, total_g: hg + ag, total_1h: h1 + a1, btts: hg > 0 && ag > 0, total_c: hc != null && ac != null ? hc + ac : null });
    } else {
      const valid = scorePairs.filter(([a, b]) => a >= 20 && a <= 200 && b >= 20 && b <= 200);
      if (valid.length < 2) continue;
      const [hg, ag] = valid[0];
      const [h1, a1] = valid[1];
      if (h1 >= hg || a1 >= ag) continue;
      rows.push({ league, home_g: hg, away_g: ag, home_1h: h1, away_1h: a1, total_g: hg + ag, total_1h: h1 + a1 });
    }
  }
  return rows;
}
function footballStats(rows) {
  const sample = rows.slice(0, 6);
  if (sample.length < 2) return null;
  const total = sample.length;
  const totals = sample.map((r) => r.total_g);
  const firstHalf = sample.map((r) => r.total_1h);
  const btts = safePct(sample.filter((r) => r.btts).length, total);
  const o25 = safePct(totals.filter((x) => x > 2.5).length, total);
  const ht05 = safePct(firstHalf.filter((x) => x > 0.5).length, total);
  const home = safePct(sample.filter((r) => r.home_g > r.away_g).length, total);
  const draw = safePct(sample.filter((r) => r.home_g === r.away_g).length, total);
  const away = 100 - home - draw;
  const corners = sample.map((r) => r.total_c).filter((x) => x != null);
  let cstats = null;
  if (corners.length) cstats = { avg: Number((corners.reduce((a, b) => a + b, 0) / corners.length).toFixed(1)), o85: safePct(corners.filter((x) => x > 8.5).length, corners.length), o95: safePct(corners.filter((x) => x > 9.5).length, corners.length), o105: safePct(corners.filter((x) => x > 10.5).length, corners.length) };
  return { sample: total, btts, o25, ht05, home, draw, away, corners: cstats, avg_goals: Number((totals.reduce((a, b) => a + b, 0) / total).toFixed(2)), avg_1h: Number((firstHalf.reduce((a, b) => a + b, 0) / total).toFixed(2)) };
}
function basketballStats(rows) {
  const sample = rows.slice(0, 6);
  if (sample.length < 2) return null;
  const total = sample.length;
  const totals = sample.map((r) => r.total_g);
  const firstHalf = sample.map((r) => r.total_1h);
  const home = safePct(sample.filter((r) => r.home_g > r.away_g).length, total);
  const away = 100 - home;
  return { sample: total, home, away, avg_total: Number((totals.reduce((a, b) => a + b, 0) / total).toFixed(1)), avg_1h: Number((firstHalf.reduce((a, b) => a + b, 0) / total).toFixed(1)) };
}
function parseLiveState(raw, sport) {
  if (sport !== "football") return null;
  const up = raw.toUpperCase();
  let score = up.match(/\b(\d)-(\d)\b/) || up.match(/\b(\d{1,2})\s*:\s*(\d{1,2})\b/);
  let minute = null;
  for (const pat of [/\b(\d{1,3})['’]/, /\b(\d{1,3})\s*MIN\b/, /\bMINUTE\s+(\d{1,3})\b/, /\bLIVE\s+(\d{1,3})\b/]) {
    const m = up.match(pat); if (m) { minute = Number(m[1]); break; }
  }
  if (!score) return { minute, home: null, away: null };
  return { minute, home: Number(score[1]), away: Number(score[2]) };
}
function basketTotalSignal(avgTotal) {
  if (avgTotal >= 225) return `OVER ${(Math.round(avgTotal * 2) / 2).toFixed(1)}`;
  if (avgTotal <= 210) return `UNDER ${(Math.round(avgTotal * 2) / 2).toFixed(1)}`;
  return `NO BET ${(Math.round(avgTotal * 2) / 2).toFixed(1)}`;
}
function edgeLabel(v) { if (v >= 80) return "💎 ELITE"; if (v >= 70) return "🔥 STRONG"; if (v >= 60) return "👀 WATCHLIST"; return "📌 LEAN"; }
function edgeClass(v) {
  if (v >= 80) return { color: "#67e8f9", border: "1px solid rgba(34,211,238,0.35)", background: "rgba(34,211,238,0.10)" };
  if (v >= 70) return { color: "#86efac", border: "1px solid rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.10)" };
  if (v >= 60) return { color: "#fcd34d", border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.10)" };
  return { color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.25)", background: "rgba(148,163,184,0.06)" };
}
function buildItemsFromData(data, thresholds) {
  const { sport, home, away, stats: s } = data;
  const match = `${home} vs ${away}`;
  const items = [];
  if (sport === "football") {
    if (s.ht05 >= thresholds.ht05) items.push({ match, signal: "1ST HALF OVER 0.5", edge: s.ht05, sport });
    if (s.o25 >= thresholds.o25) items.push({ match, signal: "OVER 2.5", edge: s.o25, sport });
    if (s.btts >= thresholds.btts) items.push({ match, signal: "BTTS YES", edge: s.btts, sport });
    if (Math.max(s.home, s.draw, s.away) >= thresholds.dc) {
      if (s.home >= s.away) items.push({ match, signal: "1X DOUBLE CHANCE", edge: Math.max(s.home, s.draw), sport });
      else items.push({ match, signal: "X2 DOUBLE CHANCE", edge: Math.max(s.away, s.draw), sport });
    }
    if (s.corners) {
      if (s.corners.o85 >= thresholds.corn) items.push({ match, signal: "CORNERS OVER 8.5", edge: s.corners.o85, sport });
      if (s.corners.o95 >= thresholds.corn) items.push({ match, signal: "CORNERS OVER 9.5", edge: s.corners.o95, sport });
      if (s.corners.o105 >= thresholds.corn) items.push({ match, signal: "CORNERS OVER 10.5", edge: s.corners.o105, sport });
    }
    if (s.o25 >= thresholds.o25 && s.btts >= thresholds.btts) items.push({ match, signal: "COMBO GOALS: O2.5 + BTTS", edge: Math.round((s.o25 + s.btts) / 2), sport });
    if (s.ht05 >= thresholds.ht05 && s.o25 >= thresholds.o25) items.push({ match, signal: "COMBO FAST START: HT0.5 + O2.5", edge: Math.round((s.ht05 + s.o25) / 2), sport });
  } else {
    if (s.home >= thresholds.bkWin) items.push({ match, signal: `${home} TO WIN`, edge: s.home, sport });
    if (s.away >= thresholds.bkWin) items.push({ match, signal: `${away} TO WIN`, edge: s.away, sport });
    const totEdge = Math.min(90, Math.max(55, Math.floor(s.avg_total / 3)));
    const totalSig = basketTotalSignal(s.avg_total);
    if (totEdge >= thresholds.bkTot && !totalSig.startsWith("NO BET")) items.push({ match, signal: totalSig, edge: totEdge, sport });
  }
  return items.sort((a, b) => b.edge - a.edge);
}
function mergeItemsByMatch(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.match)) grouped.set(item.match, { match: item.match, sport: item.sport, signals: [], edge: item.edge });
    const entry = grouped.get(item.match);
    entry.signals.push([item.signal, item.edge]);
    entry.edge = Math.max(entry.edge, item.edge);
  }
  return [...grouped.values()].map((g) => ({
    match: g.match,
    sport: g.sport,
    edge: g.edge,
    signal: g.signals.sort((a, b) => b[1] - a[1]).map(([sig, ed]) => `${sig} (${ed}%)`).join(" | "),
  })).sort((a, b) => b.edge - a.edge);
}
function buildValueAngles(data) {
  const { sport, stats: s } = data;
  const angles = [];
  if (sport === "football") {
    if (s.ht05 >= 78 && s.o25 >= 68) angles.push(["FAST START VALUE", Math.round((s.ht05 + s.o25) / 2)]);
    if (s.btts >= 67 && s.o25 >= 67) angles.push(["GOALS CORRELATION VALUE", Math.round((s.btts + s.o25) / 2)]);
    if (s.home >= 50 && s.draw >= 20) angles.push(["HOME SAFETY VALUE (1X)", Math.max(s.home, s.draw)]);
    if (s.corners && s.corners.o95 >= 72) angles.push(["CORNERS VALUE O9.5", s.corners.o95]);
  } else {
    if (s.home >= 64 && s.avg_total >= 225) angles.push(["HOME + OVER VALUE", Math.round((s.home + Math.min(90, Math.floor(s.avg_total / 3))) / 2)]);
    if (s.away >= 64 && s.avg_total >= 225) angles.push(["AWAY + OVER VALUE", Math.round((s.away + Math.min(90, Math.floor(s.avg_total / 3))) / 2)]);
    if (s.home >= 64 && s.avg_total <= 210) angles.push(["HOME + UNDER VALUE", Math.round((s.home + Math.min(90, Math.floor(s.avg_total / 3))) / 2)]);
    if (s.away >= 64 && s.avg_total <= 210) angles.push(["AWAY + UNDER VALUE", Math.round((s.away + Math.min(90, Math.floor(s.avg_total / 3))) / 2)]);
  }
  return angles.sort((a, b) => b[1] - a[1]);
}
function buildLiveSignals(data, thresholds) {
  const state = parseLiveState(data.raw, data.sport);
  if (!state || data.sport !== "football") return [];
  const { minute, home, away } = state;
  const s = data.stats;
  const out = [];
  if (minute == null || home == null || away == null) return out;
  if (minute <= 35 && home + away === 0 && s.ht05 >= thresholds.ht05) out.push(["LIVE HT0.5", s.ht05, `${minute}' | ${home}-${away}`]);
  if (minute >= 65 && minute <= 80 && ((home === 1 && away === 0) || (home === 0 && away === 1)) && s.o25 >= thresholds.o25) out.push(["LIVE O1.5 / O2.5 PUSH", Math.max(s.o25, 60), `${minute}' | ${home}-${away}`]);
  if (minute >= 70 && home + away <= 1 && s.btts >= thresholds.btts) out.push(["LATE GOAL SIGNAL", Math.max(s.btts, s.o25), `${minute}' | ${home}-${away}`]);
  if (minute >= 70 && home === 1 && away === 1 && s.o25 >= thresholds.o25) out.push(["LIVE O2.5", s.o25, `${minute}' | ${home}-${away}`]);
  return out;
}
function getFirebaseDb(settings) {
  if (!settings.firebaseApiKey || !settings.firebaseProjectId || !settings.firebaseAppId) return null;
  const config = { apiKey: settings.firebaseApiKey, authDomain: settings.firebaseAuthDomain, projectId: settings.firebaseProjectId, storageBucket: settings.firebaseStorageBucket, messagingSenderId: settings.firebaseMessagingSenderId, appId: settings.firebaseAppId };
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  return getFirestore(app);
}
async function sendTelegramAlert(settings, message) {
  if (!settings.telegramBotToken || !settings.telegramChatId) return { ok: false, reason: "Telegram not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: settings.telegramChatId, text: message }) });
    return { ok: res.ok };
  } catch { return { ok: false, reason: "Telegram request failed" }; }
}
function loadSavedLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveSavedLocal(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
function loadSettingsLocal() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { return defaultSettings; }
}
function saveSettingsLocal(settings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function formatNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function Panel({ title, children, right }) {
  return <div style={{ ...styles.card, padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><div style={styles.sectionTitle}>{title}</div>{right}</div>{children}</div>;
}
function ActionButton({ color, children, icon, onClick }) {
  return <button onClick={onClick} style={{ ...styles.buttonBase, background: color, display: "inline-flex", alignItems: "center", gap: 8 }}>{icon}{children}</button>;
}
function InputField(props) { return <input {...props} style={styles.input} />; }
function TextAreaField(props) { return <textarea {...props} style={styles.textarea} />; }

export default function App() {
  const [mode, setMode] = useState("analyzer");
  const [rawInput, setRawInput] = useState("");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState([]);
  const [analyzed, setAnalyzed] = useState(null);
  const [liveMatches, setLiveMatches] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local save only");
  const [telegramStatus, setTelegramStatus] = useState("Telegram not configured");
  const [settings, setSettings] = useState(defaultSettings);
  const [thresholds] = useState(defaultThresholds);

  useEffect(() => {
    setSaved(loadSavedLocal());
    const s = loadSettingsLocal();
    setSettings(s);
    setSyncStatus(s.firebaseProjectId ? "Firebase ready" : "Local save only");
    setTelegramStatus(s.telegramBotToken && s.telegramChatId ? "Telegram ready" : "Telegram not configured");
  }, []);

  const filteredSaved = useMemo(() => {
    if (!search.trim()) return saved;
    const q = search.toLowerCase();
    return saved.filter((x) => `${x.match} ${x.league} ${x.bestBet} ${x.signals}`.toLowerCase().includes(q));
  }, [saved, search]);

  function updateSettingsField(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettingsLocal(next);
    setSyncStatus(next.firebaseProjectId ? "Firebase ready" : "Local save only");
    setTelegramStatus(next.telegramBotToken && next.telegramChatId ? "Telegram ready" : "Telegram not configured");
  }

  async function loadCloudSaved() {
    const db = getFirebaseDb(settings);
    if (!db) { setSyncStatus("Firebase config missing"); return; }
    try {
      const snap = await getDocs(collection(db, "nowgoal_saved_predictions"));
      const items = snap.docs.map((d) => d.data());
      setSaved(items);
      saveSavedLocal(items);
      setSyncStatus("Loaded from Firebase");
    } catch { setSyncStatus("Firebase load failed"); }
  }

  async function saveSavedWithSync(items) {
    setSaved(items);
    saveSavedLocal(items);
    const db = getFirebaseDb(settings);
    if (!db) { setSyncStatus("Saved locally on this device"); return; }
    try {
      for (const item of items) {
        const id = `${item.match}__${item.matchDate}__${item.matchTime}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        await setDoc(doc(db, "nowgoal_saved_predictions", id), item);
      }
      setSyncStatus("Synced to Firebase");
    } catch { setSyncStatus("Firebase sync failed"); }
  }

  function analyzeText(text) {
    const raw = text.trim();
    if (!raw) return;
    const sport = detectSport(raw);
    const rows = parseMatchRows(raw, sport);
    const [home, away] = guessTeams(raw);
    const league = guessLeague(raw);
    const { matchDate, matchTime } = guessMatchDateTime(raw);
    const stats = sport === "football" ? footballStats(rows) : basketballStats(rows);
    if (!stats) { alert("Not enough data found."); return; }
    const base = { sport, raw, home, away, league, matchDate, matchTime, stats };
    const items = buildItemsFromData(base, thresholds);
    const merged = mergeItemsByMatch(items);
    const best = merged[0] || null;
    const valueAngles = buildValueAngles(base);
    const liveSignals = buildLiveSignals(base, thresholds);
    setAnalyzed({ ...base, items, merged, best, valueAngles, liveSignals });
  }

  async function pasteAndAnalyze() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setRawInput(text);
        analyzeText(text);
        return;
      }
    } catch {}
    const fallback = window.prompt("Paste the match text here:");
    if (fallback && fallback.trim()) {
      setRawInput(fallback);
      analyzeText(fallback);
    }
  }

  function buildRecordFromAnalyzed(item) {
    return {
      match: `${item.home} vs ${item.away}`,
      league: item.league,
      matchDate: item.matchDate,
      matchTime: item.matchTime,
      savedAt: formatNow(),
      bestBet: item.best?.signal || "",
      topEdge: item.best ? `${item.best.edge}%` : "",
      signals: item.merged.map((m) => m.signal).join("\n"),
      valueLogic: item.valueAngles.map(([n, e]) => `${n} | EDGE ${e}%`).join("\n") || "No clear value angle.",
      liveSignals: item.liveSignals.map(([n, e, c]) => `${n} | ${c} | EDGE ${e}%`).join("\n") || "No live signal right now.",
      sport: item.sport,
    };
  }

  async function saveCurrent() {
    if (!analyzed || !analyzed.best) return;
    const record = buildRecordFromAnalyzed(analyzed);
    const next = [...saved];
    const idx = next.findIndex((x) => x.match === record.match && x.matchDate === record.matchDate && x.matchTime === record.matchTime);
    if (idx >= 0) next[idx] = record; else next.unshift(record);
    await saveSavedWithSync(next);
  }

  async function sendCurrentTelegram() {
    if (!analyzed?.best) return;
    const msg = [
      edgeLabel(analyzed.best.edge),
      `${analyzed.home} vs ${analyzed.away}`,
      `DATE: ${analyzed.matchDate} ${analyzed.matchTime}`,
      `BEST BET: ${analyzed.best.signal}`,
      `TOP EDGE: ${analyzed.best.edge}%`,
      analyzed.valueAngles[0] ? `VALUE: ${analyzed.valueAngles[0][0]} (${analyzed.valueAngles[0][1]}%)` : null,
      analyzed.liveSignals[0] ? `LIVE: ${analyzed.liveSignals[0][0]} | ${analyzed.liveSignals[0][2]}` : null,
    ].filter(Boolean).join("\n");
    const result = await sendTelegramAlert(settings, msg);
    setTelegramStatus(result.ok ? "Telegram sent" : (result.reason || "Telegram failed"));
  }

  async function clearAll() {
    const db = getFirebaseDb(settings);
    if (db) {
      try {
        for (const item of saved) {
          const id = `${item.match}__${item.matchDate}__${item.matchTime}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          await deleteDoc(doc(db, "nowgoal_saved_predictions", id));
        }
      } catch { setSyncStatus("Firebase clear failed"); }
    }
    setSaved([]);
    saveSavedLocal([]);
  }

  function runLiveScan() {
    setLiveLoading(true);
    setTimeout(() => {
      const analyzedLive = DEMO_LIVE_MATCHES.map((m) => {
        const sport = detectSport(m.raw);
        const rows = parseMatchRows(m.raw, sport);
        const stats = sport === "football" ? footballStats(rows) : basketballStats(rows);
        if (!stats) return null;
        const base = { ...m, sport, stats, raw: m.raw };
        const items = buildItemsFromData(base, thresholds);
        const merged = mergeItemsByMatch(items);
        const best = merged[0] || null;
        const valueAngles = buildValueAngles(base);
        const liveSignals = buildLiveSignals(base, thresholds);
        return { ...base, items, merged, best, valueAngles, liveSignals };
      }).filter(Boolean);
      setLiveMatches(analyzedLive);
      setLiveLoading(false);
    }, 700);
  }

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ ...styles.card, padding: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <div style={{ minWidth: 280, flex: 1 }}>
              <div style={{ fontSize: 34, fontWeight: 800, color: "#38bdf8" }}>Nowgoal Ultimate Final Fixed 2</div>
              <div style={{ color: "#94a3b8", marginTop: 8 }}>Analyzer, Live Auto, Telegram alerts, cloud save, mobile-ready layout, paste fallback fix, and deploy-ready placeholders.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
                <div style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid #334155", background: "#020617", display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1" }}>
                  <Cloud size={16} color="#38bdf8" /> {syncStatus}
                </div>
                <div style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid #334155", background: "#020617", display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1" }}>
                  <Send size={16} color="#34d399" /> {telegramStatus}
                </div>
                <div style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid #334155", background: "#020617", display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1" }}>
                  <Smartphone size={16} color="#a78bfa" /> {saved.length} saved matches
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <ActionButton color={mode === "analyzer" ? "#2563eb" : "#334155"} onClick={() => setMode("analyzer")}>Analyzer</ActionButton>
              <ActionButton color={mode === "live" ? "#7c3aed" : "#334155"} onClick={() => setMode("live")}>Live Auto</ActionButton>
              <ActionButton color="#16a34a" icon={<BarChart3 size={16} />} onClick={() => analyzeText(rawInput)}>LOAD DATA</ActionButton>
              <ActionButton color="#0f766e" icon={<ClipboardPaste size={16} />} onClick={pasteAndAnalyze}>PASTE + ANALYZE</ActionButton>
              <ActionButton color="#dc2626" icon={<Trash2 size={16} />} onClick={() => { setRawInput(""); setAnalyzed(null); }}>CLEAR DATA</ActionButton>
              <ActionButton color="#d97706" icon={<Save size={16} />} onClick={saveCurrent}>SAVE</ActionButton>
              <ActionButton color="#7c3aed" icon={<BellRing size={16} />} onClick={runLiveScan}>{liveLoading ? "Scanning..." : "LIVE SCAN"}</ActionButton>
              <ActionButton color="#0284c7" icon={<RefreshCw size={16} />} onClick={loadCloudSaved}>LOAD CLOUD</ActionButton>
            </div>
          </div>
        </motion.div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(320px,380px) minmax(0,1fr)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel title="Cloud Save + Telegram Settings">
              <div style={{ display: "grid", gap: 10 }}>
                <InputField value={settings.telegramBotToken} onChange={(e) => updateSettingsField("telegramBotToken", e.target.value)} placeholder="Telegram Bot Token (placeholder)" />
                <InputField value={settings.telegramChatId} onChange={(e) => updateSettingsField("telegramChatId", e.target.value)} placeholder="Telegram Chat ID (placeholder)" />
                <InputField value={settings.firebaseApiKey} onChange={(e) => updateSettingsField("firebaseApiKey", e.target.value)} placeholder="Firebase apiKey (placeholder)" />
                <InputField value={settings.firebaseAuthDomain} onChange={(e) => updateSettingsField("firebaseAuthDomain", e.target.value)} placeholder="Firebase authDomain" />
                <InputField value={settings.firebaseProjectId} onChange={(e) => updateSettingsField("firebaseProjectId", e.target.value)} placeholder="Firebase projectId" />
                <InputField value={settings.firebaseStorageBucket} onChange={(e) => updateSettingsField("firebaseStorageBucket", e.target.value)} placeholder="Firebase storageBucket" />
                <InputField value={settings.firebaseMessagingSenderId} onChange={(e) => updateSettingsField("firebaseMessagingSenderId", e.target.value)} placeholder="Firebase messagingSenderId" />
                <InputField value={settings.firebaseAppId} onChange={(e) => updateSettingsField("firebaseAppId", e.target.value)} placeholder="Firebase appId" />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <ActionButton color="#16a34a" icon={<Send size={16} />} onClick={sendCurrentTelegram}>SEND TELEGRAM</ActionButton>
                  <ActionButton color="#0284c7" icon={<Cloud size={16} />} onClick={loadCloudSaved}>SYNC CLOUD</ActionButton>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Το PASTE + ANALYZE τώρα έχει fallback prompt όταν ο browser μπλοκάρει το clipboard.
                </div>
              </div>
            </Panel>

            {mode === "analyzer" ? (
              <Panel title="Paste Raw Match Data">
                <TextAreaField value={rawInput} onChange={(e) => setRawInput(e.target.value)} placeholder="Paste the Nowgoal match text here..." />
              </Panel>
            ) : (
              <Panel title="Live Auto Scanner">
                <div style={{ color: "#94a3b8", marginBottom: 12 }}>
                  This is ready for real live API wiring. Right now it scans demo live matches so the dashboard works immediately after deploy.
                </div>
                <ActionButton color="#7c3aed" icon={<BellRing size={16} />} onClick={runLiveScan}>{liveLoading ? "Scanning..." : "Run Live Scan"}</ActionButton>
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {liveMatches.length ? liveMatches.map((m) => (
                    <div key={m.id} style={{ border: "1px solid #334155", background: "#020617", borderRadius: 18, padding: 14 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "#7dd3fc" }}>{m.home} vs {m.away}</div>
                      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{m.league} | {m.matchDate} | {m.matchTime}</div>
                      <div style={{ marginTop: 10, display: "inline-flex", padding: "8px 12px", borderRadius: 999, ...(m.best ? edgeClass(m.best.edge) : edgeClass(0)) }}>{m.best ? `BEST: ${m.best.signal}` : "No signal"}</div>
                    </div>
                  )) : <div style={{ color: "#94a3b8" }}>No live scan results yet.</div>}
                </div>
              </Panel>
            )}

            <Panel title="Best Bet">
              {analyzed?.best ? (
                <div style={{ border: "1px solid rgba(74,222,128,0.35)", background: "rgba(2,6,23,0.8)", borderRadius: 18, padding: 16 }}>
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>Match</div>
                  <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{analyzed.home} vs {analyzed.away}</div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 6 }}>{analyzed.matchDate} | {analyzed.matchTime}</div>
                  <div style={{ marginTop: 12, display: "inline-flex", borderRadius: 999, background: "rgba(16,185,129,0.12)", padding: "8px 12px", color: "#86efac", fontWeight: 700 }}>
                    BEST BET: {analyzed.best.signal}
                  </div>
                  <div style={{ marginTop: 10, color: "#94a3b8" }}>Top Edge: <span style={{ color: "#86efac", fontWeight: 700 }}>{analyzed.best.edge}%</span></div>
                </div>
              ) : <div style={{ color: "#94a3b8" }}>No analysis yet.</div>}
            </Panel>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {mode === "analyzer" ? (
              <Panel title="Match Block" right={analyzed?.best ? <div style={{ border: "1px solid rgba(56,189,248,0.25)", background: "rgba(56,189,248,0.10)", color: "#7dd3fc", borderRadius: 999, padding: "8px 12px", fontWeight: 700 }}>TOP EDGE {analyzed.best.edge}%</div> : null}>
                {analyzed ? (
                  <div>
                    <div style={{ color: "#94a3b8", marginBottom: 12 }}>League: {analyzed.league} | Date: {analyzed.matchDate} | Time: {analyzed.matchTime}</div>
                    <div style={{ display: "grid", gap: 12 }}>
                      {analyzed.merged.map((item, i) => {
                        const c = edgeClass(item.edge);
                        return <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ borderRadius: 18, padding: 16, ...c }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{edgeLabel(item.edge)}</div>
                          <div style={{ marginTop: 8, fontWeight: 700, fontSize: 18, color: "white" }}>{item.signal}</div>
                        </motion.div>;
                      })}
                    </div>
                  </div>
                ) : <div style={{ color: "#94a3b8" }}>Analyze a match to see predictions.</div>}
              </Panel>
            ) : (
              <Panel title="Live Auto Dashboard" right={<div style={{ border: "1px solid rgba(168,85,247,0.25)", background: "rgba(168,85,247,0.10)", color: "#c4b5fd", borderRadius: 999, padding: "8px 12px", fontWeight: 700 }}>{liveMatches.length} live matches</div>}>
                {liveMatches.length ? (
                  <div style={{ display: "grid", gap: 12 }}>
                    {liveMatches.map((item, i) => {
                      const c = item.best ? edgeClass(item.best.edge) : edgeClass(0);
                      return <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ borderRadius: 18, padding: 16, ...c }}>
                        <div style={{ fontWeight: 800 }}>{item.home} vs {item.away}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{item.league} | {item.matchDate} | {item.matchTime}</div>
                        <div style={{ marginTop: 10, fontSize: 18, fontWeight: 700, color: "white" }}>{item.best ? item.best.signal : "No signal"}</div>
                        {item.valueAngles?.length ? <div style={{ marginTop: 8, color: "#fdba74", fontSize: 14 }}>Value: {item.valueAngles[0][0]} ({item.valueAngles[0][1]}%)</div> : null}
                        {item.liveSignals?.length ? <div style={{ marginTop: 6, color: "#fda4af", fontSize: 14 }}>Live: {item.liveSignals[0][0]} — {item.liveSignals[0][2]}</div> : null}
                      </motion.div>;
                    })}
                  </div>
                ) : <div style={{ color: "#94a3b8" }}>Run Live Scan to populate the live dashboard.</div>}
              </Panel>
            )}

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
              <Panel title="Value Logic">
                {analyzed?.valueAngles?.length ? <div style={{ display: "grid", gap: 10 }}>
                  {analyzed.valueAngles.map(([name, edge], i) => <div key={i} style={{ border: "1px solid rgba(249,115,22,0.3)", background: "rgba(249,115,22,0.10)", borderRadius: 16, padding: 14, color: "#fdba74" }}>{name} — EDGE {edge}%</div>)}
                </div> : <div style={{ color: "#94a3b8" }}>No clear value angle.</div>}
              </Panel>

              <Panel title="Live Signals">
                {analyzed?.liveSignals?.length ? <div style={{ display: "grid", gap: 10 }}>
                  {analyzed.liveSignals.map(([name, edge, ctx], i) => <div key={i} style={{ border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.10)", borderRadius: 16, padding: 14, color: "#fda4af" }}>{name} — {ctx} — EDGE {edge}%</div>)}
                </div> : <div style={{ color: "#94a3b8" }}>No live signal right now.</div>}
              </Panel>
            </div>

            <Panel title="Save List" right={<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ position: "relative", minWidth: 240 }}>
                <Search size={16} color="#64748b" style={{ position: "absolute", left: 12, top: 13 }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search saved matches..." style={{ ...styles.input, paddingLeft: 36 }} />
              </div>
              <ActionButton color="#dc2626" icon={<Trash2 size={16} />} onClick={clearAll}>CLEAR ALL</ActionButton>
            </div>}>
              {filteredSaved.length ? <div style={{ display: "grid", gap: 12 }}>
                {filteredSaved.map((item, i) => <div key={`${item.match}-${item.matchDate}-${i}`} style={{ border: "1px solid #334155", background: "#020617", borderRadius: 18, padding: 16 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#7dd3fc" }}>▌ {item.match}</div>
                  <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 13 }}>Date: {item.matchDate} | Time: {item.matchTime} | Saved: {item.savedAt}</div>
                  <div style={{ marginTop: 12, color: "#86efac", fontWeight: 700 }}>● BEST BET: {item.bestBet}</div>
                  <div style={{ marginTop: 8, color: "#cbd5e1" }}><strong>● TOP EDGE:</strong> {item.topEdge}</div>
                  <div style={{ marginTop: 8, color: "#d8b4fe", whiteSpace: "pre-wrap" }}><strong>● SIGNALS:</strong> {item.signals}</div>
                  <div style={{ marginTop: 8, color: "#fdba74", whiteSpace: "pre-wrap" }}><strong>● VALUE LOGIC:</strong> {item.valueLogic}</div>
                  <div style={{ marginTop: 8, color: "#fda4af", whiteSpace: "pre-wrap" }}><strong>● LIVE SIGNALS:</strong> {item.liveSignals}</div>
                </div>)}
              </div> : <div style={{ color: "#94a3b8" }}>No saved matches yet.</div>}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
