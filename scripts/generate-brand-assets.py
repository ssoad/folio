"""Draws the Folio mark and writes every app icon the builds use.

The mark is a page with its top-right corner folded, and its lines of text
form an F. Geometry is defined on a 64-unit grid (the same as
src/assets/images/folio-mark.svg) and drawn at 4x, then downscaled, for
smooth edges.

Usage: python3 scripts/generate-brand-assets.py  (needs Pillow; macOS for .icns)
"""

import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACCENT = (68, 88, 199, 255)  # #4458C7
FOLD = (199, 206, 255, 255)  # #C7CEFF
WHITE = (255, 255, 255, 255)
SUPERSAMPLE = 4


def draw_mark(draw, x, y, unit, page, fold, ink, cut):
    """Mark at (x, y) with `unit` px per grid unit. `cut` paints the folded-away corner."""

    def box(x0, y0, x1, y1):
        return [x + x0 * unit, y + y0 * unit, x + x1 * unit, y + y1 * unit]

    def pt(px, py):
        return (x + px * unit, y + py * unit)

    draw.rounded_rectangle(box(10, 6, 54, 58), radius=4 * unit, fill=page)
    # Fold: remove the page's corner, then draw the turned-down flap
    draw.polygon([pt(40, 6), pt(54.5, 5.5), pt(54.5, 20)], fill=cut)
    draw.polygon([pt(40, 6), pt(40, 16), pt(41.2, 18.8), pt(44, 20), pt(54, 20)], fill=fold)
    # The F: stem and two bars
    draw.rounded_rectangle(box(19, 26, 43, 31), radius=2.5 * unit, fill=ink)
    draw.rounded_rectangle(box(19, 36, 35, 41), radius=2.5 * unit, fill=ink)
    draw.rounded_rectangle(box(19, 26, 24, 48), radius=2.5 * unit, fill=ink)


