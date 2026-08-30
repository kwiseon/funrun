#!/usr/bin/env node
/* build/build.py 의 Node 포트.
 *
 * 이 컴퓨터에 Python이 설치돼 있지 않아서(윈도우 스토어 stub만 있음) 만들었다.
 * 로직은 build.py와 1:1로 맞춰뒀다 — 원본을 고치면 여기도 같이 고칠 것.
 * Python이 설치되면 build.py를 그대로 써도 된다.
 *
 * 사용법:  node build/build.js
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const MAP_DIR = path.join(ROOT_DIR, "map");
const OUT = path.join(ROOT_DIR, "data", "tracks.json");

const SIMPLIFY_TOLERANCE_M = 8.0;
const GRID_SIZE_M = 60.0;
const SIMILARITY_THRESHOLD = 0.40;
const SEOUL_BBOX = [37.42, 126.76, 37.71, 127.19];
const PRIVATE_ZONES = [[37.596, 127.0170, 37.6005, 127.0225]];
const EXCLUDED_DATES = new Set();
const PAUSE_GAP_SEC = 15;
const CONTAINMENT_THRESHOLD = 0.85;
const MIN_LENGTH_RATIO = 0.35;

// 자동 클러스터링(그리드 겹침도)이 실제로는 같은 코스인데 갈라놓는 경우를 위한
// 수동 그룹핑. 같은 배열에 있는 날짜는 겹침도와 상관없이 무조건 한 코스로 묶는다.
// 같은 코스를 나중에 또 뛰면 그 날짜를 해당 배열에 추가하면 된다.
const MANUAL_GROUPS = [
  ["2026-07-24", "2026-08-25"], // 성북천 이지런
  ["2026-07-26", "2026-08-29"], // 성북천 — 마장동 코스 (구 "마장동 코스")
];

function inPrivateZone(lat, lon) {
  return PRIVATE_ZONES.some(z => z[0] <= lat && lat <= z[2] && z[1] <= lon && lon <= z[3]);
}

const COURSES_CSV = path.join(ROOT_DIR, "data", "courses.csv");

// ---------------------------------------------------------------- CSV utils
function parseCsv(text) {
  // returns array of arrays (rows), handles quoted fields with commas/quotes
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ""; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}

function csvDictRead(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const rows = parseCsv(fs.readFileSync(filePath, "utf-8"));
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] !== undefined ? r[idx] : ""; });
    return o;
  });
}

function csvField(v) {
  v = v === undefined || v === null ? "" : String(v);
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

function csvDictWrite(filePath, fields, rows) {
  const lines = [fields.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(fields.map(f => csvField(row[f])).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\r\n") + "\r\n", "utf-8");
}

function loadCourses() {
  if (!fs.existsSync(COURSES_CSV)) return {};
  const rows = csvDictRead(COURSES_CSV);
  const out = {};
  for (const r of rows) {
    const key = (r["대표날짜"] || "").trim();
    if (key) out[key] = [
      (r["코스명"] || "").trim(),
      (r["설명"] || "").trim(),
      (r["단계"] || "").trim(),
    ];
  }
  return out;
}

// ---------------------------------------------------------------- geo utils
function haversine(a, b) {
  const [lat1, lon1] = a, [lat2, lon2] = b;
  const x = (Math.PI / 180 * (lon2 - lon1)) * Math.cos(Math.PI / 180 * ((lat1 + lat2) / 2));
  const y = Math.PI / 180 * (lat2 - lat1);
  return Math.hypot(x, y) * 6371000;
}

function perpendicularDistance(pt, start, end) {
  if (start[0] === end[0] && start[1] === end[1]) return haversine(pt, start);
  const lat0 = Math.PI / 180 * start[0];
  const mx = 111320 * Math.cos(lat0);
  const my = 110540;
  const toXY = p => [p[1] * mx, p[0] * my];
  const [px, py] = toXY(pt);
  const [ax, ay] = toXY(start);
  const [bx, by] = toXY(end);
  const dx = bx - ax, dy = by - ay;
  const denom = dx * dx + dy * dy;
  let t = denom === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / denom;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;
    let maxDist = 0, index = first;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > tolerance) {
      keep[index] = true;
      stack.push([first, index]);
      stack.push([index, last]);
    }
  }
  return points.filter((p, i) => keep[i]);
}

// ---------------------------------------------------------------- GPX parse
const TRKPT_RE = /lat="([-\d.]+)"\s+lon="([-\d.]+)"/g;
const TIME_RE = /<time>(.*?)<\/time>/g;

function parseGpx(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const points = [];
  let m;
  TRKPT_RE.lastIndex = 0;
  while ((m = TRKPT_RE.exec(raw)) !== null) points.push([parseFloat(m[1]), parseFloat(m[2])]);
  const times = [];
  TIME_RE.lastIndex = 0;
  while ((m = TIME_RE.exec(raw)) !== null) times.push(m[1]);
  let times2 = times;
  if (times2.length > points.length) times2 = times2.slice(times2.length - points.length);

  let pts = points, tms = times2;
  if (PRIVATE_ZONES.length) {
    const keepIdx = [];
    pts.forEach((p, i) => { if (!inPrivateZone(p[0], p[1])) keepIdx.push(i); });
    if (keepIdx.length !== pts.length) {
      pts = keepIdx.map(i => pts[i]);
      tms = keepIdx.map(i => tms[i]);
    }
  }
  return [pts, tms];
}

function parseIso(s) {
  return new Date(s.replace("Z", "+00:00"));
}

function trackDistance(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

function splitSegments(points, stamps) {
  const segs = [];
  let cur = [0];
  for (let i = 1; i < points.length; i++) {
    const dt = (stamps[i] - stamps[i - 1]) / 1000;
    if (dt <= 0 || dt > PAUSE_GAP_SEC) {
      if (cur.length > 1) segs.push(cur);
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

// ---------------------------------------------------------------- clustering
function gridCells(points, size_m) {
  const cells = new Set();
  for (const [lat, lon] of points) {
    const latStep = size_m / 110540;
    const lonStep = size_m / (111320 * Math.cos(Math.PI / 180 * lat));
    cells.add(Math.floor(lat / latStep) + "," + Math.floor(lon / lonStep));
  }
  return cells;
}

function setIntersectSize(a, b) {
  let n = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) n++;
  return n;
}

function similarity(a, b) {
  if (!a.size || !b.size) return 0.0;
  const inter = setIntersectSize(a, b);
  const union = a.size + b.size - inter;
  return inter / union;
}

function containment(short, long_) {
  if (!short.size) return 0.0;
  return setIntersectSize(short, long_) / short.size;
}

function cluster(runs) {
  const order = runs.map((_, i) => i).sort((a, b) => runs[b].distanceKm - runs[a].distanceKm);
  const reps = [];
  const groups = [];

  for (const i of order) {
    let bestScore = 0.0, bestGroup = null, bestWhy = "";
    for (let gi = 0; gi < reps.length; gi++) {
      const rep = reps[gi];
      const jac = similarity(runs[i]._cells, runs[rep]._cells);
      const con = containment(runs[i]._cells, runs[rep]._cells);
      const ratio = runs[i].distanceKm / runs[rep].distanceKm;
      let score = jac, why = `jaccard ${jac.toFixed(2)}`;
      if (con >= CONTAINMENT_THRESHOLD && ratio >= MIN_LENGTH_RATIO && con > score) {
        score = con; why = `포함률 ${(con * 100).toFixed(0)}%, 길이비 ${(ratio * 100).toFixed(0)}%`;
      }
      if (score > bestScore) { bestScore = score; bestGroup = gi; bestWhy = why; }
    }
    const merged = bestGroup !== null && (bestScore >= SIMILARITY_THRESHOLD || bestScore >= CONTAINMENT_THRESHOLD);
    if (merged) {
      groups[bestGroup].push(i);
      console.log(`  merge: ${runs[i].date} -> ${runs[reps[bestGroup]].date}  (${bestWhy})`);
    } else {
      reps.push(i);
      groups.push([i]);
    }
  }
  return groups;
}

/** MANUAL_GROUPS에 지정된 날짜들을 겹침도 계산 없이 강제로 한 그룹으로 묶는다.
 * 나머지 러닝만 기존 cluster()로 자동 클러스터링한다. */
