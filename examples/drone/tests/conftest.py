"""Pytest configuration and shared fixtures for the drone example tests."""

from __future__ import annotations

import pytest


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
