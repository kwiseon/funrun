/* ══════════════════════════════════════════════════════════════════
   FUN RUN — 러닝 아카이브
   data/tracks.json (빌드 산출물) + data/*.csv (직접 편집) 를 읽어 렌더링
   ══════════════════════════════════════════════════════════════════ */

const VOLT = '#d8ff00';
const RACE = '#ff2d55';

// ───────────────────────────────────────────── 유틸

/** 따옴표로 감싼 필드와 그 안의 쉼표를 지원하는 최소 CSV 파서 */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  // BOM 제거 + 개행 정규화
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // 이스케이프된 따옴표
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const fmtKm = km => km.toFixed(2);

/** 초 -> 5'32" 형태의 킬로 페이스 */
function fmtPace(secPerKm) {
  if (!secPerKm) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

/** 초 -> 1:12:40 또는 39:22 */
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** '2026-04-05' -> '2026.04.05 (일)' */
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${iso.replace(/-/g, '.')} (${day})`;
}

function stars(rating) {
  const n = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
  if (!n) return '';
  return '★'.repeat(n) + `<i>${'★'.repeat(5 - n)}</i>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ───────────────────────────────────────────── 데이터 로드

/** 원본 파일을 먼저 읽고, 실패하면 bundle.js 에 실린 사본을 쓴다.
 *  file:// 로 열면 fetch 가 CORS 로 전부 막히기 때문에 폴백이 필요하다. */
async function fetchOr(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.status);
    return await res.text();
  } catch {
    if (fallback == null) throw new Error(`${path} 를 읽지 못했습니다`);
    return fallback;
  }
}

async function loadAll() {
  const bundle = window.FUNRUN_BUNDLE || {};

  const [tracksText, runsText, shoesText, medalsText, monthlyText] = await Promise.all([
    fetchOr('data/tracks.json', bundle.tracks && JSON.stringify(bundle.tracks)),
    fetchOr('data/runs.csv', bundle.runsCsv),
    fetchOr('data/shoes.csv', bundle.shoesCsv),
    fetchOr('data/medals.csv', bundle.medalsCsv),
    fetchOr('data/monthly.csv', bundle.monthlyCsv ?? ''),
  ]);

  const tracks = JSON.parse(tracksText);
  const runsCsv = parseCSV(runsText);
  const shoesCsv = parseCSV(shoesText);
  const medalsCsv = parseCSV(medalsText);
  const monthly = parseCSV(monthlyText);

  // 날짜를 키로 러닝 메모를 트랙에 합친다
  const notesByDate = Object.fromEntries(runsCsv.map(r => [r['날짜'], r]));
  tracks.runs.forEach(run => {
    const n = notesByDate[run.date] || {};
    run.rating = n['만족도'] || '';
    run.review = n['한줄평'] || '';
    run.shoeId = n['운동화'] || '';
    run.photo = n['사진'] || '';
  });

  return { tracks, shoes: shoesCsv, medals: medalsCsv, monthly };
}

// ───────────────────────────────────────────── HERO

function renderHero({ tracks, medals, monthly }) {
  const s = tracks.summary;

  // 히어로 숫자는 월별 기록(data/monthly.csv)이 기준이다.
  // GPX 는 일부 러닝만 남아있어서 지도·코스 통계에만 쓴다.
  const months = monthly
    .filter(m => m['연월'])
    .sort((a, b) => a['연월'].localeCompare(b['연월']));
  const totalKm = months.reduce((sum, m) => sum + (parseFloat(m['거리km']) || 0), 0);

  if (months.length) {
    const first = `${months[0]['연월']}-01`;
    const last = months[months.length - 1]['기준일'] || monthEnd(months[months.length - 1]['연월']);
    document.querySelector('[data-period]').textContent =
      `${first.replace(/-/g, '.')} — ${last.replace(/-/g, '.')}`;
  } else {
    document.querySelector('[data-period]').textContent =
      `${s.firstDate.replace(/-/g, '.')} — ${s.lastDate.replace(/-/g, '.')}`;
  }

  document.querySelector('[data-run-count]').textContent = s.runCount;
  document.querySelector('[data-course-count]').textContent =
    tracks.clusters.filter(c => tracks.runs.some(r => r.clusterId === c.clusterId && r.inSeoul)).length;
  document.querySelector('[data-race-count]').textContent = s.raceCount;
  document.querySelector('[data-medal-count]').textContent = medals.length;

  // 위 숫자와 지도가 서로 다른 범위를 뜻하므로 분명히 적어둔다
  const note = document.querySelector('[data-excluded-note]');
  const parts = [];
  if (months.length) {
    parts.push(`※ 위 거리는 월별 기록의 합계예요. 아래 지도에는 GPX 가 남아있는 ` +
               `${s.runCount}회(${s.totalKm}km)만 그렸습니다.`);
  }
  if (s.excludedCount > 0) {
    const outside = tracks.runs.filter(r => !r.inSeoul);
    parts.push(`서울 밖에서 달린 ${s.excludedCount}회` +
               `(${outside.map(r => r.date.replace(/-/g, '.')).join(', ')})는 지도에서 뺐어요.`);
  }
  if (parts.length) { note.textContent = parts.join(' '); note.hidden = false; }

  countUp(document.querySelector('[data-total-km]'), totalKm || s.totalKm);
  renderMonthBar(months);
  drawHeroTracks(tracks);
}

