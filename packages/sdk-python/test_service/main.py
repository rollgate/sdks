"""
Test Service for rollgate Python SDK

This HTTP server wraps the RollgateClient and exposes a standard interface
for the test harness to interact with.

Protocol:
- GET /  -> Health check
- POST / -> Execute command
- DELETE / -> Cleanup/shutdown
"""

import asyncio
import os
import sys
from typing import Any, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

# Add parent directory to path to import rollgate
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rollgate import RollgateClient, RollgateConfig, UserContext

client: Optional[RollgateClient] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Cleanup on shutdown
    global client
    if client:
        await client.close()
        client = None

app = FastAPI(lifespan=lifespan)


def make_response(
    value: Optional[bool] = None,
    string_value: Optional[str] = None,
    number_value: Optional[float] = None,
    json_value: Optional[Any] = None,
    flags: Optional[dict] = None,
    is_ready: Optional[bool] = None,
    circuit_state: Optional[str] = None,
    cache_stats: Optional[dict] = None,
    success: Optional[bool] = None,
    error: Optional[str] = None,
    message: Optional[str] = None,
) -> dict:
    resp = {}
    if value is not None:
        resp["value"] = value
    if string_value is not None:
        resp["stringValue"] = string_value
    if number_value is not None:
        resp["numberValue"] = number_value
    if json_value is not None:
        resp["jsonValue"] = json_value
    if flags is not None:
        resp["flags"] = flags
    if is_ready is not None:
        resp["isReady"] = is_ready
    if circuit_state is not None:
        resp["circuitState"] = circuit_state
    if cache_stats is not None:
        resp["cacheStats"] = cache_stats
    if success is not None:
        resp["success"] = success
    if error is not None:
        resp["error"] = error
    if message is not None:
        resp["message"] = message
    return resp


async def handle_command(cmd: dict) -> dict:
    global client
    command = cmd.get("command")

    if command == "init":
        config_data = cmd.get("config")
        if not config_data:
            return make_response(error="ValidationError", message="config is required")

        # Cleanup previous instance
        if client:
            await client.close()
            client = None

        try:
            config = RollgateConfig(
                api_key=config_data.get("apiKey", ""),
                base_url=config_data.get("baseUrl", "https://api.rollgate.io"),
                refresh_interval_ms=config_data.get("refreshInterval", 0),
                enable_streaming=config_data.get("enableStreaming", False),
                timeout_ms=config_data.get("timeout", 5000),
            )

            user_data = cmd.get("user")
            user = None
            if user_data:
                user = UserContext(
                    id=user_data.get("id", ""),
                    email=user_data.get("email"),
                    attributes=user_data.get("attributes"),
                )

            client = RollgateClient(config)
            await client.init(user)

            return make_response(success=True)
        except Exception as e:
            return make_response(error=type(e).__name__, message=str(e))

    elif command == "isEnabled":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        flag_key = cmd.get("flagKey")
        if not flag_key:
            return make_response(error="ValidationError", message="flagKey is required")

        default_value = cmd.get("defaultValue", False)
        value = client.is_enabled(flag_key, default_value)
        return make_response(value=value)

    elif command == "getString":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        flag_key = cmd.get("flagKey")
        if not flag_key:
            return make_response(error="ValidationError", message="flagKey is required")

        # Python SDK doesn't have getString yet - return default
        default_value = cmd.get("defaultStringValue", "")
        return make_response(string_value=default_value)

    elif command == "getNumber":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        flag_key = cmd.get("flagKey")
        if not flag_key:
            return make_response(error="ValidationError", message="flagKey is required")

        # Python SDK doesn't have getNumber yet - return default
        default_value = cmd.get("defaultNumberValue", 0)
        return make_response(number_value=default_value)

    elif command == "getJson":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        flag_key = cmd.get("flagKey")
        if not flag_key:
            return make_response(error="ValidationError", message="flagKey is required")

        # Python SDK doesn't have getJSON yet - return default
        default_value = cmd.get("defaultJsonValue")
        return make_response(json_value=default_value)

    elif command == "identify":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        user_data = cmd.get("user")
        if not user_data:
            return make_response(error="ValidationError", message="user is required")

        try:
            user = UserContext(
                id=user_data.get("id", ""),
                email=user_data.get("email"),
                attributes=user_data.get("attributes"),
            )
            await client.identify(user)
            return make_response(success=True)
        except Exception as e:
            return make_response(error=type(e).__name__, message=str(e))

    elif command == "reset":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        try:
            await client.reset()
            return make_response(success=True)
        except Exception as e:
            return make_response(error=type(e).__name__, message=str(e))

    elif command == "getAllFlags":
        if not client:
            return make_response(error="NotInitializedError", message="Client not initialized")

        flags = client.get_all_flags()
        return make_response(flags=flags)

    elif command == "getState":
        if not client:
            return make_response(is_ready=False, circuit_state="UNKNOWN")

        cache_stats = client.get_cache_stats()
        return make_response(
            is_ready=True,
            circuit_state=str(client.circuit_state).lower(),
            cache_stats={
                "hits": cache_stats.get("hits", 0),
                "misses": cache_stats.get("misses", 0),
            },
        )

    elif command == "close":
        if client:
            await client.close()
            client = None
        return make_response(success=True)

    else:
        return make_response(error="UnknownCommand", message=f"Unknown command: {command}")


@app.get("/")
async def health_check():
    return {"success": True}


@app.post("/")
async def execute_command(request: Request):
    try:
        cmd = await request.json()
        result = await handle_command(cmd)
        return JSONResponse(content=result)
    except Exception as e:
        return JSONResponse(
            content=make_response(error="ParseError", message=str(e)),
            status_code=400,
        )


@app.delete("/")
async def cleanup():
    global client
    if client:
        await client.close()
        client = None
    return {"success": True}


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8007"))
    print(f"[sdk-python test-service] Listening on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
