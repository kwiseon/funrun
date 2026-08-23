#!/usr/bin/env python3
"""GPX -> data/tracks.json 빌더.

map/*.gpx 를 읽어서
  - 거리 / 시간 / 페이스 계산
  - Douglas-Peucker 로 좌표 단순화 (웹 로딩용 경량화)
  - 비슷한 코스끼리 클러스터링 (그리드 Jaccard 유사도)
하고 data/tracks.json 으로 떨군다.

사용법:  python3 build/build.py
"""

import csv
import json
import math
import os
import re
import unicodedata
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_DIR = os.path.join(ROOT, "map")
OUT = os.path.join(ROOT, "data", "tracks.json")

KST = timezone(timedelta(hours=9))

# 단순화 허용 오차(m). 작을수록 원본에 가깝고 파일이 커진다.
SIMPLIFY_TOLERANCE_M = 8.0
# 코스 중복 판정용 그리드 한 칸 크기(m)
GRID_SIZE_M = 60.0
# 이 값 이상 겹치면 "같은 코스"로 묶는다.
SIMILARITY_THRESHOLD = 0.40

# 지도에서 제외할 지역 (서울 밖). bbox 로 판정.
SEOUL_BBOX = (37.42, 126.76, 37.71, 127.19)  # min_lat, min_lon, max_lat, max_lon

# 클러스터 대표 코스에 붙일 이름. 대표 트랙의 날짜를 키로 쓴다.
# 새 GPX 가 들어와 대표가 바뀌면 여기도 갱신해주면 된다.
COURSE_NAMES = {
    "2026-02-20": "여의도 — 반포 한강",
    "2026-03-21": "일산 호수공원",
    "2026-04-05": "광화문 — 동대문",
    "2026-05-16": "한강 — 성수 롱런",
    "2026-05-30": "안양천 숏코스",
    "2026-06-03": "안양천 — 한강 합수부",
    "2026-07-24": "성북천 이지런",
    "2026-07-26": "청계천 상류",
    "2026-08-23": "종로 — 성북 언덕",
}


# ---------------------------------------------------------------- 기하 유틸

def haversine(a, b):
    """두 (lat, lon) 사이 거리(m). 짧은 구간이라 등거리 근사로 충분하다."""
    lat1, lon1 = a
    lat2, lon2 = b
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return math.hypot(x, y) * 6371000


def perpendicular_distance(pt, start, end):
    """start-end 선분에서 pt 까지의 수직거리(m)."""
    if start == end:
        return haversine(pt, start)
    # 위경도를 로컬 평면(m)으로 투영해서 계산
    lat0 = math.radians(start[0])
    mx = 111320 * math.cos(lat0)
    my = 110540

    def to_xy(p):
        return (p[1] * mx, p[0] * my)

    px, py = to_xy(pt)
    ax, ay = to_xy(start)
    bx, by = to_xy(end)
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def douglas_peucker(points, tolerance):
    if len(points) < 3:
        return points[:]
    # 재귀 대신 스택으로 (트랙이 길어 재귀 한도에 걸린다)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        max_dist, index = 0.0, first
        for i in range(first + 1, last):
            d = perpendicular_distance(points[i], points[first], points[last])
            if d > max_dist:
                max_dist, index = d, i
        if max_dist > tolerance:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep) if k]


# ---------------------------------------------------------------- GPX 파싱

TRKPT_RE = re.compile(r'lat="([-\d.]+)"\s+lon="([-\d.]+)"')
TIME_RE = re.compile(r"<time>(.*?)</time>")


