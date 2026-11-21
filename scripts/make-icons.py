"""Generate ShiftPay app icons from geometry (no fonts, no external art).

Mark: an amber clock ring with a gap (a shift on the clock face) around a
geometric pound sign. Colours come from src/theme/tokens.ts (light theme).

Run from the repo root:  python scripts/make-icons.py
Writes every PNG in assets/images/ plus .work/R1-app-icon/preview.png.
Everything is drawn at 4x and downsampled for anti-aliasing.
"""

import math
import os

from PIL import Image, ImageDraw

INK = (0x15, 0x21, 0x2C, 255)
SIGNAL = (0xF5, 0xB7, 0x00, 255)
BOARD = (0xE9, 0xED, 0xF1, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

SS = 4  # supersampling factor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "images")
PREVIEW = os.path.join(ROOT, ".work", "R1-app-icon", "preview.png")

# Ring gap (PIL angles: 0 = 3 o'clock, clockwise). Gap sits around 1 o'clock.
GAP_FROM, GAP_TO = -85, -35


def _cap(d, x, y, w, fill):
    d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=fill)


def _line(d, p0, p1, w, fill):
    d.line([p0, p1], fill=fill, width=round(w))
    _cap(d, *p0, w, fill)
    _cap(d, *p1, w, fill)


def _arc(d, cx, cy, rad, start, end, w, fill):
    """Stroke centred on radius `rad`, with round caps."""
    o = rad + w / 2
    d.arc([cx - o, cy - o, cx + o, cy + o], start, end, fill=fill, width=round(w))
    for a in (start, end):
        t = math.radians(a)
        _cap(d, cx + rad * math.cos(t), cy + rad * math.sin(t), w, fill)


def draw_mark(d, cx, cy, r, ring, glyph):
    """Draw the mark inside a circle of radius r centred on (cx, cy)."""
    rw = 0.14 * r
    _arc(d, cx, cy, r - rw / 2, GAP_TO, 360 + GAP_FROM, rw, ring)

    t = 0.13 * r  # pound-sign stroke
    gy = cy + 0.05 * r  # optical centring of the glyph
    sx = cx - 0.17 * r  # stem x
    hook_c = (sx + 0.25 * r, gy - 0.22 * r)
    _arc(d, hook_c[0], hook_c[1], 0.25 * r, 180, 335, t, glyph)
    _line(d, (sx, gy - 0.22 * r), (sx, gy + 0.36 * r), t, glyph)
    _line(d, (sx - 0.14 * r, gy + 0.36 * r), (cx + 0.36 * r, gy + 0.36 * r), t, glyph)
    _line(d, (cx - 0.36 * r, gy + 0.04 * r), (cx + 0.12 * r, gy + 0.04 * r), t, glyph)


def render(w, h, bg, mark_r_frac, ring, glyph, rounded=None):
    """mark_r_frac is the mark radius as a fraction of min(w, h)."""
    W, H = w * SS, h * SS
    im = Image.new("RGBA", (W, H), CLEAR)
    d = ImageDraw.Draw(im)
    if bg is not None:
        if rounded:
            d.rounded_rectangle([0, 0, W - 1, H - 1], radius=rounded * min(W, H), fill=bg)
        else:
            d.rectangle([0, 0, W, H], fill=bg)
    if ring is not None:
        draw_mark(d, W / 2, H / 2, mark_r_frac * min(W, H), ring, glyph)
    return im.resize((w, h), Image.LANCZOS)


def save(im, name, mode="RGBA"):
    path = os.path.join(OUT, name)
    im.convert(mode).save(path, optimize=True)
    return path


def mask(size, kind):
    W = size * SS
    m = Image.new("L", (W, W), 0)
    if kind == "circle":
        ImageDraw.Draw(m).ellipse([0, 0, W - 1, W - 1], fill=255)
    else:  # squircle, superellipse n=4
        px = m.load()
        h = W / 2
        for y in range(W):
            ny = abs((y + 0.5 - h) / h) ** 4
            for x in range(W):
                if abs((x + 0.5 - h) / h) ** 4 + ny <= 1:
                    px[x, y] = 255
    return m.resize((size, size), Image.LANCZOS)


def launcher_view(bg, fg, size, kind):
    """What a launcher shows: central 72/108 of the layers, masked."""
    comp = Image.alpha_composite(bg, fg)
    n = comp.width
    vis = round(n * 72 / 108)
    off = (n - vis) // 2
    crop = comp.crop((off, off, off + vis, off + vis)).resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), CLEAR)
    out.paste(crop, (0, 0), mask(size, kind))
    return out


def checker(w, h, s=8):
    im = Image.new("RGBA", (w, h), (200, 200, 200, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range((y // s % 2) * s, w, 2 * s):
            d.rectangle([x, y, x + s - 1, y + s - 1], fill=(235, 235, 235, 255))
    return im


def main():
    assets = {}
    # Legacy / iOS icon: full-bleed, opaque.
    assets["icon.png"] = render(1024, 1024, INK, 0.34, SIGNAL, BOARD)
    # Adaptive layers (108dp canvas; safe zone = central 66dp circle, r = 0.306).
    assets["android-icon-background.png"] = render(512, 512, INK, 0, None, None)
    assets["android-icon-foreground.png"] = render(512, 512, None, 0.28, SIGNAL, BOARD)
    assets["android-icon-monochrome.png"] = render(432, 432, None, 0.28, WHITE, WHITE)
    # Splash: transparent artwork on the splash backgroundColor (ink).
    assets["splash-icon.png"] = render(228, 213, None, 0.48, SIGNAL, BOARD)
    # Notification: white silhouette; Android tints it.
    assets["notification-icon.png"] = render(232, 232, None, 0.44, WHITE, WHITE)
    # Favicon: rounded tile so it reads on any tab colour.
    assets["favicon.png"] = render(48, 48, INK, 0.40, SIGNAL, BOARD, rounded=0.22)

    for name, im in assets.items():
        save(im, name)
    store = render(512, 512, INK, 0.34, SIGNAL, BOARD)
    save(store, "store-icon-512.png", mode="RGB")
    assets["store-icon-512.png"] = store

    # Contact sheet.
    bg, fg = assets["android-icon-background.png"], assets["android-icon-foreground.png"]
    cell, pad, label = 220, 16, 18
    tiles = [(n, im) for n, im in assets.items()]
    for kind in ("circle", "squircle"):
        for sz in (48, 192):
            tiles.append((f"{kind} {sz}px", launcher_view(bg, fg, sz, kind)))
    cols = 4
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGBA", (cols * (cell + pad) + pad, rows * (cell + label + pad) + pad), BOARD)
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(tiles):
        x = pad + (i % cols) * (cell + pad)
        y = pad + (i // cols) * (cell + label + pad)
        back = checker(cell, cell)
        if name.startswith(("notification", "android-icon-monochrome")):
            back = Image.new("RGBA", (cell, cell), (60, 64, 72, 255))
        elif name.startswith("splash"):
            back = Image.new("RGBA", (cell, cell), INK)
        sheet.paste(back, (x, y))
        shown = im
        if max(im.size) > cell:
            k = cell / max(im.size)
            shown = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        sheet.alpha_composite(shown.convert("RGBA"), (x + (cell - shown.width) // 2, y + (cell - shown.height) // 2))
        d.text((x, y + cell + 2), f"{name} {im.width}x{im.height}", fill=INK)
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    sheet.convert("RGB").save(PREVIEW)
    print(f"wrote {len(assets)} icons to {OUT} and {PREVIEW}")


if __name__ == "__main__":
    main()