/** '2026-08' -> '2026-08-31' */
function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

/** 월별 거리 막대. 기록이 어떻게 쌓였는지 한눈에 보이게. */
function renderMonthBar(months) {
  const box = document.querySelector('[data-monthbar]');
  if (!box || !months.length) return;

  const max = Math.max(...months.map(m => parseFloat(m['거리km']) || 0));
  box.innerHTML = months.map(m => {
    const km = parseFloat(m['거리km']) || 0;
    const label = String(Number(m['연월'].split('-')[1]));
    return `
      <div class="monthbar__col" title="${esc(m['연월'])} · ${km}km">
        <span class="monthbar__km">${km}</span>
        <div class="monthbar__track">
          <i style="height:0" data-h="${max ? (km / max) * 100 : 0}"></i>
        </div>
        <span class="monthbar__label">${label}월</span>
      </div>`;
  }).join('');

  // 화면에 들어오면 차례로 차오르게
  const bars = box.querySelectorAll('.monthbar__track i');
  requestAnimationFrame(() => {
    bars.forEach((b, i) => setTimeout(() => { b.style.height = b.dataset.h + '%'; }, 260 + i * 70));
  });
}

/** 누적 거리 숫자가 0 에서 차오르는 연출 */
function countUp(el, target) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target.toFixed(1);
    return;
  }
  const dur = 1800, t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = (target * eased).toFixed(1);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/** 히어로 배경에 실제 트랙을 옅게 깔아둔다 */
function drawHeroTracks(tracks) {
  const cv = document.querySelector('.hero__tracks');
  const routes = tracks.runs.filter(r => r.inSeoul);
  if (!routes.length) return;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 전체 트랙을 감싸는 경계
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    routes.forEach(r => {
      minLat = Math.min(minLat, r.bbox[0]); minLon = Math.min(minLon, r.bbox[1]);
      maxLat = Math.max(maxLat, r.bbox[2]); maxLon = Math.max(maxLon, r.bbox[3]);
    });

    // 위경도 -> 화면. 위도는 화면 위쪽이 크므로 뒤집는다.
    const pad = 0.12;
    const sx = w * (1 - pad * 2) / (maxLon - minLon);
    const sy = h * (1 - pad * 2) / (maxLat - minLat);
    const sc = Math.min(sx, sy);   // 모든 트랙이 화면 안에 들어오도록
    const cx = w / 2, cy = h / 2;
    const mLon = (minLon + maxLon) / 2, mLat = (minLat + maxLat) / 2;
    const proj = ([lat, lon]) => [cx + (lon - mLon) * sc, cy - (lat - mLat) * sc];

    routes.forEach(r => {
      ctx.beginPath();
      r.segments.forEach(seg => seg.forEach((c, i) => {
        const [x, y] = proj(c);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }));
      ctx.strokeStyle = r.isRace ? 'rgba(255,45,85,.5)' : 'rgba(216,255,0,.22)';
      ctx.lineWidth = r.isRace ? 2 : 1.2;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
    });
  }

  draw();
  addEventListener('resize', draw);
}

// ───────────────────────────────────────────── MEDALS

