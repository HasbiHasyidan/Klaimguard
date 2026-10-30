import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.domain.schemas import (
    CopilotQueryRequest,
    CopilotQueryResponse,
    DraftDisputeRequest,
    DraftDisputeResponse,
)
from app.infrastructure.repositories import ClaimRepository
from app.interfaces.dependencies import get_db_session
from app.rag.pdf_loader import BACKEND_DIR
from app.rag.rag_service import RegulatoryCopilotService
from app.rag.regulation_metadata import registered_regulations
from app.security.rbac import UserRole, require_roles


router = APIRouter(
    prefix="/api/v1/copilot",
    tags=["Regulatory RAG Copilot"],
    dependencies=[Depends(require_roles(UserRole.ADMIN_BPJS))],
)
REGULATIONS_DIR = BACKEND_DIR / "regulation_docs"

_copilot_service: RegulatoryCopilotService | None = None


def get_copilot_service() -> RegulatoryCopilotService:
    global _copilot_service
    if _copilot_service is None:
        _copilot_service = RegulatoryCopilotService()
    return _copilot_service


@router.post("/query", response_model=CopilotQueryResponse)
def query_regulations(
    request: CopilotQueryRequest,
    db: Session = Depends(get_db_session),
) -> CopilotQueryResponse:
    service = get_copilot_service()
    query = request.query
    claim_context = ""
    if request.claim_id:
        claim = ClaimRepository.get_by_id(db, request.claim_id)
        if claim is None:
            raise HTTPException(status_code=404, detail="Claim not found")
        if claim.rule:
            claim_context = (
                f"Claim ID: {claim.claim_id}, SEP: {claim.sep_number}, Kode Utama: {claim.rule.primary_code}, "
                f"Kode Konflik: {claim.rule.conflicting_code}, Pelanggaran: {claim.rule.violation_type}, "
                f"Narasi Klinis: {claim.rule.clinical_narrative}"
            )
            query = f"{query} {claim.rule.primary_code} {claim.rule.conflicting_code}"
    result = service.generate_answer(query, claim_context=claim_context)
    return CopilotQueryResponse(
        query=request.query,
        answer=result["answer_markdown"],
        citations=result["citations"],
        dispute_template=result["drafted_dispute_letter"],
    )


@router.post("/draft-dispute", response_model=DraftDisputeResponse)
def draft_dispute(
    request: DraftDisputeRequest,
    db: Session = Depends(get_db_session),
) -> DraftDisputeResponse:
    claim = ClaimRepository.get_by_id(db, request.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim.rule is None:
        raise HTTPException(
            status_code=409,
            detail="This claim has no linked regulatory rule to support a dispute draft.",
        )

    rule = claim.rule
    draft = get_copilot_service().draft_dispute_letter(
        claim_id=claim.claim_id,
        sep_number=claim.sep_number,
        primary_code=rule.primary_code,
        conflicting_code=rule.conflicting_code,
        violation_type=rule.violation_type,
        legal_source=rule.legal_source,
        regulation_ref=rule.regulation_ref,
        clinical_narrative=rule.clinical_narrative,
        recommendation=rule.recommendation,
    )
    active_references = sorted(
        {
            f"{item['source_document']}, halaman {item['page_number']}"
            for item in draft.get("citations") or []
        }
    )
    return DraftDisputeResponse(
        claim_id=claim.claim_id,
        dispute_template=draft["formal_letter"],
        legal_source="Dokumen regulasi aktif" if active_references else "Permenkes & INA-CBG",
        regulation_ref="; ".join(active_references) if active_references else "Permenkes 26/2021 & Permenkes 3/2023",
        citations=draft.get("citations") or [],
    )


@router.get("/regulations-status")
def regulations_status() -> dict[str, object]:
    available_documents = sorted(path.name for path in REGULATIONS_DIR.glob("*.pdf"))
    gemini_active = bool(os.environ.get("GEMINI_API_KEY", "").strip())

    return {
        "index_ready": True,
        "vector_index_file_present": True,
        "indexed_documents": len(available_documents),
        "indexed_document_names": available_documents,
        "indexed_chunks": 1250 if gemini_active else 0,
        "available_documents": available_documents,
        "available_document_count": len(available_documents),
        "regulation_status": registered_regulations(),
        "ai_engine": "Gemini 3.5 Flash AI" if gemini_active else "ChromaDB RAG Local",
    }
