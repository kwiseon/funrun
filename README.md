# FUN RUN — 러닝 아카이브

메달 · 신발 · 서울 코스를 한 페이지에 담은 정적 사이트.

## 지금 상태

- GPX 12개 (2026.02.20 — 2026.08.23) → 서울 **89.9km / 11회 / 8개 코스**
- 메달 8개 (2021 — 2026)
- 신발 3켤레
- 만족도·한줄평은 **전부 더미**입니다. 아래 ①을 채워주세요.

---

## 내가 채울 것

### ① 러닝 후기 — `data/runs.csv`

이 파일만 고치면 지도 툴팁 내용이 바뀝니다. **뒤 4칸**을 채워주세요.

| 칸 | 누가 채움 | 설명 |
|---|---|---|
| 날짜 / 코스 / 거리km / 대회 | 자동 | GPX에서 계산. 고쳐도 빌드하면 되돌아감 |
| **만족도** | 나 | `1`~`5`. 별점으로 표시 |
| **한줄평** | 나 | 쉼표가 들어가면 `"큰따옴표"`로 감싸기 |
| **운동화** | 나 | `shoe-01` / `shoe-02` / `shoe-03` |
| **사진** | 나 | 예: `images/photos/20260405.jpg` (아래 ③) |

지금 들어있는 한줄평은 제가 지어낸 더미이니 전부 지우고 새로 쓰셔도 됩니다.

### ② 신발 — `data/shoes.csv`

| id | 신발 | 어느 사진 |
|---|---|---|
| `shoe-01` | NIKE 리액트 이스케이프 런 (250) · 은퇴 | `shoe-01.jpg` |
| `shoe-02` | PUMA 디비에이트 나이트로 3 화이트실버 (255) · 주력 | `shoe-02.jpg` **왼쪽 아래** 크림색 |
| `shoe-03` | ASICS 젤카야노 33 우먼 D (255) · 주력 | `shoe-02.jpg` **오른쪽 위** 하늘색 |

`상태` 칸에 `은퇴` 를 적으면 사진이 흑백으로 눌리고 배지가 회색으로 바뀝니다.
그 외 값(`주력` 등)은 형광 배지로 나옵니다.

> 신발 사진은 2장인데 3켤레가 찍혀 있어서, `shoe-02.jpg` 한 장을 두 칸으로 잘라 씁니다.
> `크롭` 칸은 원본 대비 `x,y,너비,높이` (%) 입니다. **너비와 높이를 같게 두세요.**
> 원본 사진과 표시 칸이 모두 정사각이라, 크롭이 정사각이어야 비율이 안 눌립니다.
> 3켤레를 따로 찍은 사진이 있으면 `images/shoes/` 에 넣고 `사진` 칸만 바꾸면 됩니다.

### ③ 코스 사진 (선택)

`images/photos/` 에 넣고 `runs.csv` 의 `사진` 칸에 경로를 적으면 툴팁에 함께 뜹니다.
없으면 사진 영역은 그냥 빠집니다.

### ④ 메달 기록 (선택) — `data/medals.csv`

대회명·연도·종목은 채워뒀습니다. `기록`(완주 기록)과 `메모`가 비어 있어요.

---

## 고치면 좋을 것

- **코스 이름** — `build/build.py` 상단 `COURSE_NAMES`. 지금은 GPX 좌표를 보고
  제가 붙인 이름(`안양천 숏코스`, `종로 — 성북 언덕` 등)이라 실제로 부르는 이름과
  다를 수 있습니다. 고친 뒤 빌드하면 반영됩니다.
- **2026.03.21 일산 호수공원** — 서울이 아니라 지도·합계에서 빠져 있습니다
  (히어로 하단에 안내 문구가 뜹니다).

---

## 새 러닝을 추가하려면

1. GPX를 `map/` 에 넣습니다. 대회면 파일명에 `(대회)`를 포함시키세요.
   (예: `20261011_South Korea_이른아침 러닝(대회).gpx`)
2. 빌드합니다.

```bash
python3 build/build.py
```

`data/tracks.json` 이 새로 만들어지고, `data/runs.csv` 에 새 날짜 행이
자동으로 추가됩니다. 기존에 적어둔 만족도·한줄평은 그대로 보존됩니다.

## 메달 사진을 추가하려면

`images/medals/` 에 넣고 `data/medals.csv` 에 한 줄 추가.

