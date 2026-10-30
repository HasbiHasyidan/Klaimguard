from pathlib import Path
from typing import Any, Optional

import chromadb
from chromadb.config import Settings
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from huggingface_hub import snapshot_download


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def _resolve_persist_dir(persist_dir: str) -> Path:
    requested = Path(persist_dir)
    if requested.is_absolute():
        return requested
    working_path = Path.cwd() / requested
    backend_path = BACKEND_DIR / "ml_models" / requested.name
    return working_path if working_path.is_dir() else backend_path


def _resolve_local_embedding_model() -> str | None:
    try:
        return snapshot_download(DEFAULT_MODEL, local_files_only=True)
    except Exception:
        return None


class ChromaVectorManager:
    def __init__(
        self,
        persist_directory: str = "backend/ml_models/vector_index",
        collection_name: str = "jkn_regulations",
    ):
        self.persist_directory = _resolve_persist_dir(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)
        self.collection_name = collection_name
        model_path = _resolve_local_embedding_model()
        if model_path:
            self.embedding_function = SentenceTransformerEmbeddingFunction(
                model_name=model_path,
                device="cpu",
                normalize_embeddings=True,
            )
        else:
            self.embedding_function = None

        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=Settings(anonymized_telemetry=False),
        )
        if self.embedding_function:
            self.collection = self.client.get_or_create_collection(
                name=collection_name,
                embedding_function=self.embedding_function,
                metadata={"hnsw:space": "cosine", "embedding_model": DEFAULT_MODEL},
            )
        else:
            self.collection = self.client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "cosine"},
            )

    @property
    def count(self) -> int:
        try:
            return self.collection.count()
        except Exception:
            return 0

    @property
    def indexed_documents(self) -> list[str]:
        names = set()
        total = self.count
        if total == 0:
            return []
        for offset in range(0, total, 1000):
            try:
                result = self.collection.get(
                    limit=1000,
                    offset=offset,
                    include=["metadatas"],
                )
                names.update(
                    metadata["source_document"]
                    for metadata in result.get("metadatas") or []
                    if metadata and metadata.get("source_document")
                )
            except Exception:
                break
        return sorted(names)

    def insert_chunks(self, chunks: list[dict[str, Any]], batch_size: int = 100) -> int:
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1.")
        unique_chunks = {}
        for chunk in chunks:
            chunk_id = str(chunk.get("chunk_id", "")).strip()
            text = str(chunk.get("text", "")).strip()
            if chunk_id and text:
                unique_chunks[chunk_id] = chunk

        batch = list(unique_chunks.items())
        for offset in range(0, len(batch), batch_size):
            group = batch[offset : offset + batch_size]
            self.collection.upsert(
                ids=[chunk_id for chunk_id, _chunk in group],
                documents=[str(chunk["text"]).strip() for _chunk_id, chunk in group],
                metadatas=[
                    {
                        "source_document": str(chunk["source_document"]),
                        "doc_name": str(chunk.get("doc_name") or chunk["source_document"]),
                        "page_number": int(chunk["page_number"]),
                        "regulation_type": str(
                            chunk.get("regulation_type") or "REGULATORY_DOCUMENT"
                        ),
                        "legal_status": str(chunk.get("legal_status") or "reference"),
                        "berlaku_sejak": str(chunk.get("berlaku_sejak") or ""),
                        "dicabut_sejak": str(chunk.get("dicabut_sejak") or ""),
                        "replaced_by": str(chunk.get("replaced_by") or ""),
                        "document_kind": str(chunk.get("document_kind") or "reference"),
                    }
                    for _chunk_id, chunk in group
                ],
            )
        return len(batch)

    def query_similar_regulations(
        self,
        query_text: str,
        top_k: int = 4,
        filter_doc: Optional[str] = None,
        active_only: bool = True,
    ) -> list[dict[str, Any]]:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        count = self.count
        if not query_text.strip() or count == 0 or self.embedding_function is None:
            return []
        options: dict[str, Any] = {
            "query_texts": [query_text],
            "n_results": min(top_k, count),
            "include": ["documents", "metadatas", "distances"],
        }
        filters: list[dict[str, Any]] = []
        if filter_doc:
            filters.append({"source_document": filter_doc})
        if active_only:
            filters.append({"legal_status": {"$ne": "superseded"}})
        if len(filters) == 1:
            options["where"] = filters[0]
        elif filters:
            options["where"] = {"$and": filters}
        try:
            result = self.collection.query(**options)
        except Exception:
            return []
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        matches = []
        for chunk_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
            matches.append(
                {
                    "chunk_id": chunk_id,
                    "source_document": metadata["source_document"],
                    "doc_name": metadata.get("doc_name", metadata["source_document"]),
                    "page_number": int(metadata["page_number"]),
                    "regulation_type": metadata.get(
                        "regulation_type", "REGULATORY_DOCUMENT"
                    ),
                    "legal_status": metadata.get("legal_status", "unclassified"),
                    "berlaku_sejak": metadata.get("berlaku_sejak", ""),
                    "dicabut_sejak": metadata.get("dicabut_sejak", ""),
                    "replaced_by": metadata.get("replaced_by", ""),
                    "text": text,
                    "similarity_score": max(0.0, min(1.0, 1.0 - float(distance))),
                }
            )
        return matches


class LocalVectorStore:
    def __init__(self, persist_dir: str = "backend/ml_models/vector_index"):
        self.manager = ChromaVectorManager(persist_directory=persist_dir)
        self.persist_dir = self.manager.persist_directory
        self.index_path = self.persist_dir / "chroma.sqlite3"

    @property
    def chunk_count(self) -> int:
        return self.manager.count

    @property
    def indexed_documents(self) -> list[str]:
        return self.manager.indexed_documents

    @property
    def index_ready(self) -> bool:
        return self.chunk_count > 0

    def add_documents(self, chunks: list[dict[str, Any]]) -> None:
        self.manager.insert_chunks(chunks)

    def similarity_search(
        self, query: str, top_k: int = 4, active_only: bool = True
    ) -> list[dict[str, Any]]:
        return self.manager.query_similar_regulations(
            query, top_k=top_k, active_only=active_only
        )
