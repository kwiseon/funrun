#!/usr/bin/env python3
"""메달 PNG 에 구워진 '배경 제거 체커보드'를 실제 투명으로 바꾼다.

배경을 지운 이미지를 저장할 때 편집기의 체커보드 미리보기가 그대로
픽셀로 굳어버린 경우가 있다 (알파가 전부 255). 검은 페이지에 올리면
흰 격자 사각형이 그대로 보인다.

테두리에서 시작해 밝은 회색/흰색이 이어지는 영역만 골라 투명하게 만든다.
메달 안쪽의 흰색은 테두리와 이어져 있지 않으므로 살아남는다.

사용법:  python3 build/clean_medal_bg.py images/medals/*.png
         python3 build/clean_medal_bg.py          # images/medals 전체 검사
         python3 build/clean_medal_bg.py --bright 190 파일.png

JPEG 를 sips 로 PNG 변환한 이미지는 압축 때문에 배경 경계가 뭉개져 옅은
테두리가 남을 수 있습니다. 그때 --bright 를 낮춰서 (기본 210) 다시 돌리세요.
너무 낮추면 메달 가장자리까지 깎이니 조금씩 내려보는 게 좋습니다.
"""

import glob
import os
import struct
import sys
import zlib
from collections import deque

# 배경으로 볼 밝기 하한과 채도 허용치
MIN_BRIGHT = 210
MAX_CHROMA = 16


# ─────────────────────────────────────────────── PNG 디코드 / 인코드

def decode_rgba(path):
    """8bit RGB / RGBA, non-interlaced PNG 를 RGBA 로 읽는다. 아니면 None.

    JPEG 원본은 `sips -s format png` 로 바꾸면 알파 없는 RGB PNG 가 되므로
    그것도 받아서 알파를 붙여준다."""
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    i, idat, hdr = 8, b"", None
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", d[i + 8:i + 8 + ln])
        elif typ == b"IDAT":
            idat += d[i + 8:i + 8 + ln]
        i += 12 + ln
    if not hdr:
        return None
    w, h, bd, ct, comp, filt, interlace = hdr
    if bd != 8 or interlace != 0 or ct not in (2, 6):
        return None

    raw = zlib.decompress(idat)
    bpp = 3 if ct == 2 else 4          # RGB 냐 RGBA 냐
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line

    if bpp == 3:                      # 알파를 붙여 RGBA 로 맞춘다
        rgba = bytearray(w * h * 4)
        for i in range(w * h):
            rgba[i * 4:i * 4 + 3] = out[i * 3:i * 3 + 3]
            rgba[i * 4 + 3] = 255
        out = rgba
    return w, h, out


def encode_rgba(path, w, h, px):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)                       # 필터 없음
        raw += px[y * stride:(y + 1) * stride]

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


# ─────────────────────────────────────────────── 배경 제거

def is_bg(px, o):
    r, g, b = px[o], px[o + 1], px[o + 2]
    return min(r, g, b) >= MIN_BRIGHT and max(r, g, b) - min(r, g, b) <= MAX_CHROMA


def strip_background(w, h, px):
    """테두리와 이어진 밝은 영역을 투명하게. 지운 픽셀 수를 반환."""
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not seen[i] and is_bg(px, i * 4):
            seen[i] = 1
            q.append(i)

    for x in range(w):
        push(x, 0); push(x, h - 1)
    for y in range(h):
        push(0, y); push(w - 1, y)

    removed = 0
    while q:
        i = q.popleft()
        px[i * 4 + 3] = 0
        removed += 1
        x, y = i % w, i // w
        if x > 0:     push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0:     push(x, y - 1)
        if y < h - 1: push(x, y + 1)

    # 경계에 남는 밝은 테두리(체커보드 잔상)를 한 겹 반투명 처리
    softened = 0
    for i in range(w * h):
        if px[i * 4 + 3] == 0:
            continue
        x, y = i % w, i // w
        touches = ((x > 0 and px[(i - 1) * 4 + 3] == 0) or
                   (x < w - 1 and px[(i + 1) * 4 + 3] == 0) or
                   (y > 0 and px[(i - w) * 4 + 3] == 0) or
                   (y < h - 1 and px[(i + w) * 4 + 3] == 0))
        if touches and is_bg(px, i * 4):
            px[i * 4 + 3] = 0
            softened += 1
    return removed + softened


def main():
    global MIN_BRIGHT
    args = sys.argv[1:]
    if "--bright" in args:
        i = args.index("--bright")
        MIN_BRIGHT = int(args[i + 1])
        del args[i:i + 2]
        print(f"  (밝기 기준 {MIN_BRIGHT})")

    paths = args or sorted(glob.glob("images/medals/*.png"))
    for p in paths:
        img = decode_rgba(p)
        if not img:
            print(f"  skip (8bit RGBA PNG 아님): {p}")
            continue
        w, h, px = img

        if any(px[i] != 255 for i in range(3, len(px), 4)):
            print(f"  skip (이미 투명도가 있음): {os.path.basename(p)}")
            continue

        n = strip_background(w, h, px)
        if n < w * h * 0.02:
            print(f"  skip (지울 배경 없음): {os.path.basename(p)}")
            continue

        encode_rgba(p, w, h, px)
        print(f"  cleaned {os.path.basename(p)}: "
              f"{n:,}px 투명 처리 ({n / (w * h) * 100:.0f}%), "
              f"{os.path.getsize(p) / 1024:.0f}KB")


if __name__ == "__main__":
    main()
