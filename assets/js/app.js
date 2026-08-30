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

  const [tracksText, runsText, shoesText, medalsText, monthlyText,
         raceText, trainingText, profileText] = await Promise.all([
    fetchOr('data/tracks.json', bundle.tracks && JSON.stringify(bundle.tracks)),
    fetchOr('data/runs.csv', bundle.runsCsv),
    fetchOr('data/shoes.csv', bundle.shoesCsv),
    fetchOr('data/medals.csv', bundle.medalsCsv),
    fetchOr('data/monthly.csv', bundle.monthlyCsv ?? ''),
    fetchOr('data/race.csv', bundle.raceCsv ?? ''),
    fetchOr('data/training.csv', bundle.trainingCsv ?? ''),
    fetchOr('data/race_profile.csv', bundle.raceProfileCsv ?? ''),
  ]);

  const tracks = JSON.parse(tracksText);
  const runsCsv = parseCSV(runsText);
  const shoesCsv = parseCSV(shoesText);
  const medalsCsv = parseCSV(medalsText);
  const monthly = parseCSV(monthlyText);
  // 대회 정보는 항목/값 두 칸짜리라 객체로 바꿔둔다
  const race = Object.fromEntries(parseCSV(raceText).map(r => [r['항목'], r['값']]));
  const training = parseCSV(trainingText);
  const profile = parseCSV(profileText);

  // 날짜를 키로 러닝 메모를 트랙에 합친다
  const notesByDate = Object.fromEntries(runsCsv.map(r => [r['날짜'], r]));
  tracks.runs.forEach(run => {
    const n = notesByDate[run.date] || {};
    run.rating = n['만족도'] || '';
    run.review = n['한줄평'] || '';
    run.shoeId = n['운동화'] || '';
    run.photo = n['사진'] || '';
  });

  return { tracks, shoes: shoesCsv, medals: medalsCsv, monthly, race, training, profile };
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

  // CARTO의 무료 익명 다크 타일이 API 키를 요구하기 시작해서 Esri Dark Gray Canvas로 교체.
  // 키 없이 쓸 수 있고, base(지형) + reference(라벨) 2겹 구조도 그대로 유지된다.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; OpenStreetMap &copy; Esri',
    maxZoom: 19,
    maxNativeZoom: 16,
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    maxNativeZoom: 16,
    opacity: .55,
  }).addTo(map);

  // 지도를 클릭하면 스크롤 줌을 켜고, 지도를 벗어나면 다시 끈다
  map.on('click', () => map.scrollWheelZoom.enable());
  mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

  const layers = {};    // clusterId -> { line, hit, pin }
  const allBounds = [];

  clusters.forEach(c => {
    const color = c.hasRace ? RACE : VOLT;

    // 같은 코스를 길이만 늘려가며 달린 경우가 있다. 긴 것부터 옅게 깔고
    // 짧은 것을 위에 밝게 얹으면, 여러 번 지난 공통 구간이 가장 밝게 남고
    // 한 번만 다녀온 연장 구간이 옅어져 "점점 멀어진" 모양이 그대로 보인다.
    const byLength = c.runs.slice().sort((a, b) => b.distanceKm - a.distanceKm);
    const n = byLength.length;
    const baseWeight = c.hasRace ? 5 : 3;

    const lines = [];

    byLength.forEach((run, i) => {
      const latlngs = run.segments;
      allBounds.push(...latlngs.flat());

      // i 가 클수록(=짧을수록) 더 굵고 진하게
      const weight = baseWeight + i * 1.7;
      const opacity = n === 1 ? .95 : .45 + (i / (n - 1)) * .5;

      lines.push({
        run,
        weight,
        opacity,
        layer: L.polyline(latlngs, {
          color, weight, opacity,
          lineCap: 'round', lineJoin: 'round', interactive: false,
        }).addTo(map),
      });
    });

    // 얇은 선은 마우스로 잡기 어려워서 투명한 굵은 선을 겹쳐둔다.
    // 가장 긴 트랙에 걸어야 코스 전체가 잡힌다.
    const hit = L.polyline(byLength[0].segments, {
      color: '#000', weight: 26, opacity: 0, lineCap: 'round',
    }).addTo(map);

    let pin = null;
    if (c.hasRace) {
      pin = L.marker(byLength[0].segments[0][0], {
        icon: L.divIcon({ className: '', html: '<div class="racepin">🏅</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(map);
    }

    layers[c.clusterId] = { lines, hit, pin, color, cluster: c };

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
      l.lines.forEach(ln => {
        ln.layer.setStyle({
          opacity: on ? Math.min(1, ln.opacity + .25) : ln.opacity * .3,
          weight: on ? ln.weight + 2 : ln.weight,
        });
        if (on) ln.layer.bringToFront();
      });
    });

    document.querySelectorAll('.courseitem').forEach(el =>
      el.classList.toggle('is-active', el.dataset.cluster === clusterId));

    panelEmpty.hidden = true;
    panelBody.hidden = false;
    panelBody.innerHTML = panelHTML(layers[clusterId].cluster);
    panelBody.parentElement.scrollTop = 0;

    const toggle = panelBody.querySelector('[data-log-toggle]');
    if (toggle) {
      const rest = panelBody.querySelector('[data-log-rest]');
      const n = rest.children.length;
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        rest.hidden = open;
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.innerHTML = open
          ? `<span class="log-toggle__arrow">▸</span> 이전 기록 ${n}개 더 보기`
          : `<span class="log-toggle__arrow">▾</span> 접기`;
      });
    }
  }

  function clearFocus() {
    if (pinned) return;
    Object.values(layers).forEach(l => {
      l.lines.forEach(ln => ln.layer.setStyle({ opacity: ln.opacity, weight: ln.weight }));
    });
    document.querySelectorAll('.courseitem').forEach(el => el.classList.remove('is-active'));
    panelBody.hidden = true;
    panelEmpty.hidden = false;
  }

  // 레이어 사이를 지날 때마다 터지는 map 'mouseout' 대신 컨테이너 이탈만 본다
  mapEl.addEventListener('mouseleave', clearFocus);

  /** 같은 코스를 길이만 늘려가며 달렸는지 (가장 긴 쪽이 짧은 쪽의 1.5배 이상) */
  function isProgressive(runs) {
    if (runs.length < 2) return false;
    const d = runs.map(r => r.distanceKm);
    return Math.max(...d) / Math.min(...d) >= 1.5;
  }

  /** 점점 멀어지는 코스의 단계 목록. 줄마다 막대를 쌓으면 세로로 길어져
   *  패널이 지도보다 아래로 삐져나온다. 한 줄짜리 칩으로 압축한다. */
  function stagesHTML(c, runs) {
    if (!isProgressive(runs)) return '';
    const asc = runs.slice().sort((a, b) => a.distanceKm - b.distanceKm);
    const names = c.stages || [];
    return `
      <div class="stages">
        <p class="stages__title">${asc.length}단계로 늘려온 코스</p>
        <div class="stages__row">
          ${asc.map((r, i) => `
            <span class="stagechip">
              <i class="stagechip__no">${i + 1}</i>
              ${esc(names[i] || fmtDate(r.date))}
              <b>${fmtKm(r.distanceKm)}</b>
            </span>
            ${i < asc.length - 1 ? '<span class="stagechip__arrow">→</span>' : ''}`).join('')}
        </div>
      </div>`;
  }

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

      ${stagesHTML(c, runs)}

      ${runs.length > 1 && !isProgressive(runs) ? `
        <p class="panel__repeat">가장 길게 달린 날 · ${fmtDate(longest.date)}</p>` : ''}

      ${logHTML(runs, shoeName, isProgressive(runs) ? 1 : 2)}`;
  }

  /** 러닝 기록 하나를 카드로 그린다 */
  function entryHTML(r, shoeName) {
    return `
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
      </div>`;
  }

  /** 로그. 같은 코스를 자꾸 반복해서 기록이 3건을 넘어가면 지도 옆
   *  패널이 계속 늘어나 지도보다 아래로 삐져나온다. 최근 2건만 펼쳐
   *  두고 나머지는 접어서, 코스를 여러 번 뛰어도 패널 높이가 크게
   *  안 늘어나게 한다. */
  function logHTML(runs, shoeName, defaultShown) {
    // 단계형 코스는 위에 이미 stages 블록이 붙어있어 기본 노출을
    // 1건으로 줄인다. 그래도 지도 높이를 넘기면 그건 더 줄일 신호다.
    const shown = runs.slice(0, defaultShown);
    const rest = runs.slice(defaultShown);

    const shownHTML = shown.map(r => entryHTML(r, shoeName)).join('');
    if (!rest.length) {
      return `<div class="panel__log"><p class="panel__logtitle">LOG</p>${shownHTML}</div>`;
    }

    const restHTML = rest.map(r => entryHTML(r, shoeName)).join('');
    return `
      <div class="panel__log">
        <p class="panel__logtitle">LOG</p>
        ${shownHTML}
        <button type="button" class="log-toggle" data-log-toggle aria-expanded="false">
          <span class="log-toggle__arrow">▸</span> 이전 기록 ${rest.length}개 더 보기
        </button>
        <div class="log-rest" data-log-rest hidden>${restHTML}</div>
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
      map.fitBounds(layers[el.dataset.cluster].lines[0].layer.getBounds(), { padding: [60, 60] });
    });
  });
}

