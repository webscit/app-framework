"""FMPy adapter — build an initialised ``Drone.fmu`` co-simulation slave.

Isolates the heavy ``fmpy`` import and the FMU lifecycle (extract → optionally
recompile the platform binary → instantiate → initialise) so the rest of the
backend depends only on the small :class:`~fmu_runner.Fmu` protocol. The import
is lazy and failure is swallowed to ``None`` so the app still serves (data-less)
when FMPy or a C toolchain is missing — mirroring Reachy's renderer.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .fmu_runner import Fmu

logger = logging.getLogger(__name__)

FMU_PATH = Path(__file__).parent / "Drone.fmu"
"""Location of the (gitignored) FMU; fetch it via ``fetch_fmu.py`` first."""

_UNZIP_DIR: str | None = None
"""Cached extract-and-built FMU directory, so only the first run compiles."""


def _prepared_unzip_dir() -> str:
    """Extract the FMU once and build its platform binary if missing, then reuse.

    Every ``load_fmu`` call instantiates a fresh slave, but they all share this
    single extracted+compiled directory — so clicking Start repeatedly does not
    recompile the FMU each time (the build takes several seconds).

    Returns:
        The path to the prepared unzip directory.
    """
    global _UNZIP_DIR
    if _UNZIP_DIR is not None:
        return _UNZIP_DIR

    from fmpy import extract, platform
    from fmpy.build import build_platform_binary

    unzip_dir = extract(str(FMU_PATH))
    # The FMU ships only a Windows binary; build one for this host if missing
    # (needs a C toolchain).
    if not (Path(unzip_dir) / "binaries" / platform).exists():
        logger.info("Building Drone.fmu binary for %s (first run) …", platform)
        build_platform_binary(unzip_dir)

    _UNZIP_DIR = unzip_dir
    return unzip_dir


def prewarm() -> None:
    """Extract + compile the FMU ahead of the first run, if possible.

    Called at app startup so the (~5 s) one-time build happens during boot
    rather than freezing the event loop on the first Start. Failure is
    swallowed — the first ``load_fmu`` will simply build then, or report the
    FMU as unavailable.
    """
    if not FMU_PATH.exists():
        return
    try:
        _prepared_unzip_dir()
    except Exception:  # pragma: no cover - depends on optional native deps
        logger.exception("FMU prewarm failed; will retry on first run")


def load_fmu() -> Fmu | None:
    """Return a freshly instantiated, initialised FMI2 co-simulation slave.

    On non-Windows hosts the FMU ships no binary, so FMPy recompiles it from the
    bundled C sources on first use (needs a C toolchain).

    Returns:
        An initialised slave exposing ``setReal`` / ``doStep`` / ``getReal`` /
        ``terminate``, or ``None`` if FMPy is unavailable or the FMU is missing.
    """
    if not FMU_PATH.exists():
        logger.error(
            "Drone.fmu not found at %s — run `python -m "
            "examples.drone.backend.fetch_fmu` first",
            FMU_PATH,
        )
        return None

    try:
        from fmpy import read_model_description
        from fmpy.fmi2 import FMU2Slave
    except Exception:  # pragma: no cover - depends on optional native deps
        logger.exception("FMPy unavailable; running without the drone simulation")
        return None

    try:
        md = read_model_description(str(FMU_PATH))
        unzip_dir = _prepared_unzip_dir()

        fmu = FMU2Slave(
            guid=md.guid,
            unzipDirectory=unzip_dir,
            modelIdentifier=md.coSimulation.modelIdentifier,
            instanceName="drone",
        )
        fmu.instantiate()
        fmu.setupExperiment(startTime=0.0)
        fmu.enterInitializationMode()
        fmu.exitInitializationMode()
        return fmu
    except Exception:  # pragma: no cover - depends on native FMU at runtime
        logger.exception("Failed to initialise Drone.fmu")
        return None
