"""Fetch the vendored ``Drone.fmu`` from the ALSETLab reference repository.

The FMU (~3.5 MB) is a binary runtime asset, so it is **not** committed to this
repo — it is downloaded on demand into ``examples/drone/backend/`` (gitignored).
Run this once before starting the backend::

    python -m examples.drone.backend.fetch_fmu

The source is the MIT-licensed ALSETLab/Modelica-Drone-3D-FMI model; see
``examples/drone/README.md`` for provenance and licensing.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

FMU_URL = (
    "https://raw.githubusercontent.com/ALSETLab/Modelica-Drone-3D-FMI/"
    "master/B_FMI/Drone.fmu"
)
"""Raw GitHub URL of the reference ``Drone.fmu`` (FMI 2.0 co-simulation)."""

FMU_PATH = Path(__file__).parent / "Drone.fmu"
"""Local path the FMU is downloaded to (next to the backend package)."""


def fetch(force: bool = False) -> Path:
    """Download ``Drone.fmu`` next to this module if it is not already present.

    Args:
        force: Re-download even if the file already exists.

    Returns:
        The path to the local ``Drone.fmu``.
    """
    if FMU_PATH.exists() and not force:
        print(f"Drone.fmu already present at {FMU_PATH} ({FMU_PATH.stat().st_size} B)")
        return FMU_PATH

    print(f"Downloading Drone.fmu from {FMU_URL} …")
    urllib.request.urlretrieve(FMU_URL, FMU_PATH)  # noqa: S310 - fixed trusted URL
    print(f"Saved {FMU_PATH.stat().st_size} B to {FMU_PATH}")
    return FMU_PATH


if __name__ == "__main__":
    fetch(force="--force" in sys.argv)
