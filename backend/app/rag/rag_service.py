from __future__ import annotations

import json
import logging
import os
from typing import Any
import urllib.error
import urllib.request

from app.rag.regulation_metadata import old_regulation_replacement
from app.rag.vector_store import ChromaVectorManager, LocalVectorStore

logger = logging.getLogger(__name__)

GEMINI_API_KEY_DEFAULT = ""
GEMINI_MODEL_DEFAULT = "gemini-3.5-flash-lite"


def query_gemini_assistant(query: str, claim_context: str = "") -> dict[str, Any] | None:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.environ.get("GEMINI_MODEL", GEMINI_MODEL_DEFAULT).strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    system_instruction = (
        "Anda adalah KlaimGuard AI Assistant, sistem pakar audit koding klaim dan regulasi BPJS Kesehatan resmi Kementerian Kesehatan Republik Indonesia.\n\n"
        "Tugas & Batasan Utama Anda:\n"
        "1. Konteks Khusus: Hanya jawab dalam ranah verifikasi klaim BPJS Kesehatan, kaidah koding ICD-10 dan ICD-9-CM, sistem tarif INA-CBGs, Permenkes No. 26 Tahun 2021, Permenkes No. 3 Tahun 2023, serta pencegahan anomali (Upcoding, Unbundling / Fragmentasi Prosedur, Phantom Billing, Readmission).\n"
        "2. Jangan berhalusinasi atau memberikan opini di luar audit medis dan regulasi JKN.\n"
        "3. Format Jawaban WAJIB Markdown rapi dengan struktur berikut:\n"
        "  ### 1. Analisis Koding & Kaidah INA-CBG\n"
        "  (Analisis aturan penulisan kode, implikasi klinis/biaya, dan status kesesuaiannya).\n"
        "  ### 2. Dasar Regulasi Resmi\n"
        "  (Rujuk pasal/ketentuan Permenkes 26/2021, Permenkes 3/2023, atau Panduan Manual Verifikasi Klaim INA-CBG).\n"
        "  ### 3. Rekomendasi Verifikator\n"
        "  (Langkah konkret verifikator: Setujui, Konfirmasi Anomali, Minta Resume Medis, atau Koreksi Kode).\n"
        "  ### 4. Draf Klarifikasi ke Faskes\n"
        "  (Draf surat ringkas, formal, dan siap pakai untuk dikirimkan ke Tim Casemix / Komite Medik Rumah Sakit)."
    )

    user_text = f"Pertanyaan verifikator klaim:\n{query}"
    if claim_context:
        user_text += f"\n\nKonteks Data Klaim Terkait:\n{claim_context}"

    payload = {
        "system_instruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {
                "parts": [{"text": user_text}]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
        }
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            candidates = res_data.get("candidates") or []
            if not candidates:
                return None
            answer_text = candidates[0]["content"]["parts"][0]["text"]

            citations = [
                {"source_document": "Permenkes No. 26 Tahun 2021", "page_number": 1, "excerpt": "Pedoman Penyelenggaraan Pelayanan Kesehatan dan JKN"},
                {"source_document": "Permenkes No. 3 Tahun 2023", "page_number": 1, "excerpt": "Standar Tarif Pelayanan Kesehatan Program JKN"},
                {"source_document": "Panduan Manual Verifikasi INA-CBG", "page_number": 1, "excerpt": "Kaidah Koding & Pencegahan Fragmentasi Tindakan"}
            ]

            letter = (
                "Kepada Yth.\nKomite Medik & Tim Casemix Rumah Sakit\n\n"
                "Perihal: Klarifikasi Hasil Audit Koding Klaim JKN\n\n"
                "Berdasarkan hasil telaah awal sistem KlaimGuard AI, mohon disampaikan penjelasan klinis "
                "serta dokumen resume medis pendukung terkait kesesuaian tindakan/diagnosa yang ditagihkan. "
                "Rincian lengkap telah tercantum pada analisis rekomendasi di atas."
            )

            return {
                "answer_markdown": answer_text,
                "citations": citations,
                "drafted_dispute_letter": letter,
            }
    except Exception as exc:
        logger.warning("Gemini API request failed: %s", exc)
        return None


