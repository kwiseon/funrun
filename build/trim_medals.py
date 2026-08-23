#!/usr/bin/env python3
"""메달 PNG 의 투명 여백을 잘라낸다.

배경을 지운 이미지에는 캔버스 안에서 메달이 한쪽으로 치우쳐 있거나
위아래에 빈 공간이 남아있는 경우가 많다. 그대로 두면 메달장 레일에서
걸이 끈과 메달이 어긋나 보인다. 실제 픽셀이 있는 영역만 남긴다.

사용법:  python3 build/trim_medals.py
         python3 build/trim_medals.py images/medals/어떤파일.png
"""

import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_medal_bg import decode_rgba, encode_rgba

ALPHA_FLOOR = 8      # 이보다 옅은 픽셀은 여백으로 본다
PAD = 2              # 잘라낸 뒤 남겨둘 최소 여유(px)


def content_box(w, h, px):
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w
        for x in range(w):
            if px[(row + x) * 4 + 3] > ALPHA_FLOOR:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    return minx, miny, maxx, maxy


def crop(w, h, px, box):
    x0, y0, x1, y1 = box
    nw, nh = x1 - x0 + 1, y1 - y0 + 1
    out = bytearray(nw * nh * 4)
    for y in range(nh):
        src = ((y + y0) * w + x0) * 4
        dst = y * nw * 4
        out[dst:dst + nw * 4] = px[src:src + nw * 4]
    return nw, nh, out


def main():
    paths = sys.argv[1:] or sorted(glob.glob("images/medals/*.png"))
    for p in paths:
        img = decode_rgba(p)
        if not img:
            print(f"  skip (8bit PNG 아님): {os.path.basename(p)}")
            continue
        w, h, px = img
        minx, miny, maxx, maxy = content_box(w, h, px)
        if maxx < 0:
            print(f"  skip (내용 없음): {os.path.basename(p)}")
            continue

        x0 = max(0, minx - PAD); y0 = max(0, miny - PAD)
        x1 = min(w - 1, maxx + PAD); y1 = min(h - 1, maxy + PAD)
        if (x0, y0, x1, y1) == (0, 0, w - 1, h - 1):
            print(f"  skip (여백 없음): {os.path.basename(p)}")
            continue

        nw, nh, out = crop(w, h, px, (x0, y0, x1, y1))
        encode_rgba(p, nw, nh, out)
        print(f"  trimmed {os.path.basename(p)}: {w}x{h} -> {nw}x{nh}  "
              f"({os.path.getsize(p) / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
