"""GPU regression: python3 native/rune-prototype/checks/glass-tabs.py (Pillow required)."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageStat


prototype = Path(__file__).resolve().parents[1]
repository = prototype.parents[1]
artifacts = prototype / "artifacts" / "glass-tabs"
artifacts.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix="draft-glass-tabs-") as temporary:
    scratch = Path(temporary)
    script = scratch / "switch.json"
    script.write_text(json.dumps([
        {"t": 0.05, "type": "tap", "key": "draft-0"},
        {"t": 0.3, "physical": "ctrl+tab"},
        {"t": 1.05, "type": "tap", "key": "draft-1"},
        {"t": 2.05, "type": "tap", "key": "draft-0"},
        {"t": 3.05, "physical": "ctrl+tab"},
    ]))
    for theme in ["light", "dark"]:
        colors = []
        for index, time in enumerate([0.8, 1.8, 2.8, 3.8]):
            snapshot = artifacts / f"{theme}-{index}.png"
            subprocess.run([
                "bun", "run", "rune:dev", "--scene", theme,
                "--script", str(script), "--at", str(time),
                "--size", "1200x820", "--scale", "2", "--snap", str(snapshot),
            ], cwd=repository, env={
                **os.environ,
                "DRAFT_RUNE_DATA_ROOT": str(scratch / f"{theme}-{index}"),
            }, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Same empty patch of the title lobe, above the text, on plain paper.
            # Includes the sheen and rim during draft replacement and at rest.
            with Image.open(snapshot) as image:
                colors.append(ImageStat.Stat(image.convert("RGB").crop((540, 14, 570, 20))).mean)
        difference = max(
            max(color[channel] for color in colors) - min(color[channel] for color in colors)
            for channel in range(3)
        )
        assert difference <= 2, f"{theme}: glass brightness changed by {difference:.2f}/255"
        print(f"PASS {theme}: tab material stays stable across drafts and active tabs ({difference:.2f}/255)", flush=True)