def app_icon(size, inset=0.0, radius_ratio=0.225, shadow=False):
    """Accent tile with a white mark. `inset` leaves margin (macOS icon grid)."""
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    tile = int(big * (1 - 2 * inset))
    offset = (big - tile) // 2
    if shadow:
        shade = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(shade).rounded_rectangle(
            [offset, offset + big * 0.012, offset + tile, offset + tile + big * 0.012],
            radius=tile * radius_ratio,
            fill=(0, 0, 0, 90),
        )
        img = Image.alpha_composite(img, shade.filter(ImageFilter.GaussianBlur(big * 0.012)))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [offset, offset, offset + tile, offset + tile], radius=tile * radius_ratio, fill=ACCENT
    )
    unit = tile * 0.625 / 64
    mark = unit * 64
    start = offset + (tile - mark) / 2
    draw_mark(draw, start, start, unit, WHITE, FOLD, ACCENT, ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def wide_tile(width, height):
    big_w, big_h = width * SUPERSAMPLE, height * SUPERSAMPLE
    img = Image.new("RGBA", (big_w, big_h), ACCENT)
    draw = ImageDraw.Draw(img)
    unit = big_h * 0.6 / 64
    draw_mark(draw, (big_w - unit * 64) / 2, (big_h - unit * 64) / 2, unit, WHITE, FOLD, ACCENT, ACCENT)
    return img.resize((width, height), Image.LANCZOS)


def android_foreground(size, color=True):
    """Adaptive-icon foreground: the mark alone, inside Android's safe zone.

    The 108dp canvas is masked to a ~72dp shape, so the mark spans ~44%.
    `color=False` gives the white monochrome layer for themed icons.
    """
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    unit = big * 0.44 / 64
    start = (big - unit * 64) / 2
    clear = (0, 0, 0, 0)
    if color:
        draw_mark(draw, start, start, unit, WHITE, FOLD, ACCENT, clear)
    else:
        draw_mark(draw, start, start, unit, WHITE, WHITE, clear, clear)
    return img.resize((size, size), Image.LANCZOS)


def round_icon(size):
    """Legacy round launcher icon (Android 7)."""
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([0, 0, big - 1, big - 1], fill=ACCENT)
    unit = big * 0.56 / 64
    start = (big - unit * 64) / 2
    draw_mark(draw, start, start, unit, WHITE, FOLD, ACCENT, ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def splash_icon(size):
    """Android 12+ splash icon: the colored tile, inside the 240dp circle's 160dp."""
    big = size * SUPERSAMPLE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    tile = app_icon(int(size * 0.5)).resize((int(big * 0.5),) * 2, Image.LANCZOS)
    offset = (big - tile.width) // 2
    img.alpha_composite(tile, (offset, offset))
    return img.resize((size, size), Image.LANCZOS)


ANDROID_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def android_icons():
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    if not os.path.isdir(res):
        print("android/ not found (run `npx cap add android`), skipped Android icons")
        return
    for density, scale in ANDROID_DENSITIES.items():
        folder = ("android", "app", "src", "main", "res", f"mipmap-{density}")
        save(app_icon(round(48 * scale)), *folder, "ic_launcher.png")
        save(round_icon(round(48 * scale)), *folder, "ic_launcher_round.png")
        save(android_foreground(round(108 * scale)), *folder, "ic_launcher_foreground.png")
        save(android_foreground(round(108 * scale), color=False), *folder, "ic_launcher_monochrome.png")
    save(splash_icon(288 * 4), "android", "app", "src", "main", "res", "drawable", "ic_splash.png")
    # Capacitor's legacy splash images (its own logo by default): the tile on
    # the dark app background, at each existing size
    for folder in sorted(os.listdir(res)):
        path = os.path.join(res, folder, "splash.png")
        if folder.startswith("drawable") and os.path.exists(path):
            width, height = Image.open(path).size
            img = Image.new("RGBA", (width, height), (20, 20, 19, 255))
            tile = app_icon(int(min(width, height) * 0.22))
            img.alpha_composite(tile, ((width - tile.width) // 2, (height - tile.height) // 2))
            save(img.convert("RGB"), "android", "app", "src", "main", "res", folder, "splash.png")


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


def main():
    full = {s: app_icon(s) for s in (16, 24, 32, 48, 64, 88, 100, 128, 256, 300, 512, 1024)}

    save(full[256], "assets", "icons", "256x256.png")
    save(full[512], "assets", "icons", "512x512.png")
    save(full[256], "public", "favicon.png")
    save(full[256], "public", "assets", "icon.png")

    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    for target in (("assets", "icons", "icon.ico"), ("assets", "appx", "icon.ico")):
        full[256].save(os.path.join(ROOT, *target), sizes=ico_sizes)
        print("wrote", os.path.join(*target))

    save(full[300], "assets", "appx", "Square150x150Logo.png")
    for name in (
        "Square44x44Logo.png",
        "Square44x44Logo.targetsize-256_altform-unplated.png",
        "Square44x44Logo.targetsize-44_altform-unplated.png",
    ):
        save(full[88], "assets", "appx", name)
    save(full[100], "assets", "appx", "StoreLogo.png")
    save(wide_tile(620, 300), "assets", "appx", "Wide310x150Logo.png")

    # macOS: Apple's grid puts the tile inside ~80% of the canvas, with a soft shadow
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = os.path.join(tmp, "icon.iconset")
            os.mkdir(iconset)
            for size in (16, 32, 128, 256, 512):
                for scale in (1, 2):
                    px = size * scale
                    suffix = "@2x" if scale == 2 else ""
                    app_icon(px, inset=0.1, shadow=px >= 64).save(
                        os.path.join(iconset, f"icon_{size}x{size}{suffix}.png")
                    )
            out = os.path.join(ROOT, "assets", "icons", "icon.icns")
            subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
            print("wrote assets/icons/icon.icns")
    else:
        print("iconutil not found (macOS only), skipped icon.icns")

    android_icons()


if __name__ == "__main__":
    main()
