#!/usr/bin/env python3
"""
Generate DirLut.cs – a lookup table that maps integer offsets
(dx, dy) ∈ [-156 … +156] to a pre-normalised Vector2.

Usage:
    python make_dir_lut.py      # writes DirLut.cs next to the script
"""

import math
from pathlib import Path

RANGE = 156                    # ± range on each axis
DIM   = RANGE * 2 + 1          # 313
OUT   = Path(__file__).with_name("DirLut.cs")

def emit():
    with OUT.open("w", encoding="utf-8") as f:
        W = f.write
        W("// *** AUTO-GENERATED – DO NOT EDIT BY HAND ***\n")
        W("using System.Numerics;\n\n")
        W("namespace Game.MathTables\n{\n")
        W("    internal static partial class DirLut\n    {\n")
        W(f"        public const int Range = {RANGE};\n")
        W(f"        public static readonly Vector2[,] Table = new Vector2[{DIM},{DIM}]\n")
        W("        {\n")

        for dy in range(-RANGE, RANGE + 1):
            W("            { ")
            for dx in range(-RANGE, RANGE + 1):
                if dx == 0 and dy == 0:
                    W("new(0f,0f)")
                else:
                    inv_len = 1.0 / math.hypot(dx, dy)
                    W(f"new({dx*inv_len:.6f}f,{dy*inv_len:.6f}f)")
                W(", " if dx <  RANGE else "")
            W(" },\n")
        W("        };\n    }\n}\n")

    print(f"Wrote {OUT}  ({OUT.stat().st_size//1024} KB)")

if __name__ == "__main__":
    emit()