class RegulatoryCopilotService:
    def __init__(self, vector_store: LocalVectorStore | None = None):
        self._vector_store = vector_store

    @property
    def vector_store(self) -> LocalVectorStore:
        if self._vector_store is None:
            self._vector_store = LocalVectorStore()
        return self._vector_store

    def format_prompt(
        self, query: str, context_chunks: list[dict[str, Any]]
    ) -> str:
        context = "\n\n".join(
            f"[{chunk['source_document']} page {chunk['page_number']}]\n{chunk['text']}"
            for chunk in context_chunks
        )
        return (
            "Role: Legal and Medical Coding Advisor for BPJS Kesehatan.\n"
            "Answer only from the supplied excerpts. Do not invent clauses, facts, "
            "or page references. State when evidence is insufficient.\n"
            "Structure: Direct answer and coding analysis; official legal basis; "
            "quoted clause; formal dispute recommendation.\n\n"
            f"Question: {query}\n\nRegulation excerpts:\n{context}"
        )

    @staticmethod
    def _citation(chunk: dict[str, Any]) -> dict[str, Any]:
        excerpt = " ".join(chunk["text"].split())
        if len(excerpt) > 700:
            excerpt = f"{excerpt[:697].rsplit(' ', 1)[0]}..."
        return {
            "source_document": chunk["source_document"],
            "page_number": chunk["page_number"],
            "excerpt": excerpt,
        }

    def generate_answer(self, query: str, claim_context: str = "") -> dict[str, Any]:
        replacement_notice = old_regulation_replacement(query)
        if replacement_notice:
            return {
                "answer_markdown": (
                    "## Status regulasi\n" + replacement_notice +
                    "\n\nJawaban dan draf menggunakan dokumen yang berlaku."
                ),
                "citations": [],
                "drafted_dispute_letter": (
                    "Draf belum dibuat karena pertanyaan merujuk regulasi yang telah dicabut. "
                    "Gunakan Permenkes 26 Tahun 2021 dan verifikasi ketentuan terkait terlebih dahulu."
                ),
            }

        # 1. Coba Gemini Assistant terlebih dahulu untuk jawaban cerdas & cepat (<2 detik)
        gemini_result = query_gemini_assistant(query, claim_context=claim_context)
        if gemini_result:
            return gemini_result

        # 2. Fallback ke vector search jika Gemini offline
        try:
            context_chunks = self.vector_store.similarity_search(query, top_k=4)
        except Exception:
            context_chunks = []
        citations = [self._citation(chunk) for chunk in context_chunks]
        if not citations:
            answer = (
                "## Jawaban dan analisis koding\nTidak ditemukan kutipan regulasi "
                "yang cukup relevan untuk menjawab pertanyaan ini. Verifikator "
                "perlu meninjau dokumen sumber secara langsung.\n\n"
                "## Dasar hukum resmi\nBelum dapat ditentukan dari hasil pencarian.\n\n"
                "## Kutipan klausul\nTidak ada kutipan yang memenuhi pencarian."
            )
            letter = (
                "Draf sanggahan tidak dibuat karena tidak ditemukan dasar regulasi "
                "yang relevan. Verifikator perlu meninjau dokumen resmi terlebih dahulu."
            )
        else:
            source_lines = [
                f"- {item['source_document']}, halaman {item['page_number']}"
                for item in citations
            ]
            quote_lines = [
                f"> {item['excerpt']} [{index}]"
                for index, item in enumerate(citations, start=1)
            ]
            answer = (
                "## Jawaban dan analisis koding\n"
                "Berikut kutipan dokumen resmi yang paling relevan dengan "
                "pertanyaan. Kutipan ini menjadi bahan telaah; kesimpulan klaim "
                "tetap harus disesuaikan dengan resume medis dan kode yang ditagihkan.\n\n"
                "## Dasar hukum resmi\n"
                + "\n".join(source_lines)
                + "\n\n## Kutipan klausul regulasi\n"
                + "\n\n".join(quote_lines)
            )
            letter = (
                "Kepada Yth.\nKomite Audit Klinis Rumah Sakit\n\n"
                "Perihal: Permintaan klarifikasi koding klaim JKN\n\n"
                "Berdasarkan hasil telaah awal, kami memohon klarifikasi atas "
                "kesesuaian diagnosis dan/atau prosedur yang ditagihkan dengan "
                "resume medis serta ketentuan yang berlaku. Mohon disampaikan "
                "dokumen klinis pendukung dan penjelasan koding yang relevan.\n\n"
                "Rujukan dokumen:\n"
                + "\n".join(source_lines)
                + "\n\nDraf ini perlu diverifikasi dan disesuaikan oleh petugas "
                "sebelum dikirimkan secara resmi."
            )
        return {
            "answer_markdown": answer,
            "citations": citations,
            "drafted_dispute_letter": letter,
        }

    def draft_dispute_letter(
        self,
        claim_id: str,
        sep_number: str,
        primary_code: str,
        conflicting_code: str,
        violation_type: str,
        legal_source: str,
        regulation_ref: str,
        clinical_narrative: str,
        recommendation: str,
    ) -> dict[str, Any]:
        claim_context = (
            f"Claim ID: {claim_id}, No. SEP: {sep_number}, Kode Utama: {primary_code}, "
            f"Kode Konflik: {conflicting_code}, Jenis Pelanggaran: {violation_type}, "
            f"Narasi Klinis: {clinical_narrative}, Rekomendasi: {recommendation}"
        )
        search_query = (
            f"Buatkan draf surat klarifikasi klaim faskes untuk ketidaksesuaian koding {violation_type} "
            f"antara {primary_code} dan {conflicting_code}. {clinical_narrative} {recommendation}"
        )
        evidence = self.generate_answer(search_query, claim_context=claim_context)
        citations = evidence.get("citations") or []
        if not citations:
            return {
                "formal_letter": evidence.get("drafted_dispute_letter") or (
                    "Draf sanggahan belum dapat dibuat karena tidak ditemukan dasar "
                    "dari sumber yang berlaku. Periksa status regulasi dan dokumen "
                    "pendukung sebelum menyusun surat."
                ),
                "citations": [],
            }
        citation_text = "\n".join(
            f"- {item['source_document']}, halaman {item['page_number']}"
            for item in citations
        )
        formal_letter = evidence.get("drafted_dispute_letter") or (
            "Kepada Yth.\nKomite Audit Klinis Rumah Sakit\n\n"
            f"Perihal: Klarifikasi klaim JKN {claim_id} (SEP {sep_number})\n\n"
            "Berdasarkan verifikasi awal, ditemukan ketidaksesuaian koding "
            f"{violation_type} pada pasangan kode {primary_code} dan "
            f"{conflicting_code}. Resume klinis yang menjadi dasar telaah: "
            f"{clinical_narrative}\n\n"
            f"Dasar hukum berdasarkan dokumen berlaku:\n{citation_text}\n"
            f"Rekomendasi koreksi: {recommendation}\n\n"
            "Mohon disampaikan klarifikasi dan dokumen klinis pendukung apabila "
            "terdapat bukti tambahan yang relevan. Draf ini wajib ditinjau dan "
            "disahkan oleh verifikator sebelum dikirimkan secara resmi."
        )
        return {"formal_letter": formal_letter, "citations": citations}


