import {
  addDisputeComment,
  createDispute,
  deleteDispute,
  getDisputeSummary,
  getDisputes,
  markDisputeSent,
  reevaluateDispute,
  reviewDispute,
  submitDispute,
  updateDispute,
} from "../api.js?v=enterprise-20";
import { escapeHtml, formatNumber } from "./dom.js?v=enterprise-8";

const labels = {
  draft: "Draf",
  in_review: "Perlu pemeriksaan akhir",
  approved: "Disetujui",
  needs_revision: "Perlu revisi",
  sent: "Menunggu respons RS",
  closed: "Selesai di aplikasi",
  cancelled: "Dihapus",
};

const statusTone = {
  draft: "is-draft",
  in_review: "is-review",
  approved: "is-approved",
  needs_revision: "is-revision",
  sent: "is-sent",
  closed: "is-closed",
  cancelled: "is-closed",
};

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
});

let role = "";
let toast = () => {};
let records = [];
let active = null;
let searchTerm = "";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormatter.format(date);
}

function cellWithMeta(primaryText, secondaryText) {
  const cell = document.createElement("td");
  const primary = document.createElement("span");
  primary.className = "dispute-cell-primary";
  primary.textContent = primaryText;
  primary.title = primaryText;
  cell.append(primary);
  if (secondaryText) {
    const secondary = document.createElement("span");
    secondary.className = "dispute-cell-meta";
    secondary.textContent = secondaryText;
    secondary.title = secondaryText;
    cell.append(secondary);
  }
  return cell;
}

function buildRow(item) {
  const row = document.createElement("tr");
  row.className = "dispute-row";
  const open = () => setDetail(item);
  row.addEventListener("click", (event) => {
    if (event.target.closest("button, a")) return;
    open();
  });

  const idCell = cellWithMeta(item.dispute_id, "Dibuat " + formatDate(item.created_at));
  const claimCell = cellWithMeta(item.claim_id, "SEP " + (item.sep_number || "—"));

  const statusCell = document.createElement("td");
  statusCell.className = "dispute-status-cell";
  const badge = document.createElement("span");
  badge.className = "dispute-status " + (statusTone[item.status] || "is-draft");
  badge.textContent = labels[item.status] || item.status;
  statusCell.append(badge);
  if (item.reviewer_id) {
    const reviewer = document.createElement("span");
    reviewer.className = "dispute-cell-meta";
    reviewer.textContent = "Ditinjau " + item.reviewer_id;
    statusCell.append(reviewer);
  }

  const updatedCell = cellWithMeta(formatDate(item.updated_at), formatTime(item.updated_at));

  const actionCell = document.createElement("td");
  actionCell.className = "action-cell";
  const button = document.createElement("button");
  button.className = "button button-quiet dispute-open-button";
  button.type = "button";
  button.textContent = "Buka";
  button.setAttribute("aria-label", "Buka " + item.dispute_id);
  button.addEventListener("click", open);
  actionCell.append(button);

  const deleteCell = document.createElement("td");
  deleteCell.className = "delete-cell";
  if (["draft", "in_review", "needs_revision"].includes(item.status)) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "button button-delete dispute-delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Hapus";
    deleteButton.setAttribute("aria-label", `Hapus ajuan ${item.dispute_id}`);
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      const approved = window.confirm(`Hapus ajuan klarifikasi ${item.dispute_id}? Ajuan akan dikeluarkan dari daftar aktif, tetapi jejak auditnya tetap disimpan.`);
      if (!approved) return;
      deleteButton.disabled = true;
      try {
        await deleteDispute(item.dispute_id);
        toast("Ajuan klarifikasi dihapus dari daftar aktif. Jejak audit tetap tersimpan.");
        await load();
      } catch (error) {
        toast(error.message, true);
        deleteButton.disabled = false;
      }
    });
    deleteCell.append(deleteButton);
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "dispute-cell-meta";
    unavailable.textContent = "—";
    unavailable.title = "Ajuan yang sudah disetujui atau dikirim tidak dapat dihapus";
    deleteCell.append(unavailable);
  }

  row.append(idCell, claimCell, statusCell, updatedCell, actionCell, deleteCell);
  return row;
}

function emptyRow(message, hint) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.className = "table-message dispute-empty";
  const title = document.createElement("strong");
  title.textContent = message;
  cell.append(title);
  if (hint) {
    const note = document.createElement("span");
    note.textContent = hint;
    cell.append(note);
  }
  row.append(cell);
  return row;
}

