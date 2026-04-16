from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel


class WidgetDefinition(BaseModel):
    """Schema for a single widget type registered in the WidgetRegistry.

    Args:
        name: Unique identifier, e.g. ``"LogViewer"``.
        description: Human-readable purpose of the widget.
        stream: Open string — which WebSocket stream this widget consumes
            (e.g. ``"log"``, ``"control"``, ``"data"``).  Not a closed enum
            so future stream types need zero registry changes.
        consumes: MIME type describing the exact data shape expected,
            e.g. ``"text/plain"`` or ``"application/x-timeseries+json"``.
        capabilities: Open tags for AI reasoning and human search,
            e.g. ``["log-viewer", "scrollable", "searchable"]``.
            No validation — any string is valid.
        parameters: JSON schema of user-configurable parameters,
            e.g. ``{"maxLines": {"type": "integer", "default": 1000}}``.
        component: Relative path to the React component,
            e.g. ``"./src/widgets/LogViewer.tsx"``.
    """

    name: str
    description: str
    stream: str
    consumes: str
    capabilities: list[str]
    parameters: dict[str, Any]
    component: str


class WidgetRegistry:
    """Catalog of available widget types.

    Not a singleton — instantiated in ``create_app()`` and exposed on
    ``app.state.widget_registry`` so multiple app instances remain
    independent and tests can construct their own registries.

    Example::

        registry = WidgetRegistry()
        registry.register(WidgetDefinition(name="LogViewer", ...))
        widget = registry.get("LogViewer")
    """

    def __init__(self) -> None:
        """Initialise with an empty widget catalog."""
        self._widgets: dict[str, WidgetDefinition] = {}

    def register(self, widget: WidgetDefinition) -> None:
        """Add *widget* to the catalog.

        Args:
            widget: Widget definition to register.

        Returns:
            None.

        Raises:
            ValueError: If a widget with the same name is already registered.
        """
        if widget.name in self._widgets:
            raise ValueError(f"Widget '{widget.name}' is already registered")
        self._widgets[widget.name] = widget

    def unregister(self, name: str) -> None:
        """Remove the widget identified by *name* from the catalog.

        Args:
            name: Name of the widget to remove.

        Returns:
            None.

        Raises:
            KeyError: If no widget with that name is registered.
        """
        if name not in self._widgets:
            raise KeyError(name)
        del self._widgets[name]

    def get(self, name: str) -> WidgetDefinition | None:
        """Return the widget with *name*, or ``None`` if not found.

        Args:
            name: Widget name to look up.

        Returns:
            Matching ``WidgetDefinition``, or ``None``.
        """
        return self._widgets.get(name)

    def list(self) -> list[WidgetDefinition]:
        """Return all registered widgets.

        Returns:
            List of every registered ``WidgetDefinition``, or ``[]``.
        """
        return list(self._widgets.values())

    def find_by_capability(self, tag: str) -> Sequence[WidgetDefinition]:
        """Return widgets whose ``capabilities`` list includes *tag*.

        Args:
            tag: Capability tag to search for.

        Returns:
            Matching widgets, or ``[]`` when none match.
        """
        return [w for w in self._widgets.values() if tag in w.capabilities]

    def find_by_stream(self, stream: str) -> Sequence[WidgetDefinition]:
        """Return widgets whose ``stream`` field equals *stream* exactly.

        Args:
            stream: Stream type string to match.

        Returns:
            Matching widgets, or ``[]`` when none match.
        """
        return [w for w in self._widgets.values() if w.stream == stream]

    def find_by_mime(self, mime_type: str) -> Sequence[WidgetDefinition]:
        """Return widgets whose ``consumes`` field equals *mime_type* exactly.

        Args:
            mime_type: MIME type string to match.

        Returns:
            Matching widgets, or ``[]`` when none match.
        """
        return [w for w in self._widgets.values() if w.consumes == mime_type]
