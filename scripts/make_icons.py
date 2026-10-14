"""Draws the iNaturalistGG icon at every size the stores need: python scripts/make_icons.py public/icon"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
FONT = next(p for p in [r'C:\Windows\Fonts\seguibl.ttf', r'C:\Windows\Fonts\arialbd.ttf'] if os.path.exists(p))
GREEN_TOP, GREEN_BOTTOM = (138, 196, 18), (88, 140, 0)
GOLD = (255, 214, 48)

def star(cx, cy, r):
    import math
    pts = []
    for i in range(10):
        rad = r if i % 2 == 0 else r * 0.45
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return pts

def draw(size):
    S = 512  # draw large, then downsample for smooth edges
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(GREEN_TOP, GREEN_BOTTOM)) + (255,))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([8, 8, S - 8, S - 8], radius=110, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 250)
    text = 'GG'
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x, y = (S - w) / 2 - box[0], (S - h) / 2 - box[1] + 30
    d.text((x + 4, y + 7), text, font=font, fill=(52, 92, 0, 255))  # soft shadow
    d.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    if size >= 32:
        d.polygon(star(S - 120, 118, 70), fill=GOLD + (255,), outline=(160, 120, 0, 255))
    return img.resize((size, size), Image.LANCZOS)

for size in (16, 32, 48, 96, 128):
    draw(size).save(os.path.join(out_dir, f'{size}.png'))

print('icons written to', out_dir)
