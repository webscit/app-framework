"""Shared constants for the framework's backend feature routers."""

from __future__ import annotations

API_PREFIX = "/api"
"""URL prefix every feature router is mounted under via ``app.include_router``.

Keeping this in one place means every backend route (``/ws``, ``/ai/layout``,
``/workspaces``, ...) ends up under a single ``/api`` prefix, so a frontend
dev server needs only one proxy rule to reach all of them.
"""
