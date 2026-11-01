#!/usr/bin/env python3
"""Export exact built application ABIs for the static page. No network, environment or filesystem grants."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAMES = ["CoreReader", "HamsterRunNFT", "PointsLedger", "SeasonBoard", "TrainBook", "MatchBook"]
abis = {name: json.loads((ROOT / "out" / f"{name}.sol" / f"{name}.json").read_text())["abi"] for name in NAMES}
(ROOT / "demo" / "abis.json").write_text(json.dumps(abis, indent=2) + "\n")
print("Exported six application ABIs to demo/abis.json")