function clusterWithManualGroups(runs, manualGroups) {
  const dateToIndex = new Map(runs.map((r, i) => [r.date, i]));
  const manualIndexSets = [];
  const manualIndices = new Set();

  for (const dates of manualGroups) {
    const idxs = dates.map(d => dateToIndex.get(d)).filter(i => i !== undefined);
    if (idxs.length < 2) continue; // 아직 짝이 없으면(예: 상대 러닝이 아직 없음) 건너뛴다
    idxs.forEach(i => manualIndices.add(i));
    manualIndexSets.push(idxs);
    console.log(`  manual: ${idxs.map(i => runs[i].date).join(' + ')}`);
  }

  const autoPool = runs.map((_, i) => i).filter(i => !manualIndices.has(i));
  const autoRuns = autoPool.map(i => runs[i]);
  const autoGroupsLocal = cluster(autoRuns);
  const autoGroups = autoGroupsLocal.map(g => g.map(localIdx => autoPool[localIdx]));

  return [...manualIndexSets, ...autoGroups];
}

// ---------------------------------------------------------------- main
function inSeoul(bbox) {
  const [min_lat, min_lon, max_lat, max_lon] = bbox;
  const s = SEOUL_BBOX;
  const clat = (min_lat + max_lat) / 2, clon = (min_lon + max_lon) / 2;
  return s[0] <= clat && clat <= s[2] && s[1] <= clon && clon <= s[3];
}