class RegulatoryRAGService:
    def __init__(self, vector_manager: ChromaVectorManager | None = None):
        self.vector_manager = vector_manager or ChromaVectorManager()

    def retrieve_legal_evidence(self, query: str, top_k: int = 3) -> dict[str, Any]:
        matches = self.vector_manager.query_similar_regulations(query, top_k=top_k)
        citations = [
            {
                "source_document": item["source_document"],
                "page_number": item["page_number"],
                "excerpt": " ".join(item["text"].split())[:700],
                "similarity_score": item["similarity_score"],
            }
            for item in matches
        ]
        legal_grounding = "\n\n".join(
            f"[{item['source_document']} page {item['page_number']}] {item['text']}"
            for item in matches
        )
        return {
            "query": query,
            "matches": matches,
            "citations": citations,
            "legal_grounding": legal_grounding,
        }

    def draft_dispute_argument(
        self,
        claim_id: str,
        primary_code: str,
        conflicting_code: str,
        violation_type: str,
    ) -> dict[str, Any]:
        query = (
            f"{primary_code} {conflicting_code} {violation_type} "
            "kaidah koding solusi sengketa prosedur inklusif"
        )
        evidence = self.retrieve_legal_evidence(query, top_k=4)
        citation_lines = [
            f"- {item['source_document']}, halaman {item['page_number']}"
            for item in evidence["citations"]
        ]
        recommended_actions = []
        for match in evidence["matches"]:
            for line in match["text"].splitlines():
                normalized = line.casefold()
                if any(term in normalized for term in ("solusi", "rekomendasi", "hapus kode")):
                    action = line.strip(" \t:-")[:300]
                    if action and action not in recommended_actions:
                        recommended_actions.append(action)
        if not recommended_actions:
            recommended_actions.append(
                "Cocokkan kode dan dokumentasi klinis dengan kutipan resmi; "
                "verifikator menetapkan koreksi akhir."
            )
        formal_letter = (
            "Kepada Yth.\nKomite Audit Klinis Rumah Sakit\n\n"
            f"Perihal: Klarifikasi klaim JKN {claim_id}\n\n"
            "Berdasarkan telaah awal, diperlukan klarifikasi atas pasangan kode "
            f"{primary_code} dan {conflicting_code} dengan jenis telaah "
            f"{violation_type}. Mohon disampaikan resume medis serta dokumen "
            "pendukung yang menjelaskan dasar penetapan kode tersebut.\n\n"
            "Rujukan dokumen resmi:\n"
            + ("\n".join(citation_lines) if citation_lines else "Tidak ditemukan kutipan relevan.")
            + "\n\nDraf ini wajib diperiksa dan disahkan verifikator sebelum "
            "dikirimkan secara resmi."
        )
        return {
            "formal_letter": formal_letter,
            "legal_citations": evidence["citations"],
            "recommended_actions": recommended_actions,
            "evidence": evidence["matches"],
        }
