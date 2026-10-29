from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
if str(BACKEND_DIR) not in sys.path:
  sys.path.insert(0, str(BACKEND_DIR))

from app.infrastructure import orm_models as _orm_models
from app.infrastructure import security_models as _security_models
from app.infrastructure.database import Base, engine
from app.interfaces.api_audit import router as audit_router
from app.interfaces.api_auth import router as auth_router
from app.interfaces.api_claims import router as claims_router
from app.interfaces.api_copilot import router as copilot_router
from app.interfaces.api_disputes import router as disputes_router
from app.interfaces.api_facilities import router as facilities_router
from app.interfaces.api_feedback import router as feedback_router
from app.interfaces.api_rs_portal import router as rs_portal_router
from app.interfaces.api_rules import router as rules_router
from app.interfaces.api_stats import router as stats_router
from scripts.additive_migration import migrate_additive_schema


@asynccontextmanager
async def lifespan(_app: FastAPI):
  # Inisialisasi DB & migrasi schema saat server menyala
  Base.metadata.create_all(bind=engine)
  migrate_additive_schema(engine)
  yield


app = FastAPI(
    title="KlaimGuard - Enterprise Audit API",
    description=(
        "JKN Fraud Detection Engine based on Kemenkes & BPJS Regulations"
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Konfigurasi CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def handle_unexpected_exception(
    _request: Request, exc: Exception
) -> JSONResponse:
  if isinstance(exc, HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "message": exc.detail,
            "status_code": exc.status_code,
        },
    )
  return JSONResponse(
      status_code=500,
      content={
          "error": True,
          "message": f"Internal Server Error: {str(exc)}",
          "status_code": 500,
      },
  )


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
  return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/info", tags=["Root"])
def api_info():
  return {
      "service": "KlaimGuard API",
      "status": "running",
      "docs_url": "/docs",
      "timestamp": datetime.now(timezone.utc).isoformat(),
  }


# Router pendaftaran
app.include_router(claims_router)
app.include_router(auth_router)
app.include_router(rules_router)
app.include_router(feedback_router)
app.include_router(stats_router)
app.include_router(audit_router)
app.include_router(copilot_router)
app.include_router(disputes_router)
app.include_router(rs_portal_router)
app.include_router(facilities_router)


@app.get("/app", include_in_schema=False)
def redirect_app_to_root():
  return RedirectResponse(url="/", status_code=301)


if FRONTEND_DIR.exists() and (FRONTEND_DIR / "index.html").exists():
  # Mount frontend di root "/" sehingga saat URL dibuka langsung tampil web UI
  app.mount(
      "/",
      StaticFiles(directory=str(FRONTEND_DIR), html=True),
      name="frontend",
  )

if __name__ == "__main__":
  import uvicorn

  port = int(os.environ.get("PORT", 8000))
  uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
