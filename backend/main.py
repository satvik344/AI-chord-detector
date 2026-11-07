from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .chord_engine import analyze_audio

ROOT = Path(__file__).resolve().parents[1]
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga",
    ".flac", ".aif", ".aiff", ".opus", ".webm",
}
MIME_EXTENSIONS = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "audio/aiff": ".aiff",
    "audio/webm": ".webm",
}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chordscope")
analysis_slot = asyncio.Semaphore(1)

app = FastAPI(
    title="ChordScope local analyzer",
    description="Local audio analysis for chord changes, key, and tempo.",
    version="0.1.0",
)

cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "engine": "ChordScope harmonic chroma v1",
    }


@app.post("/api/analyze")
async def analyze_track(audio: Annotated[UploadFile, File(...)]) -> dict:
    filename = Path(audio.filename or "track").name
    suffix = Path(filename).suffix.lower()
    content_type = (audio.content_type or "").split(";", 1)[0].lower()

    if suffix not in ALLOWED_EXTENSIONS and not content_type.startswith("audio/"):
        raise HTTPException(
            status_code=415,
            detail="Choose an audio file such as MP3, WAV, M4A, OGG, or FLAC.",
        )
    if suffix not in ALLOWED_EXTENSIONS:
        suffix = MIME_EXTENSIONS.get(content_type, ".audio")

    temp_path: Path | None = None
    total_bytes = 0
    try:
        with tempfile.NamedTemporaryFile(
            prefix="chordscope-",
            suffix=suffix,
            delete=False,
        ) as temporary:
            temp_path = Path(temporary.name)
            while chunk := await audio.read(CHUNK_SIZE):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="This file is larger than the 100 MB upload limit.",
                    )
                temporary.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")

        if analysis_slot.locked():
            raise HTTPException(
                status_code=503,
                detail="The analyzer is processing another track. Try again in a moment.",
            )

        async with analysis_slot:
            try:
                result = await run_in_threadpool(analyze_audio, str(temp_path))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except Exception as exc:
                logger.exception("Audio analysis failed")
                raise HTTPException(
                    status_code=500,
                    detail="The analyzer could not process this track. Try WAV, MP3, or FLAC.",
                ) from exc

        result["filename"] = filename
        return result
    finally:
        await audio.close()
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


@app.get("/")
@app.get("/index.html")
async def index() -> FileResponse:
    return FileResponse(ROOT / "index.html", media_type="text/html")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(ROOT / "styles.css", media_type="text/css")


@app.get("/app.js")
async def script() -> FileResponse:
    return FileResponse(ROOT / "app.js", media_type="text/javascript")


@app.get("/favicon.svg")
async def favicon() -> FileResponse:
    return FileResponse(ROOT / "favicon.svg", media_type="image/svg+xml")


@app.get("/config.js")
async def config() -> FileResponse:
    return FileResponse(ROOT / "config.js", media_type="text/javascript")


@app.get("/icons.svg")
async def icons() -> FileResponse:
    return FileResponse(ROOT / "icons.svg", media_type="image/svg+xml")


@app.get("/config.js")
async def config() -> FileResponse:
    return FileResponse(ROOT / "config.js", media_type="text/javascript")
