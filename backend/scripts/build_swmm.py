"""Build unmodified, pinned EPA SWMM C sources locally (macOS/Linux).

No system install or security-policy changes. The serial build deliberately
avoids the optional OpenMP runtime and platform-specific Python wheel loading.
"""
import argparse
import json
import platform
import subprocess
from pathlib import Path

COMMIT = "7952ca837988b1c32f791812eccc9fd64547e093"
URL = "https://github.com/USEPA/Stormwater-Management-Model.git"
ROOT = Path(__file__).resolve().parents[2]


def build(folder):
    source = folder / "epa-swmm"
    if not source.exists():
        subprocess.run(["git", "clone", "--depth", "1", "--branch", "v5.2.4", URL, str(source)], check=True)
    actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if actual != COMMIT or subprocess.check_output(["git", "-C", str(source), "diff", "--name-only"], text=True).strip():
        raise ValueError("SWMM source must be the unmodified pinned EPA release")
    output = folder / ("libcityos-swmm.dylib" if platform.system() == "Darwin" else "libcityos-swmm.so")
    source_dir = source / "src/solver"
    command = ["cc", "-O2", "-fPIC", "-dynamiclib" if platform.system() == "Darwin" else "-shared",
               "-I", str(source_dir / "include"), *map(str, sorted(source_dir.glob("*.c"))), "-lm", "-o", str(output)]
    subprocess.run(command, check=True)
    (folder / "swmm-build.json").write_text(json.dumps({"repository": URL, "commit": COMMIT, "version": "5.2.4", "serial": True}, indent=2) + "\n")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=ROOT / ".tmp")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    build(args.directory.resolve())