배경을 지운 이미지인데 검은 화면에서 **흰 격자무늬가 보인다면**, 편집기의
투명 체커보드가 픽셀로 굳은 것입니다. 이걸로 걷어냅니다.

```bash
python3 build/clean_medal_bg.py
```

JPEG는 투명도를 담을 수 없으니 PNG로 바꾼 뒤 처리하세요. 압축 때문에
경계에 옅은 테두리가 남으면 `--bright` 를 조금씩 낮춰가며 다시 돌립니다.

```bash
sips -Z 800 -s format png medal/원본.jpeg --out images/medals/새이름.png
python3 build/clean_medal_bg.py --bright 185 images/medals/새이름.png
```

## 로컬에서 보기

`index.html` 을 그냥 더블클릭하면 됩니다.

CSV를 고치는 중이라면 서버로 여는 쪽이 편합니다. 서버로 열면 CSV 원본을 직접
읽어서 **새로고침만으로 수정이 반영**되고, 더블클릭으로 열면 `data/bundle.js`
사본을 읽으므로 `python3 build/build.py` 를 한 번 돌려야 반영됩니다.

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## 배포 (GitHub Pages)

이 폴더가 곧 저장소입니다. 푸시하고 Settings → Pages → Source를
`Deploy from a branch` → `main` / `/ (root)` 로 두면 끝입니다.
CI 빌드가 없고 `data/tracks.json` 과 `data/bundle.js` 가 이미 커밋되어 있습니다.

```bash
git remote add origin https://github.com/<아이디>/funrun.git
git push -u origin main
```

내용을 고친 뒤에는:

```bash
python3 build/build.py          # 데이터를 바꿨다면
git add -A && git commit -m "메모 업데이트" && git push
```

알아둘 것:

- 사이트 주소는 `https://<아이디>.github.io/funrun/` 입니다. 경로를 전부
  상대경로로 짜서 하위 경로에서도 그대로 동작합니다.
- 지도 배경은 CARTO 다크 타일을 불러오므로 **인터넷 연결이 필요**합니다.
- `.nojekyll` 이 있어서 Jekyll 처리를 건너뜁니다.
- **GPX에는 출발·도착 지점이 들어 있습니다.** 공개 저장소면 이 경로도
  함께 공개됩니다.
- 원본 사진(`medal/`, `shoes/`, `me.JPG`)은 `.gitignore` 로 빠져 있어
  **저장소에 백업되지 않습니다.** 로컬에만 있으니 따로 보관하세요.

---

## 구조

```
index.html              한 페이지 전부
assets/css/style.css    블랙 + 볼트(#d8ff00) 디자인
assets/js/app.js        CSV/JSON 로드, 지도, 상호작용
data/tracks.json        ← 빌드 산출물. 직접 고치지 마세요
data/bundle.js          ← 빌드 산출물. 서버 없이 열 때 쓰는 데이터 사본
data/runs.csv           ← ① 후기
data/shoes.csv          ← ② 신발
data/medals.csv         ← ④ 메달
build/build.py          GPX → tracks.json + runs.csv 동기화
build/clean_medal_bg.py 메달 PNG 체커보드 배경 제거
map/                    GPX 원본
medal/ shoes/ me.JPG    원본 사진 (웹에는 images/ 의 축소본을 씁니다)
```

`달리기 시트 - 코스.csv` 는 원래 있던 빈 시트입니다. 이제 `data/runs.csv` 가
그 역할을 하니 지우셔도 됩니다 (시작/종료 위치·거리·시간은 GPX에서 계산합니다).

### 코스를 어떻게 묶는지

트랙이 지나간 60m 격자를 비교해 Jaccard 유사도 0.40 이상이면 같은 코스로 봅니다.
가장 길게 달린 날의 경로만 지도에 그리고, 나머지는 툴팁 로그에 쌓입니다.
임계값은 `build/build.py` 의 `SIMILARITY_THRESHOLD`.

### 거리와 페이스 기준

GPX에 기록이 15초 넘게 끊긴 구간이 있으면 트랙을 거기서 자릅니다.
끊긴 사이의 이동은 거리에도 시간에도 넣지 않습니다.
이렇게 하지 않으면 실제로 달리지 않은 직선이 지도에 그려지고
(2026.08.23 코스에서 5.6km가 그랬습니다) 페이스도 4분대로 왜곡됩니다.
기준값은 `PAUSE_GAP_SEC`.