function renderMedals(medals) {
  const rail = document.querySelector('[data-medal-wall]');

  const years = [...new Set(medals.map(m => m['연도']))].sort((a, b) => b - a);
  document.querySelector('[data-medal-years]').textContent =
    `${years[years.length - 1]} — ${years[0]}, 총 ${medals.length}개.`;

  // 연도로 영역을 나누지 않고 한 줄에 쭉 건다. 연도는 사이사이 눈금으로만.
  const items = years.flatMap(year => {
    const group = medals.filter(m => m['연도'] === year);
    return [
      `<div class="yearmark"><span>${esc(year)}</span></div>`,
      ...group.map(m => `
        <figure class="medal">
          <img class="medal__img" src="${esc(m['사진'])}" alt="${esc(m['대회명'])} 메달" loading="lazy">
          <figcaption>
            <p class="medal__name">${esc(m['대회명'])}</p>
            <p class="medal__meta">${[m['종목'], m['기록']].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p>
            ${m['메모'] ? `<p class="medal__note">${esc(m['메모'])}</p>` : ''}
          </figcaption>
        </figure>`),
    ];
  });

  rail.innerHTML = `<div class="medalrail__items">${items.join('')}</div>`;

  // 세로 휠로도 밀리게 한다. 레일 끝에 닿으면 페이지 스크롤로 넘겨준다.
  rail.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // 가로 제스처는 그대로
    const max = rail.scrollWidth - rail.clientWidth;
    const next = rail.scrollLeft + e.deltaY;
    if (next < 0 || next > max) return;                     // 끝이면 페이지에 양보
    e.preventDefault();
    rail.scrollLeft = next;
  }, { passive: false });
}

// ───────────────────────────────────────────── SHOES

function renderShoes(shoes, tracks) {
  const rack = document.querySelector('[data-shoe-rack]');

  // 신발별 누적 거리 (서울 밖 러닝도 신발은 신었으니 전부 합산)
  const km = {};
  tracks.runs.forEach(r => {
    if (r.shoeId) km[r.shoeId] = (km[r.shoeId] || 0) + r.distanceKm;
  });
  const max = Math.max(1, ...Object.values(km));

  rack.innerHTML = shoes.map(s => {
    const [x, y, w, h] = (s['크롭'] || '0,0,100,100').split(',').map(Number);
    // 크롭 사각형(원본 대비 %)을 background-size/position 으로 환산.
    // 원본과 칸이 모두 정사각이고 크롭도 정사각(w === h)이면 비율이 안 깨진다.
    const bgSize = `${(100 / w) * 100}% ${(100 / h) * 100}%`;
    const bgPos = `${w < 100 ? (x / (100 - w)) * 100 : 0}% ${h < 100 ? (y / (100 - h)) * 100 : 0}%`;
    const dist = km[s['id']] || 0;
    const retired = s['상태'] === '은퇴';

    return `
      <article class="shoe ${retired ? 'shoe--retired' : ''}" data-shoe="${esc(s['id'])}">
        <div class="shoe__cubby">
          <div class="shoe__photo" style="
            background-image:url('${esc(s['사진'])}');
            background-size:${bgSize};
            background-position:${bgPos};"></div>
          ${s['상태'] ? `<span class="shoe__state">${esc(s['상태'])}</span>` : ''}
        </div>
        <div class="shoe__shelf"></div>
        <div class="shoe__label">
          <div>
            <p class="shoe__brand">${esc(s['브랜드'])}</p>
            <h3 class="shoe__name">${esc(s['이름'])}</h3>
            ${s['사이즈'] ? `<p class="shoe__nick">${esc(s['사이즈'])} mm</p>` : ''}
          </div>
          <p class="shoe__km"><b>${dist.toFixed(1)}</b><span>KM</span></p>
        </div>
        <div class="shoe__bar"><i data-width="${(dist / max) * 100}"></i></div>
        ${s['메모'] ? `<p class="shoe__memo">${esc(s['메모'])}</p>` : ''}
      </article>`;
  }).join('');

  // 섹션이 화면에 들어올 때 막대가 차오르게
  const bars = rack.querySelectorAll('.shoe__bar i');
  new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      bars.forEach((b, i) => setTimeout(() => { b.style.width = b.dataset.width + '%'; }, i * 140));
      obs.disconnect();
    });
  }, { threshold: .3 }).observe(rack);
}

// ───────────────────────────────────────────── MAP