def parse_gpx(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    points = [(float(a), float(b)) for a, b in TRKPT_RE.findall(raw)]
    times = TIME_RE.findall(raw)
    # 첫 <time> 이 metadata 에 있는 경우가 있어 개수로 맞춰본다
    if len(times) > len(points):
        times = times[len(times) - len(points):]
    return points, times


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def track_distance(points):
    return sum(haversine(points[i - 1], points[i]) for i in range(1, len(points)))


# 이보다 큰 시간 간격은 기록이 끊긴 것으로 보고 트랙을 잘라낸다
PAUSE_GAP_SEC = 15


def split_segments(points, stamps):
    """기록이 끊긴 지점에서 트랙을 나눈다.

    일시정지나 GPS 두절 사이에 위치가 크게 바뀌는 경우가 있다
    (한 코스에서 5.6km 가 이렇게 건너뛰었다). 이어서 그리면 지도에
    달린 적 없는 직선이 생기고, 그 거리가 시간 없이 더해져 페이스도
    망가진다. 끊어서 각각을 따로 다룬다."""
    segs, cur = [], [0]
    for i in range(1, len(points)):
        dt = (stamps[i] - stamps[i - 1]).total_seconds()
        if dt <= 0 or dt > PAUSE_GAP_SEC:
            if len(cur) > 1:
                segs.append(cur)
            cur = [i]
        else:
            cur.append(i)
    if len(cur) > 1:
        segs.append(cur)
    return segs


# ---------------------------------------------------------------- 클러스터링

def grid_cells(points, size_m):
    """트랙이 지나간 격자 칸 집합. 코스 유사도 비교용."""
    cells = set()
    for lat, lon in points:
        lat_step = size_m / 110540
        lon_step = size_m / (111320 * math.cos(math.radians(lat)))
        cells.add((int(lat / lat_step), int(lon / lon_step)))
    return cells


def similarity(a, b):
    """Jaccard 유사도. overlap coefficient 는 짧은 코스를 긴 코스에 통째로
    흡수시켜서 안 쓴다 (2km 러닝이 14km 러닝과 0.95 가 나온다)."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cluster(runs):
    """긴 코스부터 대표로 세우고, 나머지를 가장 비슷한 대표에 붙인다.

    연결 요소(union-find)로 묶으면 A~B, B~C 가 각각 임계값을 넘을 때
    A~C 가 전혀 안 닮았어도 한 덩어리가 되어버린다. 대표와만 비교해서
    이 체인 병합을 막는다."""
    order = sorted(range(len(runs)), key=lambda i: -runs[i]["distanceKm"])
    reps = []          # 각 클러스터의 대표 인덱스
    groups = []        # 각 클러스터의 멤버 인덱스 목록

    for i in order:
        best_score, best_group = 0.0, None
        for gi, rep in enumerate(reps):
            s = similarity(runs[i]["_cells"], runs[rep]["_cells"])
            if s > best_score:
                best_score, best_group = s, gi
        if best_group is not None and best_score >= SIMILARITY_THRESHOLD:
            groups[best_group].append(i)
            print(f"  merge: {runs[i]['date']} -> {runs[reps[best_group]]['date']}"
                  f"  (jaccard {best_score:.2f})")
        else:
            reps.append(i)
            groups.append([i])
    return groups


# ---------------------------------------------------------------- 메인

def in_seoul(bbox):
    min_lat, min_lon, max_lat, max_lon = bbox
    s = SEOUL_BBOX
    # 트랙 중심이 서울 bbox 안에 있으면 서울로 본다
    clat, clon = (min_lat + max_lat) / 2, (min_lon + max_lon) / 2
    return s[0] <= clat <= s[2] and s[1] <= clon <= s[3]


RUNS_CSV = os.path.join(ROOT, "data", "runs.csv")
# 앞 4개는 GPX 에서 자동으로 채우는 참고용, 뒤 4개는 사람이 적는 칸
CSV_FIELDS = ["날짜", "코스", "거리km", "대회", "만족도", "한줄평", "운동화", "사진"]
CSV_AUTO = {"날짜", "코스", "거리km", "대회"}


def sync_runs_csv(runs, clusters):
    """runs.csv 의 참고 컬럼을 최신 계산값으로 맞추고, 새 러닝은 빈 행으로 추가한다.
    사람이 적은 만족도/한줄평/운동화/사진 은 날짜를 기준으로 그대로 보존한다."""
    kept = {}
    if os.path.exists(RUNS_CSV):
        with open(RUNS_CSV, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if row.get("날짜"):
                    kept[row["날짜"].strip()] = row

    name_of = {rid: c["name"] for c in clusters for rid in c["runIds"]}

    added = 0
    rows = []
    for r in sorted(runs, key=lambda r: r["date"]):
        old = kept.get(r["date"])
        if old is None:
            added += 1
        row = {k: (old or {}).get(k, "") for k in CSV_FIELDS if k not in CSV_AUTO}
        row["날짜"] = r["date"]
        row["코스"] = name_of.get(r["id"], "")
        row["거리km"] = f"{r['distanceKm']:.2f}"
        row["대회"] = "대회" if r["isRace"] else ""
        rows.append(row)

    with open(RUNS_CSV, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)

    print(f"-> data/runs.csv 동기화 ({len(rows)}행"
          + (f", 새 러닝 {added}개 추가" if added else "") + ")")


BUNDLE_JS = os.path.join(ROOT, "data", "bundle.js")


def write_bundle():
    """data/bundle.js — 브라우저가 fetch 를 막을 때 쓰는 사본.

    index.html 을 서버 없이 더블클릭으로 열면 file:// 에서는 CORS 때문에
    fetch 가 전부 실패해서 화면이 텅 빈다. <script> 로 읽는 이 파일이
    있으면 그 경우에도 똑같이 보인다. 서버로 열면 CSV 원본이 우선이라
    수정이 새로고침만으로 반영된다."""
    def read(name):
        p = os.path.join(ROOT, "data", name)
        return open(p, encoding="utf-8").read() if os.path.exists(p) else ""

    payload = {
        "tracks": json.load(open(OUT, encoding="utf-8")),
        "runsCsv": read("runs.csv"),
        "shoesCsv": read("shoes.csv"),
        "medalsCsv": read("medals.csv"),
    }
    with open(BUNDLE_JS, "w", encoding="utf-8") as f:
        f.write("/* build.py 가 만듭니다. 직접 고치지 마세요. */\n")
        f.write("window.FUNRUN_BUNDLE = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"-> data/bundle.js ({os.path.getsize(BUNDLE_JS) / 1024:.0f}KB, "
          f"서버 없이 열 때 사용)")


def main():
    files = sorted(f for f in os.listdir(MAP_DIR) if f.lower().endswith(".gpx"))
    runs = []

    print(f"GPX {len(files)}개 파싱 중...")
    for raw_name in files:
        # macOS 는 파일명을 NFD 로 저장한다. 그대로 두면 "(대회)" 같은
        # 한글 리터럴 비교가 전부 실패한다.
        name = unicodedata.normalize("NFC", raw_name)
        points, times = parse_gpx(os.path.join(MAP_DIR, raw_name))
        if len(points) < 2:
            print(f"  skip (포인트 부족): {name}")
            continue

        date_str = name[:8]
        is_race = "(대회)" in name

        stamps = [parse_iso(t) for t in times]
        start = stamps[0].astimezone(KST)
        end = stamps[-1].astimezone(KST)
        elapsed_s = int((end - start).total_seconds())

        # 끊긴 구간을 뺀, 실제로 달린 거리와 시간만 센다
        segments = split_segments(points, stamps)
        seg_points = [[points[i] for i in seg] for seg in segments]
        distance_m = sum(track_distance(sp) for sp in seg_points)
        duration_s = int(sum(
            (stamps[seg[-1]] - stamps[seg[0]]).total_seconds() for seg in segments))
        if not distance_m:
            print(f"  skip (유효 구간 없음): {name}")
            continue

        used = [p for sp in seg_points for p in sp]
        lats = [p[0] for p in used]
        lons = [p[1] for p in used]
        bbox = (min(lats), min(lons), max(lats), max(lons))

        simplified = [douglas_peucker(sp, SIMPLIFY_TOLERANCE_M) for sp in seg_points]
        n_simple = sum(len(s) for s in simplified)

        runs.append({
            "id": date_str,
            "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}",
            "file": name,
            "isRace": is_race,
            "startTime": start.strftime("%H:%M"),
            "distanceKm": round(distance_m / 1000, 2),
            "durationSec": duration_s,     # 이동 시간
            "elapsedSec": elapsed_s,       # 시작~종료 경과 시간
            "paceSecPerKm": int(duration_s / (distance_m / 1000)) if distance_m > 100 else 0,
            "bbox": [round(v, 6) for v in bbox],
            "inSeoul": in_seoul(bbox),
            # 끊긴 구간마다 하나씩. 지도에서는 이어지지 않은 선으로 그린다.
            "segments": [[[round(la, 5), round(lo, 5)] for la, lo in seg]
                         for seg in simplified],
            "_cells": grid_cells(used, GRID_SIZE_M),
        })
        pace = duration_s / (distance_m / 1000)
        gap = " ⚠끊김" if len(segments) > 3 else ""
        print(f"  {name[:30]:32s} {distance_m/1000:6.2f}km  "
              f"{int(pace//60)}'{int(pace%60):02d}\"/km  "
              f"이동 {duration_s//60:3d}분 / 경과 {elapsed_s//60:3d}분  "
              f"{len(points):5d}->{n_simple:4d}pt  "
              f"{len(segments)}구간{gap}  "
              f"{'서울' if in_seoul(bbox) else '서울 밖'}")

    print("\n코스 클러스터링...")
    groups = cluster(runs)

    clusters = []
    for gi, idxs in enumerate(groups):
        members = sorted((runs[i] for i in idxs), key=lambda r: -r["distanceKm"])
        rep = members[0]
        clusters.append({
            "clusterId": f"c{gi:02d}",
            "name": COURSE_NAMES.get(rep["date"], f"코스 {gi + 1}"),
            "repRunId": rep["id"],
            "runCount": len(members),
            "runIds": [m["id"] for m in sorted(members, key=lambda r: r["date"])],
            "totalKm": round(sum(m["distanceKm"] for m in members), 2),
            "hasRace": any(m["isRace"] for m in members),
        })

    for r in runs:
        del r["_cells"]

    cluster_of = {rid: c["clusterId"] for c in clusters for rid in c["runIds"]}
    for r in runs:
        r["clusterId"] = cluster_of[r["id"]]

    seoul_runs = [r for r in runs if r["inSeoul"]]
    payload = {
        "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "summary": {
            "firstDate": min(r["date"] for r in seoul_runs),
            "lastDate": max(r["date"] for r in seoul_runs),
            "runCount": len(seoul_runs),
            "totalKm": round(sum(r["distanceKm"] for r in seoul_runs), 1),
            "raceCount": sum(1 for r in seoul_runs if r["isRace"]),
            "totalKmAll": round(sum(r["distanceKm"] for r in runs), 1),
            "excludedCount": len(runs) - len(seoul_runs),
        },
        "clusters": clusters,
        "runs": runs,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    sync_runs_csv(runs, clusters)
    write_bundle()

    print(f"\n{len(clusters)}개 코스 / {len(runs)}개 러닝")
    print(f"서울 {payload['summary']['totalKm']}km ({len(seoul_runs)}회), "
          f"제외 {payload['summary']['excludedCount']}회")
    print(f"-> data/tracks.json ({size_kb:.0f}KB)")


if __name__ == "__main__":
    main()
