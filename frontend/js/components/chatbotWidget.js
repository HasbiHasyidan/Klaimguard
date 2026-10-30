import { getRegulationsStatus, queryRAGCopilot } from "../api.js?v=enterprise-12";
import { escapeHtml, formatDocumentTitle } from "./dom.js?v=enterprise-7";

let activeClaimId = "";

function appendMessage(text, type = "assistant", extra = "") {
  const messages = document.getElementById("chatMessages");
  const message = document.createElement("article");
  message.className = `chat-message chat-message-${type}`;
  message.innerHTML = `<p>${escapeHtml(text)}</p>${extra}`;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
  return message;
}

function renderCitations(citations = []) {
  if (!citations.length) return "";
  return `<div class="citation-list">${citations.map((citation) => `<div class="citation-card"><strong>${escapeHtml(formatDocumentTitle(citation.source_document))} · hlm. ${escapeHtml(citation.page_number)}</strong><p>${escapeHtml(citation.excerpt)}</p></div>`).join("")}</div>`;
}

async function submitQuestion(event) {
  event.preventDefault();
  const input = document.getElementById("chatQuery");
  const query = input.value.trim();
  if (!query) return;
  appendMessage(query, "user");
  input.value = "";
  const pending = appendMessage("Menelusuri dokumen regulasi…", "assistant");
  try {
    const result = await queryRAGCopilot(query, activeClaimId || null);
    pending.remove();
    appendMessage(result.answer, "assistant", renderCitations(result.citations));
  } catch (error) {
    pending.remove();
    appendMessage(error.message, "error");
  }
}

export function setActiveClaim(claimId) {
  activeClaimId = claimId || "";
}

export function initChatbot() {
  document.getElementById("chatQueryForm").addEventListener("submit", submitQuestion);
  document.querySelectorAll("[data-chat-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById("chatQuery");
      input.value = button.dataset.chatPrompt;
      input.focus();
    });
  });

  getRegulationsStatus().then((status) => {
    const label = document.getElementById("ragStatus");
    label.textContent = status.index_ready
      ? `${status.indexed_documents} dokumen · ${status.indexed_chunks ?? "—"} potongan`
      : `${status.available_document_count} PDF tersedia · indeks belum aktif`;
    label.classList.toggle("is-offline", !status.index_ready);
  }).catch(() => {
    const label = document.getElementById("ragStatus");
    label.textContent = "Status indeks tidak dapat dimuat";
    label.classList.add("is-offline");
  });
}
