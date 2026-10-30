import { getRegulationsStatus, queryRAGCopilot } from "../api.js?v=enterprise-15";
import { escapeHtml, formatDocumentTitle } from "./dom.js?v=enterprise-7";

let activeClaimId = "";

function formatMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Headings
  html = html.replace(/^### (.*$)/gim, '<h4 class="chat-heading">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 class="chat-heading">$1</h3>');
  // Lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="chat-list-item">$1</li>');
  html = html.replace(/(<li class="chat-list-item">.*?<\/li>)/gims, '<ul class="chat-list">$1</ul>');
  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr class="chat-divider"/>');
  // Paragraphs & Linebreaks
  html = html.replace(/\n\n/g, "</p><p>");
  html = html.replace(/\n/g, "<br/>");
  return `<div class="chat-content"><p>${html}</p></div>`;
}

function appendMessage(text, type = "assistant", extra = "") {
  const messages = document.getElementById("chatMessages");
  const message = document.createElement("article");
  message.className = `chat-message chat-message-${type}`;
  if (type === "user") {
    message.innerHTML = `<p>${escapeHtml(text)}</p>${extra}`;
  } else {
    message.innerHTML = `${formatMarkdown(text)}${extra}`;
  }
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
  const pending = appendMessage("Menganalisis regulasi & kaidah koding…", "assistant");
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
    const engine = status.ai_engine || "AI Aktif";
    label.textContent = status.index_ready
      ? `${engine} · ${status.indexed_documents} regulasi`
      : `${status.available_document_count} PDF tersedia · indeks belum aktif`;
    label.classList.toggle("is-offline", !status.index_ready);
  }).catch(() => {
    const label = document.getElementById("ragStatus");
    label.textContent = "Status indeks tidak dapat dimuat";
    label.classList.add("is-offline");
  });
}
