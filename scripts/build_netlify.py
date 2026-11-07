from __future__ import annotations

import json
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "dist"
STATIC_FILES = ("index.html", "app.js", "styles.css", "favicon.svg", "icons.svg")


def main() -> None:
    api_base = os.getenv("CHORDSCOPE_API_BASE", "").strip().rstrip("/")
    if api_base and not api_base.startswith("https://"):
        raise SystemExit("CHORDSCOPE_API_BASE must be an https:// URL when deploying publicly.")

    # Netlify may reuse a previous build's publish directory. Rebuild it cleanly
    # so stale files cannot break deployment or leak into the published site.
    if PUBLISH.exists():
        shutil.rmtree(PUBLISH)
    PUBLISH.mkdir(parents=True, exist_ok=True)

    for filename in STATIC_FILES:
        (PUBLISH / filename).write_bytes((ROOT / filename).read_bytes())

    config = f"window.CHORDSCOPE_API_BASE = {json.dumps(api_base)};\n"
    (PUBLISH / "config.js").write_text(config, encoding="utf-8")
    print(f"Built Netlify site in {PUBLISH} (API {'configured' if api_base else 'not configured'}).")


if __name__ == "__main__":
    main()