// ───────────────────────────────────────────── NEXT RACE

function renderRace({ race, training, profile }) {
  if (!race['일시'] || !training.length) return;

  const raceDate = new Date(race['일시']);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dday = Math.max(0, Math.round((raceDate - today) / 86400000));

  document.querySelector('[data-dday]').textContent = dday;
  document.querySelector('[data-race-desc]').textContent =
    `${race['대회명']} · ${fmtRaceDate(raceDate)}. 11주 훈련 계획과 그날까지의 기록.`;
  document.querySelector('[data-race-note]').textContent = race['한마디'] || '';

  document.querySelector('[data-race-facts]').innerHTML = [
    ['DISTANCE', race['거리km'], 'km'],
    ['GOAL TIME', race['목표시간'], ''],
    ['GOAL PACE', race['목표페이스'], '/km'],
  ].map(([k, v, u]) => `
    <div><dt>${k}</dt><dd>${esc(v)}<em>${u}</em></dd></div>`).join('');

  renderProgress(training, raceDate, today);
  renderGrowth(training, race);
  renderWeeks(training, today);
  renderProfile(profile);
}

/** '2026-08-17' -> '08.17' */
function fmtMD(iso) {
  return iso.slice(5).replace('-', '.');
}

function fmtRaceDate(d) {
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.` +
         `${String(d.getDate()).padStart(2, '0')} (${day})`;
}

/** 훈련 진행률: 지난 주차와 완료한 세션 */
function renderProgress(training, raceDate, today) {
  const total = training.length;
  const done = training.filter(t => t['상태'] === '완료').length;
  const missed = training.filter(t => t['상태'] === '미진행').length;
  const weeks = Math.max(...training.map(t => +t['주차']));
  const passed = new Set(training.filter(t => new Date(t['날짜']) <= today)
                                 .map(t => t['주차'])).size;

  // 계획 대비 실제로 달린 거리
  const planKm = training.filter(t => t['상태'])
    .reduce((a, t) => a + (parseFloat(t['계획km']) || 0), 0);
  const realKm = training.reduce((a, t) => a + (parseFloat(t['실제km']) || 0), 0);

  document.querySelector('[data-progress]').innerHTML = `
    <div class="prog__row">
      <div class="prog__item">
        <p class="prog__label">주차</p>
        <p class="prog__val">${passed}<em>/ ${weeks}</em></p>
      </div>
      <div class="prog__item">
        <p class="prog__label">완료한 훈련</p>
        <p class="prog__val">${done}<em>/ ${total}</em></p>
      </div>
      <div class="prog__item">
        <p class="prog__label">거른 훈련</p>
        <p class="prog__val">${missed}</p>
      </div>
      <div class="prog__item">
        <p class="prog__label">계획 대비</p>
        <p class="prog__val">${planKm ? Math.round((realKm / planKm) * 100) : 0}<em>%</em></p>
      </div>
    </div>
    <div class="prog__bar">
      <i style="width:${(done / total) * 100}%"></i>
      <b style="left:${(passed / weeks) * 100}%"></b>
    </div>`;
}

/** 롱런 거리 곡선. 쌓아 올렸다가 대회 전에 줄이는 흐름이 그대로 보인다. */
function renderGrowth(training, race) {
  const longs = training.filter(t => t['종류'] === '롱런' || t['종류'] === '대회');
  if (!longs.length) return;

  const W = 1000, H = 260, PAD_L = 40, PAD_R = 40, PAD_T = 34, PAD_B = 42;
  const maxKm = Math.max(...longs.map(t => parseFloat(t['계획km']) || 0)) * 1.12;
  const x = i => PAD_L + (i / (longs.length - 1)) * (W - PAD_L - PAD_R);
  const y = km => PAD_T + (1 - km / maxKm) * (H - PAD_T - PAD_B);

  const planPts = longs.map((t, i) => [x(i), y(parseFloat(t['계획km']) || 0)]);
  const line = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line(planPts)} L${x(longs.length - 1)},${H - PAD_B} L${PAD_L},${H - PAD_B} Z`;

  const dots = longs.map((t, i) => {
    const plan = parseFloat(t['계획km']) || 0;
    const real = parseFloat(t['실제km']);
    const isRace = t['종류'] === '대회';
    const done = !isNaN(real);
    return `
      ${done ? `<line class="growth__drop" x1="${x(i)}" y1="${y(plan)}" x2="${x(i)}" y2="${y(real)}"/>` : ''}
      <circle class="growth__dot ${isRace ? 'is-race' : done ? 'is-done' : 'is-plan'}"
              cx="${x(i)}" cy="${y(done ? real : plan)}" r="${isRace ? 7 : 5}"/>
      ${done && real !== plan
        ? `<text class="growth__val" x="${x(i)}" y="${y(real) + 18}">${real}</text>`
        : ''}
      <text class="growth__val ${isRace ? 'is-race' : ''}" x="${x(i)}" y="${y(plan) - 12}">${plan}</text>
      <text class="growth__x" x="${x(i)}" y="${H - PAD_B + 22}">${t['날짜'].slice(5).replace('-', '.')}</text>`;
  }).join('');

  document.querySelector('[data-growth]').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="롱런 거리 변화">
      <path class="growth__area" d="${area}"/>
      <path class="growth__line" d="${line(planPts)}"/>
      ${dots}
    </svg>`;
}

/** 주차별 카드. 지난 주는 눌러두고 이번 주를 표시한다. */
function renderWeeks(training, today) {
  const box = document.querySelector('[data-weeks]');
  const byWeek = new Map();
  training.forEach(t => {
    if (!byWeek.has(t['주차'])) byWeek.set(t['주차'], []);
    byWeek.get(t['주차']).push(t);
  });

  box.innerHTML = [...byWeek.entries()].map(([wk, rows]) => {
    // 주 범위는 세션 날짜가 아니라 주차의 시작/종료일로 판단한다.
    // 마지막 훈련이 토요일이어도 일요일까지는 그 주가 '이번 주'다.
    const start = new Date(rows[0]['시작일']);
    const end = new Date(rows[0]['종료일']);
    const isPast = end < today;
    const isNow = start <= today && today <= end;
    // 계획이 아니라 실제로 뛴 거리만 센다. 거른 훈련(미진행)은 0으로 취급한다.
    const started = rows.some(r => r['상태']);
    const actualKm = rows.reduce((a, r) => a + (parseFloat(r['실제km']) || 0), 0);
    const planKm = rows.reduce((a, r) => a + (parseFloat(r['계획km']) || 0), 0);
    const totalKm = started ? actualKm : planKm;
    const span = `${fmtMD(rows[0]['시작일'])} — ${fmtMD(rows[0]['종료일'])}`;

    return `
      <article class="week ${isPast ? 'is-past' : ''} ${isNow ? 'is-now' : ''}">
        <div class="week__head">
          <p class="week__no">WEEK ${wk}</p>
          ${isNow ? '<span class="week__now">이번 주</span>' : ''}
        </div>
        <p class="week__span">${span}</p>
        ${rows[0]['주제'] ? `<p class="week__theme">${esc(rows[0]['주제'])}</p>` : ''}
        <ul class="week__list">
          ${rows.map(r => {
            const st = r['상태'];
            const mark = st === '완료' ? '✓' : st === '미진행' ? '✕' : '';
            const real = parseFloat(r['실제km']);
            const plan = parseFloat(r['계획km']);
            const km = !isNaN(real) && real !== plan
              ? `<s>${plan}</s> ${real}km`
              : (r['계획km'] ? `${r['계획km']}km` : '');
            return `
              <li class="sess ${st === '완료' ? 'is-done' : ''} ${st === '미진행' ? 'is-missed' : ''}">
                <span class="sess__mark">${mark}</span>
                <span class="sess__body">
                  <b class="sess__kind" data-kind="${esc(r['종류'])}">${esc(r['종류'])}</b>
                  ${esc(r['훈련'])}
                </span>
                <span class="sess__km">${km}</span>
              </li>`;
          }).join('')}
        </ul>
        <p class="week__total ${started ? '' : 'is-plan'}">
          ${totalKm.toFixed(totalKm % 1 ? 1 : 0)}<em>km</em>
          ${started ? '' : '<i>예정</i>'}
        </p>
      </article>`;
  }).join('');

  // 세로 휠로도 밀리게 (메달 레일과 같은 방식)
  box.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = box.scrollWidth - box.clientWidth;
    const next = box.scrollLeft + e.deltaY;
    if (next < 0 || next > max) return;
    e.preventDefault();
    box.scrollLeft = next;
  }, { passive: false });

  // 이번 주가 보이도록 처음 위치를 맞춘다
  const focusCard = box.querySelector('.week.is-now')
    || box.querySelector('.week:not(.is-past)');
  if (focusCard) box.scrollLeft = Math.max(0, focusCard.offsetLeft - 24);
}

/** 대회 코스 고도 프로필 */
function renderProfile(profile) {
  if (!profile.length) return;
  const W = 1000, H = 210, PAD_B = 34, PAD_T = 34, PAD_X = 34;
  const maxKm = Math.max(...profile.map(p => parseFloat(p['km'])));
  const maxEl = Math.max(...profile.map(p => parseFloat(p['고도'])));
  const x = km => PAD_X + (km / maxKm) * (W - PAD_X * 2);
  const y = el => PAD_T + (1 - el / maxEl) * (H - PAD_T - PAD_B);
  // 양끝 라벨이 잘리지 않게 가장자리에서는 안쪽으로 붙인다
  const anchor = px => px < W * .12 ? 'start' : px > W * .88 ? 'end' : 'middle';

  const pts = profile.map(p => [x(parseFloat(p['km'])), y(parseFloat(p['고도']))]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${x(maxKm)},${H - PAD_B} L${x(0)},${H - PAD_B} Z`;

  const labels = profile.map(p => {
    if (!p['라벨']) return '';
    const px = x(parseFloat(p['km']));
    return `<text class="profile__label" text-anchor="${anchor(px)}" x="${px}" ` +
           `y="${y(parseFloat(p['고도'])) - 12}">${esc(p['라벨'])}</text>`;
  }).join('');

  const ticks = [0, 5, 10, 15, 20].map(km =>
    `<text class="profile__tick" text-anchor="${anchor(x(km))}" x="${x(km)}" ` +
    `y="${H - PAD_B + 22}">${km}km</text>`).join('');

  document.querySelector('[data-profile]').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="대청호 코스 고도 프로필">
      <path class="profile__area" d="${area}"/>
      <path class="profile__line" d="${line}"/>
      ${labels}${ticks}
    </svg>`;
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
    renderRace(data);
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
