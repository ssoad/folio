"""Samples each raw screen's top edge, so the frame's status bar matches
the app beneath it. Writes store/build/raw/colors.js for frame.html."""

import glob
import json
import os

from PIL import Image

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "build", "raw")
colors = {}
for path in sorted(glob.glob(os.path.join(RAW, "*.png"))):
    im = Image.open(path).convert("RGB")
    w, _ = im.size
    # A few pixels down the middle of the top row, averaged
    px = [im.getpixel((x, 2)) for x in range(int(w * 0.4), int(w * 0.6), 7)]
    r, g, b = (sum(c[i] for c in px) // len(px) for i in range(3))
    colors[os.path.basename(path)[:-4]] = f"#{r:02x}{g:02x}{b:02x}"
with open(os.path.join(RAW, "colors.js"), "w") as f:
    f.write("window.RAW_COLORS = " + json.dumps(colors, indent=1) + ";\n")
print(len(colors), "colours")
