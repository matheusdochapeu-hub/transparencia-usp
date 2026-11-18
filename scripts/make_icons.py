#!/usr/bin/env python3
"""Gera ícones da PWA (PNG) e o favicon SVG."""

from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "icons")
os.makedirs(OUT, exist_ok=True)

C1 = (162, 28, 71)   # #a21c47
C2 = (107, 16, 41)   # #6b1029


def gradient(size: int) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size]
    t = (x + y) / (2 * (size - 1))
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    for i in range(3):
        arr[:, :, i] = (C1[i] + (C2[i] - C1[i]) * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB").convert("RGBA")


def bars(draw: ImageDraw.ImageDraw, size: int, scale: float = 1.0):
    """Três barras ascendentes centralizadas."""
    base = size / 32
    w = 4.5 * base * scale
    gap = 2.25 * base * scale
    total_w = 3 * w + 2 * gap
    x0 = (size - total_w) / 2
    heights = [8 * base * scale, 13 * base * scale, 18 * base * scale]
    bottom = size / 2 + 9 * base * scale
    radius = 1.4 * base * scale
    for i, h in enumerate(heights):
        x = x0 + i * (w + gap)
        draw.rounded_rectangle([x, bottom - h, x + w, bottom], radius=radius, fill=(255, 255, 255, 242))


def make(size: int, maskable: bool = False) -> Image.Image:
    img = gradient(size)
    d = ImageDraw.Draw(img)
    if maskable:
        # conteúdo dentro da zona segura (80% do lado)
        bars(d, size, scale=0.72)
    else:
        bars(d, size, scale=1.0)
        # máscara arredondada
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
        img.putalpha(mask)
    return img


for s in (192, 512, 180):
    make(s).save(os.path.join(OUT, f"icon-{s}.png"))
make(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"))
# favicon 32
make(64).save(os.path.join(OUT, "favicon-64.png"))

favicon = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
    <stop stop-color="#a21c47"/><stop offset="1" stop-color="#6b1029"/>
  </linearGradient></defs>
  <rect width="32" height="32" rx="7" fill="url(#g)"/>
  <rect x="7" y="17" width="4.5" height="8" rx="1.2" fill="#fff"/>
  <rect x="13.75" y="12" width="4.5" height="13" rx="1.2" fill="#fff"/>
  <rect x="20.5" y="7" width="4.5" height="18" rx="1.2" fill="#fff"/>
</svg>
"""
with open(os.path.join(OUT, "favicon.svg"), "w", encoding="utf-8") as fh:
    fh.write(favicon)

print("ícones gerados em", OUT)
