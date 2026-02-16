"""
Telemetry module for tracking client-side flag evaluations
and reporting them to the Rollgate server in batches.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Dict, Optional

import httpx

logger = logging.getLogger("rollgate.telemetry")


@dataclass
class TelemetryConfig:
    """Configuration for telemetry collection."""

    flush_interval_ms: int = 60000
    max_buffer_size: int = 1000
    enabled: bool = True


@dataclass
class TelemetryEvalStats:
    """Evaluation statistics for a single flag."""

    total: int = 0
    true_count: int = 0
    false_count: int = 0

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "true": self.true_count,
            "false": self.false_count,
        }


class TelemetryCollector:
    """Tracks flag evaluations and sends them to the server in batches."""

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        config: TelemetryConfig,
        http_client: httpx.AsyncClient,
    ):
        self._endpoint = endpoint
        self._api_key = api_key
        self._config = config
        self._http_client = http_client
        self._evaluations: Dict[str, TelemetryEvalStats] = {}
        self._total_buffered = 0
        self._is_flushing = False
        self._flush_task: Optional[asyncio.Task] = None
        self._closing = False
        self._last_flush_time: float = 0

    def start(self) -> None:
        """Start periodic flushing."""
        if not self._config.enabled or not self._endpoint or not self._api_key:
            return

        import time

        self._last_flush_time = time.time() * 1000
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def stop(self) -> None:
        """Stop the collector and perform a final flush."""
        self._closing = True
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self.flush()

    def record_evaluation(self, flag_key: str, result: bool) -> None:
        """Record a single flag evaluation."""
        if not self._config.enabled:
            return

        if flag_key not in self._evaluations:
            self._evaluations[flag_key] = TelemetryEvalStats()

        stats = self._evaluations[flag_key]
        stats.total += 1
        if result:
            stats.true_count += 1
        else:
            stats.false_count += 1

        self._total_buffered += 1

        if self._total_buffered >= self._config.max_buffer_size:
            asyncio.ensure_future(self.flush())

    async def flush(self) -> None:
        """Flush buffered evaluations to the server."""
        if self._is_flushing or not self._evaluations:
            return

        if not self._endpoint or not self._api_key:
            return

        self._is_flushing = True

        import time

        # Capture current data and reset buffer
        evaluations_to_send = {
            key: stats.to_dict() for key, stats in self._evaluations.items()
        }
        now = time.time() * 1000
        period_ms = int(now - self._last_flush_time) if self._last_flush_time else 0
        self._evaluations = {}
        self._total_buffered = 0
        self._last_flush_time = now

        payload = {
            "evaluations": evaluations_to_send,
            "period_ms": period_ms,
        }

        try:
            response = await self._http_client.post(
                self._endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code != 200:
                raise Exception(f"Telemetry request failed: {response.status_code}")
        except Exception as e:
            # Restore buffer on failure
            for key, stats_dict in evaluations_to_send.items():
                if key in self._evaluations:
                    self._evaluations[key].total += stats_dict["total"]
                    self._evaluations[key].true_count += stats_dict["true"]
                    self._evaluations[key].false_count += stats_dict["false"]
                else:
                    self._evaluations[key] = TelemetryEvalStats(
                        total=stats_dict["total"],
                        true_count=stats_dict["true"],
                        false_count=stats_dict["false"],
                    )
                self._total_buffered += stats_dict["total"]
            logger.warning(f"Failed to flush telemetry: {e}")
        finally:
            self._is_flushing = False

    def get_buffer_stats(self) -> Dict[str, int]:
        """Return current buffer statistics."""
        return {
            "flagCount": len(self._evaluations),
            "evaluationCount": self._total_buffered,
        }

    async def _periodic_flush(self) -> None:
        """Background task for periodic flushing."""
        while not self._closing:
            await asyncio.sleep(self._config.flush_interval_ms / 1000)
            if self._closing:
                break
            try:
                await self.flush()
            except Exception as e:
                logger.warning(f"Periodic telemetry flush error: {e}")
