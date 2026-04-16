from __future__ import annotations

from .widget_registry import WidgetDefinition

LOG_VIEWER = WidgetDefinition(
    name="LogViewer",
    description="Displays live log stream from simulation stdout/stderr",
    stream="log",
    consumes="text/plain",
    capabilities=["log-viewer", "scrollable", "searchable"],
    parameters={
        "maxLines": {
            "type": "integer",
            "default": 1000,
            "minimum": 100,
            "maximum": 10000,
        },
        "showTimestamps": {"type": "boolean", "default": True},
        "wrapLines": {"type": "boolean", "default": False},
    },
    component="./src/widgets/LogViewer.tsx",
)
"""Built-in widget that displays live log stream from simulation stdout/stderr."""

STATUS_INDICATOR = WidgetDefinition(
    name="StatusIndicator",
    description="Displays heartbeat and run status from control stream",
    stream="control",
    consumes="application/x-control+json",
    capabilities=["status", "heartbeat", "run-status"],
    parameters={
        "label": {"type": "string", "default": "Simulation Status"},
        "showLastSeen": {"type": "boolean", "default": True},
    },
    component="./src/widgets/StatusIndicator.tsx",
)
"""Built-in widget that displays heartbeat and run status from the control stream."""