function render() {
  const body = document.getElementById("disputeListBody");
  const summary = document.getElementById("disputeListSummary");
  const statusFilter = document.getElementById("disputeStatusFilter").value;
  const visible = searchTerm
    ? records.filter((item) =>
        [item.dispute_id, item.claim_id, item.sep_number, item.created_by, item.reviewer_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchTerm),
      )
    : records;

  if (!records.length) {
    summary.textContent = statusFilter ? "Tidak ada klarifikasi pada status ini" : "Belum ada klarifikasi tersimpan";
  } else if (visible.length !== records.length) {
    summary.textContent = formatNumber(visible.length) + " dari " + formatNumber(records.length) + " klarifikasi";
  } else {
    summary.textContent = formatNumber(records.length) + " klarifikasi tersimpan";
  }

  if (!visible.length) {
    let message;
    let hint;
    if (records.length) {
      message = "Tidak ada klarifikasi yang cocok";
      hint = "Ubah kata kunci atau filter status untuk melihat hasil lain.";
    } else if (statusFilter) {
      message = "Tidak ada klarifikasi pada status ini";
      hint = "Pilih status lain atau tampilkan semua status.";
    } else {
      message = "Belum ada klarifikasi";
      hint =
        role === "admin_bpjs"
          ? "Mulai dengan membuat draf dari klaim yang memiliki dasar aturan."
          : "Klarifikasi akan tampil setelah Admin Verifikator membuat draf.";
    }
    body.replaceChildren(emptyRow(message, hint));
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((item) => fragment.append(buildRow(item)));
  body.replaceChildren(fragment);
}

function openDetailOverlay() {
  const overlay = document.getElementById("disputeDetailOverlay");
  document.getElementById("disputeDetailContent").scrollTop = 0;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeDetailOverlay() {
  const overlay = document.getElementById("disputeDetailOverlay");
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  active = null;
}

function setDetail(item) {
  if (!item) return;
  active = item;
  const editable = role === "admin_bpjs" && ["draft", "needs_revision"].includes(item.status);
  document.getElementById("disputeDetailId").textContent = item.dispute_id;
  document.getElementById("disputeDetailTitle").textContent = "Klaim " + item.claim_id;
  document.getElementById("disputeDetailMeta").textContent =
    "SEP " + item.sep_number + " \u00b7 " + (labels[item.status] || item.status) + " \u00b7 template " + (item.template_code || "formal") + " \u00b7 versi " + item.current_version + (item.deadline_at ? " \u00b7 batas respons " + new Date(item.deadline_at).toLocaleString("id-ID") : "") + (item.is_overdue ? " \u00b7 menunggu " + item.review_age_hours + " jam" : "") + " \u00b7 dibuat oleh " + item.created_by;
  const latestResponse = (item.hospital_responses || []).at(-1);
  const currentStep = item.status === "closed" ? 5 : item.status === "in_review" && latestResponse?.status === "submitted" ? 3 : item.status === "in_review" ? 1 : item.status === "draft" || item.status === "needs_revision" ? 0 : item.status === "approved" ? 2 : latestResponse?.status === "submitted" ? 4 : 2;
  const steps = [
    { title: "Draf Awal", desc: "Verifikator" },
    { title: "Pemeriksaan Akhir", desc: "Validasi pasal" },
    { title: "Dikirim ke RS", desc: "Notifikasi faskes" },
    { title: "Respons RS", desc: "Sanggahan berkas" },
    { title: "Penilaian Ulang", desc: "Uji tanggapan" },
    { title: "Selesai", desc: "Tuntas audit" },
  ];
  document.getElementById("bpjsClarificationStepper").innerHTML = steps.map((step, index) => {
    const isDone = index < currentStep;
    const isCurrent = index === currentStep;
    const statusClass = isDone ? "is-done" : isCurrent ? "is-active" : "is-pending";
    const nodeIcon = isDone ? "✓" : (index + 1);
    return `
      <div class="stepper-item ${statusClass}">
        <div class="stepper-node-wrap">
          ${index > 0 ? `<div class="stepper-line stepper-line-left ${index <= currentStep ? "line-active" : ""}"></div>` : ""}
          <div class="stepper-node" aria-hidden="true">${nodeIcon}</div>
          ${index < steps.length - 1 ? `<div class="stepper-line stepper-line-right ${index < currentStep ? "line-active" : ""}"></div>` : ""}
        </div>
        <div class="stepper-content">
          <span class="stepper-title">${step.title}</span>
          <span class="stepper-desc">${step.desc}</span>
        </div>
      </div>
    `;
  }).join("");
  const editor = document.getElementById("disputeLetterBody");
  editor.value = item.letter_body;
  editor.readOnly = !editable;
  document.getElementById("disputeReviewNote").textContent = item.review_notes
    ? "Catatan Verifikator: " + item.review_notes
    : "";
  const citations = document.getElementById("disputeCitationList");
  citations.replaceChildren();
  (item.citations || []).forEach((citation) => {
    const row = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = citation.source_document + " · halaman " + citation.page_number;
    const excerpt = document.createElement("p");
    excerpt.textContent = citation.excerpt;
    row.append(title, excerpt);
    citations.append(row);
  });
  if (!item.citations?.length) {
    const empty = document.createElement("li");
    empty.className = "dispute-citation-empty";
    empty.textContent = "Belum ada kutipan regulasi yang dilampirkan pada draf ini. Tinjau dasar hukum sebelum mengirim permintaan klarifikasi.";
    citations.append(empty);
  }
  document.getElementById("disputeBpjsActions").classList.toggle("hidden", !editable);
  document.getElementById("disputeSentForm").classList.toggle("hidden", item.status !== "approved");
  document.getElementById("disputeVerifierActions").classList.toggle("hidden", role !== "admin_bpjs" || item.status !== "in_review");
  document.getElementById("approveDisputeButton").classList.toggle("hidden", item.status !== "in_review");
  document.getElementById("requestDisputeRevisionButton").classList.toggle("hidden", item.status !== "in_review");
  const history = document.getElementById("disputeHistoryList");
  history.replaceChildren();
  (item.history || []).forEach((entry) => {
    const row = document.createElement("li");
    const time = entry.created_at ? new Date(entry.created_at).toLocaleString("id-ID") : "—";
    const status = document.createElement("strong");
    status.textContent = labels[entry.to_status] || entry.to_status;
    const detail = document.createElement("span");
    detail.textContent = time + " · " + entry.actor_id + (entry.notes ? " — " + entry.notes : "");
    row.append(status, detail);
    history.append(row);
  });
  if (!(item.history || []).length) {
    const empty = document.createElement("li");
    empty.className = "dispute-citation-empty";
    empty.textContent = "Belum ada aktivitas yang tercatat.";
    history.append(empty);
  }
  const versions = document.getElementById("disputeVersionList");
  versions.replaceChildren();
  (item.versions || []).forEach((version) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Versi " + version.version_number + (version.version_number === item.current_version ? " · terbaru" : "") + " · " + new Date(version.created_at).toLocaleString("id-ID") + " · " + version.note;
    const content = document.createElement("pre");
    content.textContent = version.letter_body;
    details.append(summary, content);
    versions.append(details);
  });
  const comments = document.getElementById("disputeCommentList");
  comments.replaceChildren();
  (item.comments || []).forEach((comment) => {
    const row = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = comment.actor_role + " · " + new Date(comment.created_at).toLocaleString("id-ID");
    const content = document.createElement("p");
    content.textContent = comment.body;
    row.append(heading, content);
    comments.append(row);
  });
  const thread = document.getElementById("disputeHospitalThread");
  const responses = item.hospital_responses || [];
  thread.innerHTML = responses.length ? responses.map((response) => `<article class="rs-finding"><strong>Respons RS · versi ${response.version} · ${response.status === "submitted" ? "Dikirim" : "Draf"}</strong><p>${escapeHtml(response.explanation_type || "")} · ${escapeHtml(response.submitted_at ? new Date(response.submitted_at).toLocaleString("id-ID") : "Belum dikirim")}</p><p>${escapeHtml(response.notes || "Tidak ada catatan.")}</p><ul>${(response.documents || []).map((doc) => `<li><a href="/api/v1/disputes/documents/${encodeURIComponent(doc.id)}" target="_blank" rel="noopener">${escapeHtml(doc.filename)}</a> (${formatNumber(doc.size_bytes)} byte)</li>`).join("")}</ul></article>`).join("") : "<p>Belum ada respons dari rumah sakit.</p>";
  document.getElementById("disputeReevaluation").classList.toggle("hidden", role !== "admin_bpjs" || item.status !== "sent" || !responses.some((response) => response.status === "submitted"));
  if (item.status === "closed") {
    document.getElementById("disputeReviewNote").textContent = "Selesai di aplikasi. Status ini hanya menutup pencatatan pada KlaimGuard AI dan bukan keputusan resmi BPJS.";
  }
  document.getElementById("disputeCommentInput").value = "";
  document.getElementById("exportDisputePdfButton").textContent = ["approved", "sent", "closed"].includes(item.status) ? "Unduh PDF final" : "Export PDF draf";
  openDetailOverlay();
}

async function load() {
  const body = document.getElementById("disputeListBody");
  body.innerHTML = '<tr><td colspan="6" class="table-message">Memuat klarifikasi…</td></tr>';
  try {
    const summary = await getDisputeSummary();
    // 4 Kategori Metrik Terpadu
    const actionBpjsCount = (summary.drafts || 0) + (summary.in_review || 0) + (summary.needs_revision || 0) + (summary.waiting_reassessment || 0);
    const waitingRsCount = summary.waiting_hospital_response || summary.sent || 0;
    const completedCount = (summary.approved || 0) + (summary.closed || 0);
    const criticalCount = (summary.overdue_review || 0) + (summary.late_hospital_response || 0);

    const elAction = document.getElementById("disputeCountActionBpjs");
    if (elAction) elAction.textContent = formatNumber(actionBpjsCount);

    const elWaiting = document.getElementById("disputeCountWaitingRs");
    if (elWaiting) elWaiting.textContent = formatNumber(waitingRsCount);

    const elCompleted = document.getElementById("disputeCountCompleted");
    if (elCompleted) elCompleted.textContent = formatNumber(completedCount);

    const elCritical = document.getElementById("disputeCountCritical");
    if (elCritical) elCritical.textContent = formatNumber(criticalCount);
    const status = document.getElementById("disputeStatusFilter").value;
    records = await getDisputes(status);
    render();
    if (active) {
      const refreshed = records.find((item) => item.dispute_id === active.dispute_id);
      if (refreshed) setDetail(refreshed);
    }
  } catch (error) {
    body.innerHTML = '<tr><td colspan="6" class="table-message is-error">' + escapeHtml(error.message) + "</td></tr>";
    document.getElementById("disputeListSummary").textContent = "Gagal memuat data klarifikasi";
  }
}

async function withActive(action, successMessage) {
  if (!active) return;
  try {
    const updated = await action(active);
    toast(successMessage);
    await load();
    setDetail(updated);
  } catch (error) {
    toast(error.message, true);
  }
}

function exportPdf() {
  if (!active) return;
  if (!window.jspdf?.jsPDF) {
    window.print();
    return;
  }
  const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const isFinal = ["approved", "sent", "closed"].includes(active.status);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 19;
  const lineHeight = 4.7;
  let y = 0;
  const statusNames = {
    draft: "Draf",
    in_review: "Perlu pemeriksaan akhir",
    needs_revision: "Perlu revisi",
    approved: "Disetujui",
    sent: "Menunggu respons RS",
    closed: "Selesai di aplikasi",
    cancelled: "Dihapus",
  };
  const actionNames = {
    created: "Draf klarifikasi dibuat",
    updated: "Draf diperbarui",
    submitted_for_review: "Diajukan untuk pemeriksaan akhir",
    approved_and_sent_to_hospital: "Disetujui dan dikirim ke faskes",
    request_revision: "Revisi diminta",
    received_by_rs: "Dibuka oleh petugas RS",
    response_submitted: "Respons RS dikirim",
    accepted_hospital_response: "Respons RS diterima",
    requested_additional_clarification: "Klarifikasi tambahan diminta",
    commented: "Komentar ditambahkan",
    cancelled: "Ajuan klarifikasi dihapus",
  };
  const clean = (value) => String(value ?? "-")
    .replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2022\u00b7]/g, "-").replace(/\u00a0/g, " ");
  const drawTopBar = () => {
    pdf.setFillColor(11, 43, 29);
    pdf.rect(0, 0, pageWidth, 10, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("KLAIMGUARD AI  |  VERIFIKASI KLAIM JKN", margin, 6.5);
  };
  const drawPageHeader = (continuation = false) => {
    drawTopBar();
    pdf.setTextColor(34, 48, 66);
    if (continuation) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text(`Klarifikasi ${clean(active.dispute_id)}  |  Klaim ${clean(active.claim_id)}`, margin, 18);
      pdf.setDrawColor(222, 230, 225);
      pdf.line(margin, 22, pageWidth - margin, 22);
      y = 29;
    } else {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(17);
      pdf.text(isFinal ? "PERMINTAAN KLARIFIKASI KLAIM" : "DRAF PERMINTAAN KLARIFIKASI", margin, 23);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(93, 108, 120);
      pdf.text("Dokumen tindak lanjut verifikasi klaim JKN", margin, 29);
      pdf.setFillColor(isFinal ? 222 : 255, isFinal ? 241 : 245, isFinal ? 229 : 232);
      pdf.roundedRect(pageWidth - margin - 40, 16, 40, 10, 2, 2, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(isFinal ? 23 : 138, isFinal ? 102 : 91, isFinal ? 55 : 32);
      pdf.text(isFinal ? "FINAL" : "DRAF - TINJAU", pageWidth - margin - 36, 22.5);
      y = 38;
    }
  };
  const nextPage = () => {
    pdf.addPage();
    drawPageHeader(true);
  };
  const ensureSpace = (height) => {
    if (y + height > bottom) nextPage();
  };
  const drawSection = (title) => {
    ensureSpace(12);
    pdf.setFillColor(233, 242, 237);
    pdf.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(11, 65, 43);
    pdf.text(clean(title).toUpperCase(), margin + 3, y + 5.3);
    y += 12;
  };
  const drawParagraph = (text, options = {}) => {
    const size = options.size || 9;
    const indent = options.indent || 0;
    const availableWidth = (options.width || contentWidth) - indent;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const paragraphs = clean(text).split(/\n+/).filter(Boolean);
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const lines = pdf.splitTextToSize(paragraph, availableWidth);
      lines.forEach((line, index) => {
        ensureSpace(lineHeight + 0.5);
        pdf.setFont("helvetica", options.bold ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(...(options.color || [46, 57, 67]));
        if (options.justify && index < lines.length - 1) {
          const words = line.split(/\s+/);
          const gapCount = words.length - 1;
          const extraWidth = availableWidth - pdf.getTextWidth(line);
          if (gapCount > 0 && extraWidth > 0) {
            const gap = extraWidth / gapCount;
            let x = margin + indent;
            for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
              const word = words[wordIndex - 1];
              pdf.text(word, x, y);
              x += pdf.getTextWidth(word) + pdf.getTextWidth(" ") + gap;
            }
            pdf.text(words[words.length - 1], x, y);
          } else {
            pdf.text(line, margin + indent, y);
          }
        } else {
          pdf.text(line, margin + indent, y);
        }
        y += lineHeight;
      });
      if (paragraphIndex < paragraphs.length - 1) y += 1.2;
    });
    y += options.after ?? 1.5;
  };
  const drawLabelValue = (label, value, x, top, width) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(103, 117, 110);
    pdf.text(clean(label).toUpperCase(), x, top);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(34, 48, 66);
    const lines = pdf.splitTextToSize(clean(value), width);
    pdf.text(lines.slice(0, 2), x, top + 5);
  };
  const drawCard = (height, fill = [255, 255, 255]) => {
    ensureSpace(height + 3);
    pdf.setFillColor(...fill);
    pdf.setDrawColor(220, 229, 223);
    pdf.setLineWidth(0.25);
    pdf.roundedRect(margin, y, contentWidth, height, 2, 2, "FD");
    return y;
  };
  const generatedAt = new Date().toLocaleString("id-ID");
  drawPageHeader();

  const metaY = y;
  drawCard(48, [250, 252, 250]);
  const columnGap = 8;
  const columnWidth = (contentWidth - columnGap) / 2;
  drawLabelValue("ID Klarifikasi", active.dispute_id, margin + 5, metaY + 8, columnWidth - 5);
  drawLabelValue("ID Klaim / SEP", `${active.claim_id} / ${active.sep_number || "Tidak tersedia"}`, margin + columnWidth + columnGap, metaY + 8, columnWidth - 5);
  drawLabelValue("Faskes Penerima", active.recipient || "Belum ditautkan", margin + 5, metaY + 23, columnWidth - 5);
  drawLabelValue("Status / Template", `${statusNames[active.status] || active.status} / ${active.template_code || "formal"}`, margin + columnWidth + columnGap, metaY + 23, columnWidth - 5);
  drawLabelValue("Disusun oleh", active.created_by || "Admin Verifikator", margin + 5, metaY + 38, columnWidth - 5);
  drawLabelValue("Waktu cetak", generatedAt, margin + columnWidth + columnGap, metaY + 38, columnWidth - 5);
  y += 54;

  drawSection("Surat permintaan klarifikasi");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(34, 48, 66);
  pdf.text("Kepada Yth.", margin, y);
  y += 5;
  const recipientLines = pdf.splitTextToSize(clean(active.recipient || "Pimpinan Fasilitas Kesehatan"), contentWidth);
  pdf.setFont("helvetica", "normal");
  pdf.text(recipientLines, margin, y);
  y += recipientLines.length * lineHeight + 3;
  pdf.setFont("helvetica", "bold");
  pdf.text(`Perihal: Klarifikasi klaim ${clean(active.claim_id)}`, margin, y);
  y += 7;
  const letterBody = document.getElementById("disputeLetterBody").value || "Isi surat belum tersedia.";
  const letterParagraphs = clean(letterBody).split(/\n+/).filter(Boolean);
  letterParagraphs.forEach((paragraph, index) => {
    drawParagraph(paragraph, { size: 9, width: contentWidth - 8, indent: 4, justify: true, after: index === letterParagraphs.length - 1 ? 3 : 2 });
  });
  if (active.deadline_at) drawParagraph(`Batas respons faskes: ${new Date(active.deadline_at).toLocaleString("id-ID")}.`, { bold: true, size: 8.5, after: 2 });

  drawSection("Ringkasan temuan verifikasi");
  const findings = active.findings || [];
  if (!findings.length) {
    drawParagraph("Tidak ada temuan terstruktur yang tercatat untuk klarifikasi ini.");
  } else {
    findings.forEach((finding, index) => {
      const details = [
        finding.type ? `Kategori: ${finding.type}` : "",
        finding.description || "",
        finding.regulation_reference ? `Rujukan: ${finding.regulation_reference}` : "",
        (finding.requested_documents || []).length ? `Dokumen yang diminta: ${finding.requested_documents.join(", ")}` : "",
      ].filter(Boolean);
      const textLines = details.flatMap((item) => pdf.splitTextToSize(clean(item), contentWidth - 15));
      const cardHeight = Math.max(20, textLines.length * lineHeight + 20);
      const cardY = drawCard(cardHeight, [255, 255, 255]);
      pdf.setFillColor(21, 124, 91);
      pdf.roundedRect(margin, cardY, 2, cardHeight, 1, 1, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(25, 55, 42);
      pdf.text(`${index + 1}. ${clean(finding.title || finding.type || "Temuan verifikasi")}`, margin + 6, cardY + 7);
      y = cardY + 12;
      details.forEach((detail) => drawParagraph(detail, { indent: 6, size: 8.5, after: 0.7 }));
      y = Math.max(y, cardY + cardHeight + 3);
    });
  }

  drawSection("Dasar regulasi dan rekomendasi");
  if (active.legal_source) drawParagraph(`Sumber hukum: ${active.legal_source}`, { bold: true });
  if (active.regulation_ref) drawParagraph(`Rujukan: ${active.regulation_ref}`);
  if (active.recommendation) drawParagraph(`Rekomendasi koreksi: ${active.recommendation}`, { after: 3 });
  const citations = active.citations || [];
  if (!citations.length) {
    drawParagraph("Belum ada kutipan dokumen yang tercatat pada draf ini. Dasar hukum perlu diperiksa sebelum dokumen digunakan.", { color: [130, 91, 38] });
  } else {
    ensureSpace(36);
    drawSection("Lampiran - kutipan dokumen pendukung");
    citations.forEach((citation, index) => {
      const source = `${citation.source_document || "Dokumen regulasi"}  |  Halaman ${citation.page_number ?? "-"}`;
      const excerptLines = pdf.splitTextToSize(clean(citation.excerpt || "Kutipan tidak tersedia."), contentWidth - 14);
      let remaining = excerptLines;
      let continuation = false;
      while (remaining.length) {
        ensureSpace(24);
        const maxLines = Math.max(1, Math.floor((bottom - y - 18) / lineHeight));
        const chunk = remaining.splice(0, maxLines);
        const cardHeight = Math.max(22, chunk.length * lineHeight + 15);
        const cardY = drawCard(cardHeight, [250, 252, 250]);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.5);
        pdf.setTextColor(25, 75, 54);
        pdf.text(`${index + 1}. ${clean(source)}${continuation ? " (lanjutan)" : ""}`, margin + 6, cardY + 7);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(73, 84, 91);
        pdf.text(chunk, margin + 7, cardY + 14);
        y = cardY + cardHeight + 4;
        continuation = true;
      }
    });
  }

  drawSection("Respons dan dokumen pendukung faskes");
  const responses = active.hospital_responses || [];
  if (!responses.length) drawParagraph("Belum ada respons faskes yang tercatat.");
  responses.forEach((response) => {
    drawParagraph(`Respons versi ${response.version} - ${response.status === "submitted" ? "dikirim" : "draf"} - ${response.submitted_at ? new Date(response.submitted_at).toLocaleString("id-ID") : "waktu belum tersedia"}`, { bold: true });
    drawParagraph(`Jenis penjelasan: ${response.explanation_type || "-"}`);
    drawParagraph(response.notes || "Tidak ada catatan respons.", { indent: 4 });
    const documents = response.documents || [];
    if (documents.length) drawParagraph(`Dokumen: ${documents.map((document) => document.filename).join(", ")}`, { indent: 4, after: 3 });
  });

  drawSection("Riwayat proses klarifikasi");
  const history = active.history || [];
  if (!history.length) drawParagraph("Belum ada aktivitas proses yang tercatat.");
  history.forEach((entry, index) => {
    ensureSpace(13);
    const eventDate = entry.created_at ? new Date(entry.created_at).toLocaleString("id-ID") : "Waktu tidak tersedia";
    pdf.setFillColor(21, 124, 91);
    pdf.circle(margin + 2, y - 1, 1.1, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(34, 48, 66);
    pdf.text(`${eventDate}  |  ${actionNames[entry.action] || clean(entry.action)}`, margin + 7, y);
    y += 5;
    drawParagraph(`${statusNames[entry.to_status] || entry.to_status || "Status tercatat"} - oleh ${entry.actor_id || "pengguna"}${entry.notes ? ` - ${entry.notes}` : ""}`, { indent: 7, size: 8, color: [91, 101, 108], after: index === history.length - 1 ? 2 : 3 });
  });
  if (active.review_notes) {
    drawSection("Catatan pemeriksaan Admin Verifikator");
    drawParagraph(active.review_notes);
  }

  ensureSpace(21);
  pdf.setFillColor(isFinal ? 235 : 255, isFinal ? 246 : 248, isFinal ? 239 : 237);
  pdf.setDrawColor(isFinal ? 194 : 230, isFinal ? 222 : 216, isFinal ? 203 : 188);
  pdf.roundedRect(margin, y, contentWidth, 15, 2, 2, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(isFinal ? 23 : 138, isFinal ? 102 : 91, isFinal ? 55 : 32);
  pdf.text(isFinal ? "CATATAN STATUS" : "PERHATIAN - DRAF BELUM FINAL", margin + 4, y + 5);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(84, 96, 103);
  const note = isFinal
    ? "Dokumen mencatat proses di KlaimGuard AI. Status selesai di aplikasi bukan keputusan resmi atas klaim JKN."
    : "Tinjau isi surat, dasar regulasi, dan bukti klinis. Draf ini belum menjadi surat resmi sebelum disahkan dan dikirim.";
  pdf.text(pdf.splitTextToSize(clean(note), contentWidth - 8), margin + 4, y + 10);

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(222, 230, 225);
    pdf.line(margin, 286, pageWidth - margin, 286);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(112, 122, 128);
    pdf.text("KlaimGuard AI - Dokumen tindak lanjut verifikasi klaim", margin, 291);
    pdf.text(`Halaman ${page} dari ${pageCount}`, pageWidth - margin, 291, { align: "right" });
  }
  pdf.save("KlaimGuard-" + active.dispute_id + (isFinal ? "-final" : "-draf") + ".pdf");
  toast(isFinal ? "PDF klarifikasi berhasil diunduh." : "PDF draf klarifikasi berhasil diunduh.");
}

