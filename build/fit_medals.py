#!/usr/bin/env python3
"""메달이 화면에서 비슷한 크기로 보이도록 리본 길이를 맞춘다.

메달은 정사각 칸에 object-fit: contain 으로 들어간다. 세로로 긴 이미지라
표시 배율은 '이미지 높이'가 정하는데, 리본이 길게 찍힌 사진일수록 메달 본체가
작아 보인다 (빵빵런은 리본이 65% 를 차지해 다른 메달의 절반 크기로 보였다).

'메달 최대 폭 / 이미지 높이' 가 기준값이 되도록 위쪽 리본을 잘라낸다.
기준값 0.61 은 2024 춘천마라톤 메달에서 가져왔다.

이미 기준보다 크게 보이는 메달은 건드리지 않는다 (리본을 늘릴 수는 없으므로).

사용법:  python3 build/fit_medals.py
         python3 build/fit_medals.py --target 0.61 images/medals/어떤파일.png
"""

import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_medal_bg import decode_rgba, encode_rgba

TARGET = 0.61        # 메달 최대 폭 / 이미지 높이
TOLERANCE = 0.02     # 이 안에 들면 그대로 둔다
ALPHA_FLOOR = 8


def max_opaque_width(w, h, px):
    best = 0
    for y in range(h):
        row = y * w
        xs = [x for x in range(w) if px[(row + x) * 4 + 3] > ALPHA_FLOOR]
        if xs:
            best = max(best, xs[-1] - xs[0] + 1)
    return best


def main():
    args = sys.argv[1:]
    target = TARGET
    if "--target" in args:
        i = args.index("--target")
        target = float(args[i + 1])
        del args[i:i + 2]

    paths = args or sorted(glob.glob("images/medals/*.png"))
    for p in paths:
        img = decode_rgba(p)
        if not img:
            print(f"  skip (8bit PNG 아님): {os.path.basename(p)}")
            continue
        w, h, px = img
        mw = max_opaque_width(w, h, px)
        ratio = mw / h

        if ratio >= target - TOLERANCE:
            print(f"  keep {os.path.basename(p):24s} 비율 {ratio:.2f} (기준 {target})")
            continue

        new_h = round(mw / target)
        cut = h - new_h
        out = px[cut * w * 4:]          # 위쪽 리본을 잘라낸다
        encode_rgba(p, w, new_h, out)
        print(f"  fit  {os.path.basename(p):24s} 비율 {ratio:.2f} -> {mw / new_h:.2f}  "
              f"리본 {cut}px 잘라냄  {w}x{h} -> {w}x{new_h}")


if __name__ == "__main__":
    main()