const RUNS_CSV = path.join(ROOT_DIR, "data", "runs.csv");
const CSV_FIELDS = ["날짜", "코스", "거리km", "대회", "만족도", "한줄평", "운동화", "사진"];
const CSV_AUTO = new Set(["날짜", "코스", "거리km", "대회"]);

function syncRunsCsv(runs, clusters) {
  const kept = {};
  if (fs.existsSync(RUNS_CSV)) {
    for (const row of csvDictRead(RUNS_CSV)) {
      if (row["날짜"]) kept[row["날짜"].trim()] = row;
    }
  }
  const nameOf = {};
  for (const c of clusters) for (const rid of c.runIds) nameOf[rid] = c.name;

  let added = 0;
  const rows = [];
  const sortedRuns = runs.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const r of sortedRuns) {
    const old = kept[r.date];
    if (old === undefined) added++;
    const row = {};
    for (const k of CSV_FIELDS) if (!CSV_AUTO.has(k)) row[k] = (old || {})[k] || "";
    row["날짜"] = r.date;
    row["코스"] = nameOf[r.id] || "";
    row["거리km"] = r.distanceKm.toFixed(2);
    row["대회"] = r.isRace ? "대회" : "";
    rows.push(row);
  }
  csvDictWrite(RUNS_CSV, CSV_FIELDS, rows);
  console.log(`-> data/runs.csv 동기화 (${rows.length}행` + (added ? `, 새 러닝 ${added}개 추가` : "") + ")");
}

const BUNDLE_JS = path.join(ROOT_DIR, "data", "bundle.js");