function renderMap({ tracks, shoes }) {
  const shoeName = Object.fromEntries(
    shoes.map(s => [s['id'], `${s['브랜드']} ${s['이름']}`.trim()]));

  const runById = Object.fromEntries(tracks.runs.map(r => [r.id, r]));

  // 서울 안에서 달린 코스만 지도에 올린다
  const clusters = tracks.clusters
    .map(c => ({ ...c, runs: c.runIds.map(id => runById[id]).filter(r => r.inSeoul) }))
    .filter(c => c.runs.length)
    .sort((a, b) => b.totalKm - a.totalKm);

  const mapEl = document.getElementById('leaflet');
  const map = L.map(mapEl, {
    zoomControl: true,
    scrollWheelZoom: false,   // 스크롤로 페이지를 내리다 지도가 확대되는 걸 막는다
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    opacity: .55,
  }).addTo(map);

  // 지도를 클릭하면 스크롤 줌을 켜고, 지도를 벗어나면 다시 끈다
  map.on('click', () => map.scrollWheelZoom.enable());
  mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

  const layers = {};    // clusterId -> { line, hit, pin }
  const allBounds = [];

  clusters.forEach(c => {
    const rep = runById[c.repRunId].inSeoul
      ? runById[c.repRunId]
      : c.runs.slice().sort((a, b) => b.distanceKm - a.distanceKm)[0];

    // 기록이 끊긴 지점에서 나뉜 여러 구간. Leaflet 은 배열의 배열을
    // 이어지지 않은 선들로 그려준다.
    const latlngs = rep.segments;
    allBounds.push(...latlngs.flat());

    // 달린 횟수만큼 선이 굵어진다
    const weight = (c.hasRace ? 5 : 3) + (c.runs.length - 1) * 1.6;
    const color = c.hasRace ? RACE : VOLT;

    // 글로우용 밑선
    const glow = L.polyline(latlngs, {
      color, weight: weight + (c.hasRace ? 12 : 8),
      opacity: c.hasRace ? .22 : .13, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(map);

    const line = L.polyline(latlngs, {
      color, weight, opacity: .95, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(map);

    // 얇은 선은 마우스로 잡기 어려워서 투명한 굵은 선을 겹쳐둔다
    const hit = L.polyline(latlngs, {
      color: '#000', weight: 26, opacity: 0, lineCap: 'round',
    }).addTo(map);

    let pin = null;
    if (c.hasRace) {
      pin = L.marker(latlngs[0][0], {
        icon: L.divIcon({ className: '', html: '<div class="racepin">🏅</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(map);
    }

    layers[c.clusterId] = { glow, line, hit, pin, weight, color, cluster: c };

    hit.on('mouseover', () => focus(c.clusterId, false));
    hit.on('click', () => focus(c.clusterId, true));
  });

  map.fitBounds(L.latLngBounds(allBounds), { padding: [50, 50] });

  // ── 상세 패널 ──
  const panelEmpty = document.querySelector('[data-panel-empty]');
  const panelBody = document.querySelector('[data-panel-body]');
  let pinned = null;

  function focus(clusterId, isPin) {
    if (pinned && !isPin && pinned !== clusterId) return;   // 고정 중엔 hover 무시
    if (isPin) pinned = pinned === clusterId ? null : clusterId;
    if (pinned === null && isPin) { clearFocus(); return; }

    Object.entries(layers).forEach(([id, l]) => {
      const on = id === clusterId;
      l.line.setStyle({ opacity: on ? 1 : .22, weight: on ? l.weight + 2 : l.weight });
      l.glow.setStyle({ opacity: on ? (l.cluster.hasRace ? .4 : .3) : .06 });
      if (on) l.line.bringToFront();
    });

    document.querySelectorAll('.courseitem').forEach(el =>
      el.classList.toggle('is-active', el.dataset.cluster === clusterId));

    panelEmpty.hidden = true;
    panelBody.hidden = false;
    panelBody.innerHTML = panelHTML(layers[clusterId].cluster);
    panelBody.parentElement.scrollTop = 0;
  }

  function clearFocus() {
    if (pinned) return;
    Object.values(layers).forEach(l => {
      l.line.setStyle({ opacity: .95, weight: l.weight });
      l.glow.setStyle({ opacity: l.cluster.hasRace ? .22 : .13 });
    });
    document.querySelectorAll('.courseitem').forEach(el => el.classList.remove('is-active'));
    panelBody.hidden = true;
    panelEmpty.hidden = false;
  }

  // 레이어 사이를 지날 때마다 터지는 map 'mouseout' 대신 컨테이너 이탈만 본다
  mapEl.addEventListener('mouseleave', clearFocus);

  function panelHTML(c) {
    const runs = c.runs.slice().sort((a, b) => b.date.localeCompare(a.date));
    const longest = runs.reduce((a, b) => (b.distanceKm > a.distanceKm ? b : a));
    const avgPace = Math.round(
      runs.reduce((s, r) => s + r.paceSecPerKm, 0) / runs.length);

    return `
      <p class="panel__eyebrow">
        COURSE
        ${c.hasRace ? '<span class="panel__racetag">🏅 RACE</span>' : ''}
      </p>
      <h3 class="panel__title">${esc(c.name)}</h3>
      ${c.note ? `<p class="panel__note">${esc(c.note)}</p>` : ''}

      <div class="panel__figs">
        <div class="panel__fig"><span>LONGEST</span><b>${fmtKm(longest.distanceKm)}</b><i>km</i></div>
        <div class="panel__fig"><span>RUNS</span><b>${runs.length}</b><i>회</i></div>
        <div class="panel__fig"><span>AVG PACE</span><b>${fmtPace(avgPace)}</b></div>
      </div>

      ${runs.length > 1 ? `
        <p class="panel__repeat">
          이 코스를 <b>${runs.length}번</b> 달렸어요.
          가장 길게 달린 날은 ${fmtDate(longest.date)}, <b>${fmtKm(longest.distanceKm)}km</b>.
          지도에는 그날의 경로를 그렸습니다.
        </p>` : ''}

      <div class="panel__log">
        <p class="panel__logtitle">LOG</p>
        ${runs.map(r => `
          <div class="entry">
            <div class="entry__top">
              <p class="entry__date">${fmtDate(r.date)}<em>${esc(r.startTime)}</em></p>
              <p class="entry__stars">${stars(r.rating)}</p>
            </div>
            <p class="entry__nums">
              <b>${fmtKm(r.distanceKm)}</b> KM &nbsp;·&nbsp;
              <b>${fmtDuration(r.durationSec)}</b> &nbsp;·&nbsp;
              <b>${fmtPace(r.paceSecPerKm)}</b> /KM
            </p>
            ${r.review
              ? `<p class="entry__review">${esc(r.review)}</p>`
              : `<p class="entry__review entry__review--empty">아직 후기를 안 적었어요.</p>`}
            ${r.shoeId ? `<span class="entry__shoe">${esc(shoeName[r.shoeId] || r.shoeId)}</span>` : ''}
            ${r.photo ? `<img class="entry__photo" src="${esc(r.photo)}" alt="${fmtDate(r.date)} 러닝 사진" loading="lazy">` : ''}
          </div>`).join('')}
      </div>`;
  }

  // ── 지도 아래 코스 목록 ──
  const list = document.querySelector('[data-course-list]');
  list.innerHTML = clusters.map(c => `
    <li class="courseitem ${c.hasRace ? 'courseitem--race' : ''}" data-cluster="${c.clusterId}">
      <i class="courseitem__dot"></i>
      <div class="courseitem__text">
        <p class="courseitem__name">${c.hasRace ? '🏅 ' : ''}${esc(c.name)}</p>
        <p class="courseitem__meta">${fmtKm(Math.max(...c.runs.map(r => r.distanceKm)))} KM · ${c.runs.length}회</p>
      </div>
    </li>`).join('');

  list.querySelectorAll('.courseitem').forEach(el => {
    el.addEventListener('mouseenter', () => focus(el.dataset.cluster, false));
    el.addEventListener('mouseleave', clearFocus);
    el.addEventListener('click', () => {
      focus(el.dataset.cluster, true);
      map.fitBounds(layers[el.dataset.cluster].line.getBounds(), { padding: [60, 60] });
    });
  });
}

// ───────────────────────────────────────────── 스크롤 진입 연출

function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: .12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
}

// ───────────────────────────────────────────── 시작

(async function init() {
  initReveal();
  try {
    const data = await loadAll();
    renderHero(data);
    renderMedals(data.medals);
    renderShoes(data.shoes, data.tracks);
    renderMap(data);
    document.querySelector('[data-generated]').textContent =
      `BUILT ${data.tracks.generatedAt.slice(0, 10).replace(/-/g, '.')}`;
  } catch (err) {
    console.error(err);
    // 조용히 빈 화면이 되지 않게, 눈에 띄게 알린다
    const box = document.createElement('div');
    box.className = 'loaderror';
    box.innerHTML =
      '<b>데이터를 불러오지 못했습니다.</b>' +
      '<span>data/ 폴더가 index.html 옆에 있는지 확인하고, ' +
      '<code>python3 build/build.py</code> 를 한 번 실행해 주세요.</span>' +
      `<span class="loaderror__detail">${esc(err.message || err)}</span>`;
    document.body.prepend(box);
  }
})();
