"""In-process MuJoCo renderer for the Reachy Mini choreography.

This module lets the example show the *actual robot body* inside the web
dashboard instead of a separate native MuJoCo window. It loads the real
Reachy Mini MJCF model and the SDK's analytical kinematics, drives the head
to each commanded pose, and renders a frame from the fixed ``studio_close``
camera which it returns as JPEG bytes for streaming to the frontend.

Why a dedicated single-thread executor:
    MuJoCo's offscreen ``Renderer`` owns an OpenGL context that is bound to
    the thread it was created on — it must be created *and* used on the same
    thread. All MuJoCo work is therefore funnelled through one worker thread
    (``max_workers=1``) so the context stays valid across calls while the
    FastAPI event loop stays responsive.

``mujoco`` and ``reachy_mini`` are heavy native dependencies (and only ship
wheels for the same Python the daemon uses). They are imported lazily inside
the worker so this module — and ``producers.py`` which imports the event
types — stays importable for the pure unit tests without the SDK installed.
"""

from __future__ import annotations

import asyncio
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .producers import ChoreographyStep

logger = logging.getLogger(__name__)

# Fixed third-person camera defined in the Reachy Mini MJCF, aimed at the
# robot's body — this is the view the dashboard shows.
_STUDIO_CAMERA = "studio_close"
_RENDER_SIZE = 480

# Physics steps to let the Stewart-platform passive joints settle into the
# commanded head pose before rendering (model timestep is 2 ms → ~0.5 s).
_SETTLE_STEPS = 250


class ChoreographySimulator:
    """Owns an in-process MuJoCo model and renders the robot per step.

    Args:
        scene: MJCF scene name shipped with ``reachy_mini`` (``"empty"`` or
            ``"minimal"``).
        jpeg_quality: JPEG quality (1-95) for the streamed frames.
    """

    def __init__(self, scene: str = "empty", jpeg_quality: int = 70) -> None:
        self._scene = scene
        self._jpeg_quality = jpeg_quality
        # Single worker thread keeps the GL context thread-affine.
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="reachy-sim"
        )
        self._initialized = False

        # Populated lazily on the worker thread by ``_ensure_initialized``.
        self._mujoco: Any = None
        self._model: Any = None
        self._data: Any = None
        self._renderer: Any = None
        self._kinematics: Any = None
        self._create_head_pose: Any = None
        self._ctrl_len: int = 0

    # ── Worker-thread (sync) methods ────────────────────────────────────────

    def _ensure_initialized(self) -> None:
        """Build the model, renderer, and kinematics on the worker thread.

        Runs exactly once. All MuJoCo/OpenGL objects are created here so they
        live on the single executor thread that later renders frames.
        """
        if self._initialized:
            return

        from importlib.resources import files

        import mujoco

        import reachy_mini
        from reachy_mini.kinematics import AnalyticalKinematics
        from reachy_mini.utils import create_head_pose

        mjcf_dir = files(reachy_mini).joinpath("descriptions/reachy_mini/mjcf/scenes")
        self._model = mujoco.MjModel.from_xml_path(
            str(mjcf_dir.joinpath(f"{self._scene}.xml"))
        )
        self._model.opt.timestep = 0.002
        self._data = mujoco.MjData(self._model)
        self._renderer = mujoco.Renderer(
            self._model, height=_RENDER_SIZE, width=_RENDER_SIZE
        )
        self._kinematics = AnalyticalKinematics()
        self._create_head_pose = create_head_pose
        self._mujoco = mujoco
        # Control vector: [yaw_body, stewart_1..6, right_antenna, left_antenna].
        self._ctrl_len = self._model.nu

        mujoco.mj_forward(self._model, self._data)
        self._initialized = True
        logger.info("Reachy Mini simulator initialised (scene=%s)", self._scene)

    def _render_step_sync(self, step: ChoreographyStep) -> bytes:
        """Drive the head to *step*'s pose, settle physics, return a JPEG frame.

        Args:
            step: The choreography step whose commanded roll/z/antennas to render.

        Returns:
            JPEG-encoded RGB frame bytes from the ``studio_close`` camera.
        """
        self._ensure_initialized()
        mujoco = self._mujoco

        pose = self._create_head_pose(
            z=step.z_mm, roll=step.roll_deg, mm=True, degrees=True
        )
        head_joints = self._kinematics.ik(pose)  # [body_yaw, stewart_1..6]

        self._data.ctrl[:7] = head_joints
        # MJCF antenna order is [left, right]; negate to match the model frame.
        if self._ctrl_len >= 9:
            self._data.ctrl[-2:] = [-step.antenna_l, -step.antenna_r]

        for _ in range(_SETTLE_STEPS):
            mujoco.mj_step(self._model, self._data)

        self._renderer.update_scene(self._data, camera=_STUDIO_CAMERA)
        frame = self._renderer.render()  # (H, W, 3) uint8 RGB
        return self._encode_jpeg(frame)

    def _encode_jpeg(self, frame: Any) -> bytes:
        """Encode an RGB numpy frame to JPEG bytes."""
        from PIL import Image

        buffer = io.BytesIO()
        Image.fromarray(frame).save(buffer, format="JPEG", quality=self._jpeg_quality)
        return buffer.getvalue()

    def _close_sync(self) -> None:
        """Release the renderer's GL context on the worker thread."""
        if self._renderer is not None:
            self._renderer.close()
            self._renderer = None

    # ── Async API (runs the sync work on the affine worker thread) ──────────

    async def render_step(self, step: ChoreographyStep) -> bytes:
        """Render *step* and return JPEG bytes, off the event loop.

        Args:
            step: The choreography step to render.

        Returns:
            JPEG-encoded frame bytes.
        """
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._render_step_sync, step)

    async def aclose(self) -> None:
        """Close the renderer and shut down the worker thread."""
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(self._executor, self._close_sync)
        finally:
            self._executor.shutdown(wait=True)