function writeBundle() {
  function read(name) {
    const p = path.join(ROOT_DIR, "data", name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  }
  const payload = {
    tracks: JSON.parse(fs.readFileSync(OUT, "utf-8")),
    runsCsv: read("runs.csv"),
    shoesCsv: read("shoes.csv"),
    medalsCsv: read("medals.csv"),
    coursesCsv: read("courses.csv"),
    monthlyCsv: read("monthly.csv"),
    raceCsv: read("race.csv"),
    trainingCsv: read("training.csv"),
    raceProfileCsv: read("race_profile.csv"),
  };
  const body = "/* build.py / build.js 가 만듭니다. 직접 고치지 마세요. */\nwindow.FUNRUN_BUNDLE = " + JSON.stringify(payload) + ";\n";
  fs.writeFileSync(BUNDLE_JS, body, "utf-8");
  console.log(`-> data/bundle.js (${(fs.statSync(BUNDLE_JS).size / 1024).toFixed(0)}KB, 서버 없이 열 때 사용)`);
}

function round(v, n) {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

function pad(s, len) { s = String(s); while (s.length < len) s += " "; return s; }
function padStart(s, len) { s = String(s); while (s.length < len) s = " " + s; return s; }
function padZero(s, len) { s = String(s); while (s.length < len) s = "0" + s; return s; }

function main() {
  const files = fs.readdirSync(MAP_DIR).filter(f => f.toLowerCase().endsWith(".gpx")).sort();
  const runs = [];

  console.log(`GPX ${files.length}개 파싱 중...`);
  for (const rawName of files) {
    const name = rawName.normalize("NFC");
    const [points, times] = parseGpx(path.join(MAP_DIR, rawName));
    if (points.length < 2) { console.log(`  skip (포인트 부족): ${name}`); continue; }

    const dateStr = name.slice(0, 8);
    const dateIso = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    if (EXCLUDED_DATES.has(dateIso)) { console.log(`  제외: ${name.slice(0, 30)}`); continue; }
    const isRace = name.includes("(대회)");

    const stamps = times.map(parseIso);
    const KST_OFFSET_MIN = 9 * 60;
    const start = new Date(stamps[0].getTime() + KST_OFFSET_MIN * 60000);
    const end = new Date(stamps[stamps.length - 1].getTime() + KST_OFFSET_MIN * 60000);
    const elapsedS = Math.floor((end - start) / 1000);

    const segments = splitSegments(points, stamps);
    const segPoints = segments.map(seg => seg.map(i => points[i]));
    const distanceM = segPoints.reduce((s, sp) => s + trackDistance(sp), 0);
    const durationS = Math.floor(segments.reduce((s, seg) => s + (stamps[seg[seg.length - 1]] - stamps[seg[0]]) / 1000, 0));
    if (!distanceM) { console.log(`  skip (유효 구간 없음): ${name}`); continue; }

    const used = segPoints.flat();
    const lats = used.map(p => p[0]), lons = used.map(p => p[1]);
    const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];

    const simplified = segPoints.map(sp => douglasPeucker(sp, SIMPLIFY_TOLERANCE_M));
    const nSimple = simplified.reduce((s, x) => s + x.length, 0);

    const startStr = `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`;

    const run = {
      id: dateStr,
      date: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
      file: name,
      isRace,
      startTime: startStr,
      distanceKm: round(distanceM / 1000, 2),
      durationSec: durationS,
      elapsedSec: elapsedS,
      paceSecPerKm: distanceM > 100 ? Math.floor(durationS / (distanceM / 1000)) : 0,
      bbox: bbox.map(v => round(v, 6)),
      inSeoul: inSeoul(bbox),
      segments: simplified.map(seg => seg.map(([la, lo]) => [round(la, 5), round(lo, 5)])),
      _cells: gridCells(used, GRID_SIZE_M),
    };
    runs.push(run);

    const pace = durationS / (distanceM / 1000);
    const gap = segments.length > 3 ? " ⚠끊김" : "";
    console.log(
      `  ${pad(name.slice(0, 30), 32)} ${padStart((distanceM / 1000).toFixed(2), 6)}km  ` +
      `${Math.floor(pace / 60)}'${padZero(Math.floor(pace % 60), 2)}"/km  ` +
      `이동 ${padStart(Math.floor(durationS / 60), 3)}분 / 경과 ${padStart(Math.floor(elapsedS / 60), 3)}분  ` +
      `${padStart(points.length, 5)}->${padStart(nSimple, 4)}pt  ` +
      `${segments.length}구간${gap}  ` +
      `${inSeoul(bbox) ? "서울" : "서울 밖"}`
    );
  }

  console.log("\n코스 클러스터링...");
  const groups = clusterWithManualGroups(runs, MANUAL_GROUPS);

  const courses = loadCourses();
  const clusters = [];
  groups.forEach((idxs, gi) => {
    const members = idxs.map(i => runs[i]).sort((a, b) => b.distanceKm - a.distanceKm);
    const rep = members[0];
    let [name, note, stages] = courses[rep.date] || ["", "", ""];
    if (!name) {
      name = `코스 ${gi + 1}`;
      note = ""; stages = "";
      console.log(`  ! data/courses.csv 에 ${rep.date} 행이 없어 임시 이름을 씁니다`);
    }
    clusters.push({
      clusterId: `c${String(gi).padStart(2, "0")}`,
      name,
      note,
      stages: stages.split("|").map(t => t.trim()).filter(Boolean),
      repRunId: rep.id,
      runCount: members.length,
      runIds: members.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(m => m.id),
      totalKm: round(members.reduce((s, m) => s + m.distanceKm, 0), 2),
      hasRace: members.some(m => m.isRace),
    });
  });

  for (const r of runs) delete r._cells;

  const clusterOf = {};
  for (const c of clusters) for (const rid of c.runIds) clusterOf[rid] = c.clusterId;
  for (const r of runs) r.clusterId = clusterOf[r.id];

  const seoulRuns = runs.filter(r => r.inSeoul);
  const payload = {
    generatedAt: new Date().toISOString().replace("Z", "+09:00"),
    summary: {
      firstDate: seoulRuns.reduce((m, r) => r.date < m ? r.date : m, seoulRuns[0].date),
      lastDate: seoulRuns.reduce((m, r) => r.date > m ? r.date : m, seoulRuns[0].date),
      runCount: seoulRuns.length,
      totalKm: round(seoulRuns.reduce((s, r) => s + r.distanceKm, 0), 1),
      raceCount: seoulRuns.filter(r => r.isRace).length,
      totalKmAll: round(runs.reduce((s, r) => s + r.distanceKm, 0), 1),
      excludedCount: runs.length - seoulRuns.length,
    },
    clusters,
    runs,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload), "utf-8");

  const sizeKb = fs.statSync(OUT).size / 1024;
  syncRunsCsv(runs, clusters);
  writeBundle();

  console.log(`\n${clusters.length}개 코스 / ${runs.length}개 러닝`);
  console.log(`서울 ${payload.summary.totalKm}km (${seoulRuns.length}회), 제외 ${payload.summary.excludedCount}회`);
  console.log(`-> data/tracks.json (${sizeKb.toFixed(0)}KB)`);
}

main();
