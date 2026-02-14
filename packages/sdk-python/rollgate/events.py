"""
Event collector for A/B testing conversion tracking.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import httpx

logger = logging.getLogger("rollgate.events")


@dataclass
class TrackEventOptions:
    """Options for tracking a conversion event."""

    flag_key: str
    event_name: str
    user_id: str
    variation_id: Optional[str] = None
    value: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class EventCollectorConfig:
    """Configuration for the event collector."""

    flush_interval_ms: int = 30000
    max_buffer_size: int = 100
    enabled: bool = True


class EventCollector:
    """
    Buffers and batches conversion events for A/B testing.

    Events are buffered in memory and flushed periodically or when
    the buffer reaches max_buffer_size.
    """

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        config: EventCollectorConfig,
        http_client: httpx.AsyncClient,
    ):
        self._endpoint = endpoint
        self._api_key = api_key
        self._config = config
        self._http_client = http_client
        self._buffer: List[Dict[str, Any]] = []
        self._flush_task: Optional[asyncio.Task] = None
        self._closing = False

    def start(self) -> None:
        """Start the periodic flush task."""
        if not self._config.enabled:
            return
        self._flush_task = asyncio.create_task(self._flush_loop())

    async def stop(self) -> None:
        """Stop the collector and flush remaining events."""
        self._closing = True
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        # Best-effort final flush
        try:
            await self.flush()
        except Exception:
            pass

    def track(self, options: TrackEventOptions) -> None:
        """Add an event to the buffer."""
        if not self._config.enabled:
            return

        event: Dict[str, Any] = {
            "flagKey": options.flag_key,
            "eventName": options.event_name,
            "userId": options.user_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        if options.variation_id is not None:
            event["variationId"] = options.variation_id
        if options.value is not None:
            event["value"] = options.value
        if options.metadata is not None:
            event["metadata"] = options.metadata

        self._buffer.append(event)

        if len(self._buffer) >= self._config.max_buffer_size:
            asyncio.create_task(self._flush_quiet())

    async def flush(self) -> None:
        """Flush all buffered events to the server."""
        if not self._buffer:
            return

        events = self._buffer.copy()
        self._buffer.clear()

        try:
            response = await self._http_client.post(
                self._endpoint,
                json={"events": events},
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )

            if response.status_code >= 400:
                # Re-buffer on failure
                self._re_buffer(events)
                logger.warning(f"Event flush failed with status {response.status_code}")

        except Exception as e:
            self._re_buffer(events)
            logger.warning(f"Event flush error: {e}")

    @property
    def buffer_size(self) -> int:
        """Get the current number of buffered events."""
        return len(self._buffer)

    def _re_buffer(self, events: List[Dict[str, Any]]) -> None:
        """Re-add events to buffer on failure."""
        combined = events + self._buffer
        max_size = self._config.max_buffer_size * 2
        if len(combined) > max_size:
            combined = combined[-max_size:]
        self._buffer = combined

    async def _flush_loop(self) -> None:
        """Periodically flush events."""
        interval = self._config.flush_interval_ms / 1000
        while not self._closing:
            await asyncio.sleep(interval)
            if self._closing:
                break
            await self._flush_quiet()

    async def _flush_quiet(self) -> None:
        """Flush without raising."""
        try:
            await self.flush()
        except Exception:
            pass