export function initDisputeWorkflow(currentRole, showToast) {
  role = currentRole;
  toast = showToast;
  // The detail modal is declared inside an animated tab panel. Its transform
  // creates a containing block for position:fixed, which can clip/offset it.
  // Move it to body so the modal is centered against the actual viewport.
  const detailOverlay = document.getElementById("disputeDetailOverlay");
  if (detailOverlay && detailOverlay.parentElement !== document.body) {
    document.body.append(detailOverlay);
  }
  document.getElementById("openDisputeModalButton").classList.toggle("is-hidden", role !== "admin_bpjs");
  const modal = document.getElementById("createDisputeModal");
  const claimInput = document.getElementById("newDisputeClaimId");
  const openModal = (claimId = "") => {
    claimInput.value = claimId || "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    claimInput.focus();
  };
  const closeModal = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  };
  document.getElementById("openDisputeModalButton").addEventListener("click", () => openModal());
  document.getElementById("closeDisputeModalButton").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-dispute-modal]")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });
  document.getElementById("refreshDisputesButton").addEventListener("click", load);
  const searchInput = document.getElementById("disputeSearchInput");
  const applySearch = () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    render();
  };
  searchInput.addEventListener("input", applySearch);
  searchInput.addEventListener("search", applySearch);
  document.getElementById("disputeStatusFilter").addEventListener("change", () => {
    active = null;
    closeDetailOverlay();
    load();
  });
  // Close detail overlay
  document.getElementById("closeDisputeDetailButton").addEventListener("click", closeDetailOverlay);
  document.getElementById("disputeDetailBackdrop").addEventListener("click", closeDetailOverlay);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("disputeDetailOverlay").classList.contains("hidden")) {
      closeDetailOverlay();
    }
  });
  document.getElementById("createDisputeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("newDisputeClaimId");
    const button = event.submitter;
    button.disabled = true;
    try {
      const item = await createDispute(input.value.trim(), document.getElementById("newDisputeTemplate").value);
      input.value = "";
      closeModal();
      toast("Draf " + item.dispute_id + " tersimpan.");
      await load();
      setDetail(item);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("saveDisputeButton").addEventListener("click", () =>
    withActive((item) => updateDispute(item.dispute_id, document.getElementById("disputeLetterBody").value), "Perubahan draf tersimpan."));
  document.getElementById("submitDisputeButton").addEventListener("click", () =>
    withActive(async (item) => {
      const text = document.getElementById("disputeLetterBody").value;
      if (text !== item.letter_body) await updateDispute(item.dispute_id, text);
      return submitDispute(item.dispute_id);
    }, "Draf masuk ke pemeriksaan Admin Verifikator. Setelah disetujui, klarifikasi dikirim ke RS."));
  document.getElementById("approveDisputeButton").addEventListener("click", () =>
    withActive((item) => reviewDispute(item.dispute_id, "approve", document.getElementById("disputeReviewNotes").value.trim()), "Klarifikasi disetujui dan dikirim ke rumah sakit."));
  document.getElementById("requestDisputeRevisionButton").addEventListener("click", () =>
    withActive((item) => reviewDispute(item.dispute_id, "request_revision", document.getElementById("disputeReviewNotes").value.trim()), "Catatan revisi tersimpan. Perbaiki draf lalu ajukan kembali."));
  document.getElementById("markDisputeSentButton").addEventListener("click", () =>
    withActive((item) => markDisputeSent(
      item.dispute_id,
      document.getElementById("disputeRecipient").value.trim(),
      document.getElementById("disputeReference").value.trim(),
    ), "Pengiriman klarifikasi tercatat."));
  document.getElementById("acceptHospitalResponseButton").addEventListener("click", () =>
    withActive((item) => reevaluateDispute(item.dispute_id, "accept", document.getElementById("disputeReevaluationNotes").value.trim()), "Penjelasan diterima; pencatatan selesai di aplikasi."));
  document.getElementById("requestAdditionalClarificationButton").addEventListener("click", () =>
    withActive((item) => reevaluateDispute(item.dispute_id, "request_additional", document.getElementById("disputeReevaluationNotes").value.trim()), "Klarifikasi tambahan diminta dari rumah sakit."));
  document.getElementById("exportDisputePdfButton").addEventListener("click", exportPdf);
  document.getElementById("addDisputeCommentButton").addEventListener("click", () => {
    const comment = document.getElementById("disputeCommentInput").value.trim();
    if (!active || comment.length < 3) { toast("Komentar minimal 3 karakter.", true); return; }
    withActive((item) => addDisputeComment(item.dispute_id, comment), "Komentar ditambahkan.");
  });
  document.getElementById("disputeStatusFilter").value = "";
  document.addEventListener("klaimguard:load-disputes", load);
  document.addEventListener("klaimguard:open-disputes", () => {
    document.querySelector('.sidebar-nav [data-tab="disputes"]').click();
  });
}
