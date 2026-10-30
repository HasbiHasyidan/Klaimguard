import {
  analyzeClaim,
  login,
  logout,
  getAnalytics,
  getAuditLogs,
  getHospitalActivity,
  getClaims,
  getCurrentUser,
  getRules,
  getStats,
  runBatchAudit,
  getRsDashboard,
  getRsClarifications,
  getRsClarification,
  saveRsResponse,
  uploadRsDocument,
  submitRsResponse,
  getRsProfile,
  getFacilities,
  searchFacilityClaims,
  createFacility,
} from "./api.js?v=enterprise-20";
import { openModal, closeModal } from "./components/auditModal.js?v=enterprise-11";
import { renderTable } from "./components/claimTable.js";
import { escapeHtml, formatDocumentTitle, formatIdr, formatNumber } from "./components/dom.js?v=enterprise-8";
import { initChatbot, setActiveClaim } from "./components/chatbotWidget.js?v=enterprise-12";
import { initDisputeWorkflow } from "./components/disputeWorkflow.js?v=enterprise-25";
import { renderPagination } from "./components/pagination.js?v=enterprise-2";
import { renderStats } from "./components/statsCard.js?v=enterprise-8";
import { initTheme } from "./components/themeManager.js";

const state = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  fraudType: "",
  rules: [],
  stats: null,
  analyticsData: null,
  analyticsFilter: { category: "all", cost: "all" },
  auditPage: 0,
  loading: false,
  batchResults: [],
  batchPage: 1,
  batchPageSize: 10,
  reportSources: [],
};

let financialComparisonChart;
let losCorrelationChart;
let costRiskDistChart;
let topAnomaliesChart;

let searchTimer;
let facilityClaimSearchTimer;
const selectedFacilityClaimIds = new Set();

function showToast(message, isError = false) {
  const region = document.getElementById("toastRegion");
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "is-error" : ""}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4400);
}

function configureRoleAccess(role) {
  const canAnalyze = role === "admin_bpjs";
  document.querySelector(".manual-form-section")?.classList.toggle("is-hidden", !canAnalyze);
  document.querySelector(".batch-dashboard-section")?.classList.toggle("is-hidden", !canAnalyze);
  document.getElementById("batchNavItem")?.classList.toggle("is-hidden", !canAnalyze);
  document.getElementById("batchTab")?.classList.toggle("is-hidden", !canAnalyze);
  document.getElementById("facilityNavItem")?.classList.toggle("is-hidden", !canAnalyze);
  document.getElementById("facilitiesTab")?.classList.toggle("is-hidden", !canAnalyze);
  const restrictedControls = [
    document.getElementById("batchAuditBtn"),
    ...document.querySelectorAll("#batchAuditForm input, #batchAuditForm button, [data-batch-size]"),
  ].filter(Boolean);
  restrictedControls.forEach((control) => {
    control.disabled = !canAnalyze;
    control.classList.toggle("is-hidden", !canAnalyze);
    control.title = canAnalyze ? "" : "Hanya Verifikator BPJS yang dapat menjalankan analisis.";
  });
}

function showAuthenticatedApp(user) {
  document.body.dataset.role = user.role;
  document.getElementById("loginView").classList.add("is-hidden");
  document.getElementById("appContainer").classList.remove("is-hidden");
  document.getElementById("profileName").textContent = user.user_id;
  const roleLabels = { admin_bpjs: "Admin Verifikator", petugas_klaim_rs: "Petugas Klaim RS" };
  const roleEl = document.getElementById("profileRole");
  if (roleEl) roleEl.textContent = roleLabels[user.role] || user.role;
  initTheme();
  initSidebarToggle(user.role);
  if (user.role === "petugas_klaim_rs") {
    const sidebarNav = document.querySelector("#appSidebar .sidebar-nav");
    sidebarNav.setAttribute("aria-label", "Navigasi portal rumah sakit");
    sidebarNav.innerHTML = `
      <button class="nav-item active" type="button" data-rs-tab="rsDashboardView" title="Dashboard" aria-label="Dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span class="nav-label">Dashboard</span></button>
      <button class="nav-item" id="openRsProfileButton" type="button" title="Profil Faskes" aria-label="Buka profil faskes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-4h4v4"/></svg><span class="nav-label">Profil Faskes</span></button>`;
    document.querySelectorAll("#rsClarificationModal, #rsProfileModal").forEach((modal) => document.body.append(modal));
    document.getElementById("openRsProfileButton").addEventListener("click", openRsProfileModal);
    document.querySelectorAll("[data-close-rs-clarification]").forEach((button) => button.addEventListener("click", closeRsClarificationModal));
    document.querySelectorAll("[data-close-rs-profile]").forEach((button) => button.addEventListener("click", closeRsProfileModal));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeRsClarificationModal();
        closeRsProfileModal();
      }
    });
    document.querySelector("#appSidebar .sidebar-footer").innerHTML = '<span class="sidebar-status-dot"></span> PORTAL FASKES';
    document.getElementById("appSidebar").classList.remove("is-hidden", "collapsed");
    document.getElementById("sidebarToggleBtn").setAttribute("aria-expanded", "true");
    document.getElementById("sidebarToggleBtn").setAttribute("aria-label", "Tutup sidebar");
    document.getElementById("sidebarToggleBtn").title = "Tutup sidebar";
    document.querySelectorAll("#appSidebar [data-rs-tab]").forEach((item) => item.addEventListener("click", () => {
      activateRsPortalTab(item.dataset.rsTab);
      loadRsPortal();
    }));
    document.getElementById("refreshRsPortalButton").addEventListener("click", () => loadRsPortal());
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== "rsPortalTab"));
    loadRsPortal();
    return;
  }
  initChatbot();
  initDisputeWorkflow(user.role, showToast);
  bindFilters();
  configureRoleAccess(user.role);
  activateTab("dashboard");
  loadDashboardData();
}

function initSidebarToggle(role) {
  const button = document.getElementById("sidebarToggleBtn");
  const sidebar = document.getElementById("appSidebar");
  button.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "Buka sidebar" : "Tutup sidebar");
    button.title = collapsed ? "Buka sidebar" : "Tutup sidebar";
  });
}

function activateRsPortalTab(tabId) {
  document.querySelectorAll(".rs-portal-view").forEach((view) => view.classList.toggle("hidden", view.id !== tabId));
  document.querySelectorAll("[data-rs-tab]").forEach((item) => {
    const selected = item.dataset.rsTab === tabId;
    item.classList.toggle("is-active", selected);
    item.classList.toggle("active", selected);
    item.setAttribute("aria-current", selected ? "page" : "false");
  });
}

function bindLogin() {
  const passwordInput = document.getElementById("loginPassword");
  const passwordToggle = document.getElementById("togglePasswordButton");
  passwordToggle.addEventListener("click", () => {
    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    passwordToggle.setAttribute("aria-label", showPassword ? "Sembunyikan password" : "Tampilkan password");
    passwordToggle.setAttribute("aria-pressed", String(showPassword));
    passwordToggle.querySelector(".password-eye-show").classList.toggle("is-hidden", showPassword);
    passwordToggle.querySelector(".password-eye-hide").classList.toggle("is-hidden", !showPassword);
    passwordInput.focus();
  });

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = document.getElementById("loginButton");
    const error = document.getElementById("loginError");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Memverifikasi...";
    error.textContent = "";
    try {
      // Memberikan jeda minimal 700ms agar efek verifikasi terlihat jelas dan natural
      const [user] = await Promise.all([
        login(String(form.get("username")).trim(), String(form.get("password"))),
        new Promise((resolve) => setTimeout(resolve, 750))
      ]);
      showAuthenticatedApp(user);
    } catch (loginError) {
      if (loginError.message && loginError.message.includes("Failed to fetch")) {
        error.textContent = "Gagal terhubung ke server backend. Pastikan server aktif.";
      } else {
        error.textContent = loginError.message;
      }
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
  document.getElementById("logoutButton").addEventListener("click", async () => {
    const button = document.getElementById("logoutButton");
    button.disabled = true;
    try {
      await logout();
      window.location.replace("/");
    } catch (error) {
      button.disabled = false;
      showToast(`Gagal keluar: ${error.message}`, true);
    }
  });
}

async function bootstrap() {
  bindLogin();
  try {
    const user = await getCurrentUser();
    showAuthenticatedApp(user);
  } catch {
    document.getElementById("loginView").classList.remove("is-hidden");
  }
}

const rsStatusLabels = { needs_response: "Perlu respons", responded: "Menunggu penilaian BPJS", completed: "Selesai di aplikasi" };
let activeRsClarification = null;
let activeRsTimelinePage = 1;
let rsDashboardItems = [];
const RS_DASHBOARD_PAGE_SIZE = 8;
const RS_TIMELINE_PAGE_SIZE = 5;
function openRsProfileModal() {
  const modal = document.getElementById("rsProfileModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeRsProfileModal() {
  const modal = document.getElementById("rsProfileModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function closeRsClarificationModal() {
  const modal = document.getElementById("rsClarificationModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function openRsClarificationModal() {
  const modal = document.getElementById("rsClarificationModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}
async function loadRsPortal() {
  const refreshButton = document.getElementById("refreshRsPortalButton");
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Memuat...";
  }
  try {
    const [profile, stats, items] = await Promise.all([getRsProfile(), getRsDashboard(), getRsClarifications()]);
    document.getElementById("rsFacilityName").textContent = `${profile.name} · ${profile.facility_code}`;
    const statIds = { needs_response: "rsNeedsResponse", waiting_bpjs_review: "rsWaitingReview", needs_correction: "rsNeedsCorrection", completed: "rsCompleted", approaching_deadline: "rsApproachingDeadline" };
    Object.entries(statIds).forEach(([key, id]) => { document.getElementById(id).textContent = formatNumber(stats[key] || 0); });
    rsDashboardItems = items;
    renderRsDashboardPage(1);
    const profileCard = document.getElementById("rsProfileDetails");
    profileCard.innerHTML = `<section class="rs-profile-card"><div class="rs-profile-hero"><div class="rs-profile-mark" aria-hidden="true">RS</div><div><p class="eyebrow">PROFIL FASILITAS KESEHATAN</p><h2>${escapeHtml(profile.name)}</h2><span class="rs-profile-status"><i></i> Terhubung ke portal KlaimGuard</span></div></div>
      <div class="rs-profile-details"><article><span>Kode faskes</span><strong>${escapeHtml(profile.facility_code)}</strong></article><article><span>Alamat</span><strong>${escapeHtml(profile.address || "Belum diisi")}</strong></article></div>
      <div class="rs-profile-summary"><h3>Ringkasan tindak lanjut</h3><div><article><strong>${formatNumber(stats.needs_response || 0)}</strong><span>Perlu respons</span></article><article><strong>${formatNumber(stats.waiting_bpjs_review || 0)}</strong><span>Menunggu BPJS</span></article><article><strong>${formatNumber(stats.completed || 0)}</strong><span>Selesai</span></article></div></div>
      <p class="rs-profile-note">Gunakan portal ini untuk meninjau permintaan klarifikasi, mengirim penjelasan, dan melampirkan dokumen pendukung.</p></section>`;
  } catch (error) { showToast(`Portal RS gagal dimuat: ${error.message}`, true); }
  finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻ Perbarui data";
    }
  }
}

function renderRsDashboardPage(page = 1) {
  const totalPages = Math.ceil(rsDashboardItems.length / RS_DASHBOARD_PAGE_SIZE);
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const start = (safePage - 1) * RS_DASHBOARD_PAGE_SIZE;
  const visibleItems = rsDashboardItems.slice(start, start + RS_DASHBOARD_PAGE_SIZE);
  renderRsCaseList("rsDashboardList", visibleItems);

  const pagination = document.getElementById("rsDashboardPagination");
  if (!rsDashboardItems.length) {
    pagination.replaceChildren();
    return;
  }
  renderPagination({
    current_page: safePage,
    total_pages: totalPages,
    total_records: rsDashboardItems.length,
    limit: RS_DASHBOARD_PAGE_SIZE,
    item_label: "klarifikasi",
  }, renderRsDashboardPage, "rsDashboardPagination");
}

function renderRsCaseList(targetId, items) {
  const list = document.getElementById(targetId);
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p"); empty.className = "table-message"; empty.textContent = "Belum ada permintaan untuk faskes ini. Klarifikasi baru muncul setelah Admin Verifikator menyetujui dan mengirimnya. Pastikan profil faskes sesuai, lalu pilih Perbarui data."; list.append(empty); return;
  }
  items.forEach((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "rs-clarification-item";
    const title = document.createElement("strong"); title.textContent = `${item.clarification_id} · ${item.claim_id}`;
    const status = document.createElement("span"); status.textContent = item.status === "needs_response" && (item.response_version || 0) > 1 ? "Perlu perbaikan" : (rsStatusLabels[item.status] || item.status);
    const due = document.createElement("small"); due.textContent = `Batas respons ${item.deadline_at ? new Date(item.deadline_at).toLocaleString("id-ID") : "belum tersedia"}`;
    button.append(title, status, due); button.addEventListener("click", async () => {
      await openRsClarification(item.clarification_id);
    }); list.append(button);
  });
}

async function openRsClarification(id) {
  try {
    const isDifferentClarification = activeRsClarification?.clarification_id !== id;
    activeRsClarification = await getRsClarification(id);
    if (isDifferentClarification) activeRsTimelinePage = 1;
    const item = activeRsClarification;
    document.getElementById("rsClarificationModalTitle").textContent = `Klarifikasi ${item.clarification_id} · Klaim ${item.claim_id}`;
    const target = document.getElementById("rsClarificationDetail");
    const findings = item.findings.map((finding) => `<article class="rs-finding"><span class="dispute-status">${escapeHtml(finding.type)}</span><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.description)}</p><p class="rs-regulation">${escapeHtml(finding.regulation_reference)}</p><ul>${finding.requested_documents.map((doc) => `<li>${escapeHtml(doc)}</li>`).join("")}</ul></article>`).join("");
    const docs = item.response?.documents?.map((doc) => `<li><a href="/api/v1/rs/documents/${encodeURIComponent(doc.id)}" target="_blank" rel="noopener">${escapeHtml(doc.filename)}</a></li>`).join("") || "";
    const locked = item.response?.status === "submitted";
    target.innerHTML = `<header class="rs-detail-heading"><div><p class="eyebrow">${escapeHtml(item.clarification_id)}</p><h2>Klaim ${escapeHtml(item.claim_id)}</h2><p>SEP ${escapeHtml(item.sep_number || "-")} · ${escapeHtml(item.facility_name)}</p><p>Diterbitkan ${item.issued_at ? new Date(item.issued_at).toLocaleDateString("id-ID") : "-"} · Batas respons ${item.deadline_at ? new Date(item.deadline_at).toLocaleString("id-ID") : "-"}</p></div><span class="dispute-status">${escapeHtml(rsStatusLabels[item.status] || item.status)}</span></header>
      <div class="rs-stepper"><span class="is-complete">Dikirim BPJS</span><span class="${item.received_at ? "is-complete" : ""}">Diterima RS</span><span class="${item.status === "responded" || item.status === "completed" ? "is-complete" : ""}">Direspons RS</span><span class="${item.status === "completed" ? "is-complete" : ""}">Dinilai Ulang</span><span class="${item.status === "completed" ? "is-complete" : ""}">Selesai</span></div>${item.status === "completed" ? '<p class="rs-locked-note">Selesai di aplikasi. Ini hanya menutup pencatatan pada KlaimGuard AI, bukan keputusan resmi BPJS.</p>' : ""}
      <section class="rs-claim-summary"><h3>Ringkasan klaim</h3><p>${escapeHtml(item.claim_summary.doctor_notes)}</p><p>Kode: ${escapeHtml(item.claim_summary.billing_codes)} · Lama rawat: ${item.claim_summary.length_of_stay} hari</p></section>
      <section><h3>Temuan dan dokumen yang diminta</h3><div class="rs-findings">${findings}</div></section>
      <section class="rs-response-form"><h3>Respons rumah sakit</h3>${item.followup_notes ? `<p class="rs-locked-note">Permintaan tambahan dari BPJS: ${escapeHtml(item.followup_notes)}</p>` : ""}${locked ? `<p class="rs-locked-note">Respons versi ${item.response.version} sudah dikirim dan terkunci.</p>` : `<label>Jenis penjelasan<select id="rsExplanationType"><option value="administratif">Administratif</option><option value="koding">Koding</option><option value="klinis">Klinis</option></select></label><label>Catatan respons<textarea id="rsResponseNotes" rows="5" maxlength="10000" placeholder="Tuliskan penjelasan dan dokumen pendukung..."></textarea></label><label>Unggah dokumen (PDF/JPG, maks. 10 MB per file)<input id="rsResponseFiles" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" multiple /></label><div class="rs-form-actions"><button class="button button-quiet" id="rsSaveDraftButton" type="button">Simpan Draf</button><button class="button button-primary" id="rsSubmitResponseButton" type="button">Kirim Respons</button></div>`}<ul class="rs-document-list">${docs}</ul></section>
      <section class="rs-timeline-section"><h3>Riwayat aktivitas</h3><ol class="rs-timeline" id="rsTimelineList"></ol><nav class="rs-timeline-pagination" id="rsTimelinePagination" aria-label="Halaman riwayat aktivitas"></nav></section>`;
    renderRsTimeline(item.timeline || []);
    if (!locked && item.response) {
      document.getElementById("rsExplanationType").value = item.response.explanation_type || "administratif";
      document.getElementById("rsResponseNotes").value = item.response.notes || "";
    }
    if (!locked) bindRsResponseActions(item.clarification_id);
    openRsClarificationModal();
  } catch (error) { showToast(error.message, true); }
}

function renderRsTimeline(entries) {
  const list = document.getElementById("rsTimelineList");
  const controls = document.getElementById("rsTimelinePagination");
  if (!list || !controls) return;
  const totalPages = Math.max(1, Math.ceil(entries.length / RS_TIMELINE_PAGE_SIZE));
  activeRsTimelinePage = Math.min(Math.max(1, activeRsTimelinePage), totalPages);
  const start = (activeRsTimelinePage - 1) * RS_TIMELINE_PAGE_SIZE;
  const visible = entries.slice(start, start + RS_TIMELINE_PAGE_SIZE);
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.textContent = "Belum ada aktivitas.";
    list.append(empty);
  } else {
    visible.forEach((entry) => {
      const row = document.createElement("li");
      const action = document.createElement("strong");
      action.textContent = entry.action || "Aktivitas";
      const detail = document.createElement("span");
      const when = entry.at ? new Date(entry.at).toLocaleString("id-ID") : "Waktu tidak tersedia";
      detail.textContent = `${when}${entry.notes ? ` · ${entry.notes}` : ""}`;
      row.append(action, detail);
      list.append(row);
    });
  }
  controls.replaceChildren();
  if (totalPages <= 1) return;
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "button button-quiet";
  previous.textContent = "Sebelumnya";
  previous.disabled = activeRsTimelinePage === 1;
  previous.addEventListener("click", () => { activeRsTimelinePage -= 1; renderRsTimeline(entries); });
  const page = document.createElement("span");
  page.textContent = `Halaman ${activeRsTimelinePage} dari ${totalPages}`;
  const next = document.createElement("button");
  next.type = "button";
  next.className = "button button-quiet";
  next.textContent = "Berikutnya";
  next.disabled = activeRsTimelinePage === totalPages;
  next.addEventListener("click", () => { activeRsTimelinePage += 1; renderRsTimeline(entries); });
  controls.append(previous, page, next);
}

function bindRsResponseActions(id) {
  document.getElementById("rsResponseFiles").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    for (const file of files) {
      try { await uploadRsDocument(id, file); showToast(`${file.name} diunggah.`); }
      catch (error) { showToast(error.message, true); }
    }
    await openRsClarification(id);
  });
  document.getElementById("rsSaveDraftButton").addEventListener("click", async () => {
    try {
      await saveRsResponse(id, document.getElementById("rsExplanationType").value, document.getElementById("rsResponseNotes").value);
      showToast("Draf respons tersimpan."); await openRsClarification(id); await loadRsPortal();
    } catch (error) { showToast(error.message, true); }
  });
  document.getElementById("rsSubmitResponseButton").addEventListener("click", async () => {
    try {
      await saveRsResponse(id, document.getElementById("rsExplanationType").value, document.getElementById("rsResponseNotes").value);
      await submitRsResponse(id); showToast("Respons berhasil dikirim ke BPJS.");
      await openRsClarification(id); await loadRsPortal();
    } catch (error) { showToast(error.message, true); }
  });
}

function setConnectionStatus(connected, totalClaims = 0) {
  const status = document.getElementById("connectionStatus");
  if (!status) return;
  const text = status.querySelector(".status-text");
  const dot = status.querySelector(".status-dot");
  if (connected) {
    text.textContent = `Terhubung: INA-CBGs Engine v5.5 (${formatNumber(totalClaims)} Klaim)`;
    status.classList.add("status-connected");
    status.classList.remove("status-disconnected");
  } else {
    text.textContent = "Koneksi backend bermasalah";
    status.classList.add("status-disconnected");
    status.classList.remove("status-connected");
  }
  dot?.classList.toggle("is-error", !connected);
}

function setTableMessage(message, isError = false) {
  const body = document.getElementById("claimsTableBody");
  body.innerHTML = `<tr><td colspan="7" class="table-message ${isError ? "is-error" : ""}">${escapeHtml(message)}</td></tr>`;
}

async function loadDashboardData() {
  if (state.loading) return;
  state.loading = true;
  try {
    const [stats, pageData, rules] = await Promise.all([
      getStats(),
      getClaims(state.page, state.limit, state.search, state.status, state.fraudType),
      state.rules.length ? Promise.resolve(state.rules) : getRules(),
    ]);
    state.rules = rules;
    state.stats = stats;
    renderStats(stats);
    renderTable(pageData.data, (claim) => {
      setActiveClaim(claim.claim_id);
      openModal(claim, async () => {
        await loadDashboardData();
        showToast("Keputusan manusia tercatat pada audit trail.");
      });
    }, rules);
    renderPagination({ ...pageData, limit: state.limit }, (page) => {
      if (page < 1 || page > pageData.total_pages || page === state.page) return;
      state.page = page;
      loadDashboardData();
    });
    document.getElementById("resultSummary").textContent = `${formatNumber(pageData.total_records)} klaim ditemukan dalam hasil filter`;
    setConnectionStatus(true, stats.total_claims);
  } catch (error) {
    setConnectionStatus(false);
    setTableMessage(`Data tidak dapat dimuat: ${error.message}`, true);
    showToast(error.message, true);
  } finally {
    state.loading = false;
  }
}

function bindFilters() {
  document.getElementById("claimSearch").addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = event.target.value;
      state.page = 1;
      loadDashboardData();
    }, 300);
  });
  document.getElementById("statusFilter").addEventListener("change", (event) => {
    state.status = event.target.value;
    state.page = 1;
    loadDashboardData();
  });
  document.getElementById("categoryFilter").addEventListener("change", (event) => {
    state.fraudType = event.target.value;
    state.page = 1;
    loadDashboardData();
  });
  document.getElementById("pageSize").addEventListener("change", (event) => {
    state.limit = Number(event.target.value);
    state.page = 1;
    loadDashboardData();
  });
  document.getElementById("refreshButton").addEventListener("click", loadDashboardData);
  document.getElementById("batchAuditBtn").addEventListener("click", () => {
    runBatch(100, document.getElementById("batchAuditBtn"));
  });
  document.getElementById("batchAuditForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const limit = Number(document.getElementById("batchLimit").value);
    runBatch(limit, document.getElementById("batchRunButton"));
  });
  document.querySelectorAll("[data-batch-size]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("batchLimit").value = chip.dataset.batchSize;
      document.querySelectorAll("[data-batch-size]").forEach((item) => item.classList.toggle("is-active", item === chip));
    });
  });
  document.getElementById("toggleManualFormBtn")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    document.getElementById("manualFormCollapse")?.classList.toggle("is-open", expanded);
    document.getElementById("manualFormCollapse")?.setAttribute("aria-hidden", String(!expanded));
  });
  document.getElementById("refreshAuditButton").addEventListener("click", loadAuditHistory);
  document.getElementById("refreshAnalyticsBtn")?.addEventListener("click", loadReportData);
  document.getElementById("exportPdfBtn")?.addEventListener("click", exportReportPdf);
  document.getElementById("analyticsCategoryFilter")?.addEventListener("change", (e) => {
    state.analyticsFilter.category = e.target.value;
    applyAnalyticsFilter();
  });
  document.getElementById("analyticsCostFilter")?.addEventListener("change", (e) => {
    state.analyticsFilter.cost = e.target.value;
    applyAnalyticsFilter();
  });
  document.querySelectorAll("[data-analytics-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-analytics-preset]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const preset = btn.dataset.analyticsPreset;
      const catSelect = document.getElementById("analyticsCategoryFilter");
      const costSelect = document.getElementById("analyticsCostFilter");
      if (preset === "all") {
        if (catSelect) catSelect.value = "all";
        if (costSelect) costSelect.value = "all";
        state.analyticsFilter = { category: "all", cost: "all" };
      } else if (preset === "upcoding") {
        if (catSelect) catSelect.value = "upcoding";
        if (costSelect) costSelect.value = "all";
        state.analyticsFilter = { category: "upcoding", cost: "all" };
      } else if (preset === "unbundling") {
        if (catSelect) catSelect.value = "unbundling";
        if (costSelect) costSelect.value = "all";
        state.analyticsFilter = { category: "unbundling", cost: "all" };
      } else if (preset === "high_risk") {
        if (costSelect) costSelect.value = "critical";
        state.analyticsFilter.cost = "critical";
      }
      applyAnalyticsFilter();
    });
  });
  document.getElementById("claimForm")?.addEventListener("submit", analyzeManualClaim);
  document.getElementById("facilityCreateForm").addEventListener("submit", submitFacilityForm);
  document.getElementById("facilityClaimPicker").addEventListener("change", updateSelectedFacilityClaims);
  document.getElementById("facilityClaimSearch").addEventListener("input", () => {
    window.clearTimeout(facilityClaimSearchTimer);
    facilityClaimSearchTimer = window.setTimeout(() => loadFacilityClaimOptions(), 250);
  });
  document.getElementById("refreshFacilitiesButton").addEventListener("click", loadFacilitiesPanel);
  document.querySelectorAll(".sidebar-nav [data-tab]").forEach((item) => {
    item.addEventListener("click", () => activateTab(item.dataset.tab));
  });
}

function renderBatchResultsPage(page = state.batchPage) {
  const section = document.getElementById("batchResultTableSection");
  const total = state.batchResults.length;
  const totalPages = Math.ceil(total / state.batchPageSize);
  if (!total) {
    section.classList.add("hidden");
    return;
  }
  state.batchPage = page;
  section.classList.remove("hidden");
  const pageClaims = state.batchResults.slice(
    (page - 1) * state.batchPageSize,
    page * state.batchPageSize,
  );
  renderTable(pageClaims, (claim) => {
    setActiveClaim(claim.claim_id);
    openModal(claim, async () => {
      await loadDashboardData();
      showToast("Keputusan manusia tercatat pada audit trail.");
    });
  }, state.rules, "batchResultsTableBody");
  renderPagination(
    { total_records: total, current_page: page, total_pages: totalPages, limit: state.batchPageSize },
    renderBatchResultsPage,
    "batchResultsPaginationContainer",
  );
}

async function runBatch(limit = 100, button = document.getElementById("batchAuditBtn")) {
  const label = button.querySelector(".button-label");
  const original = label?.textContent || button.textContent;
  button.disabled = true;
  button.classList.add("is-loading");
  if (label) label.textContent = "Memeriksa klaim…";
  try {
    const result = await runBatchAudit(limit);
    showToast(`${formatNumber(result.processed_count)} klaim diproses · ${formatNumber(result.flagged_count)} ditandai · ${formatIdr(result.total_saved_idr)} potensi hemat`);
    const resultPanel = document.getElementById("batchResults");
    resultPanel.innerHTML = [
      ["Klaim diproses", formatNumber(result.processed_count)],
      ["Indikasi anomali", formatNumber(result.flagged_count)],
      ["Klaim aman", formatNumber(result.processed_count - result.flagged_count)],
      ["Potensi hemat", formatIdr(result.total_saved_idr)],
    ].map(([title, value]) => `<div class="batch-result-item"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    resultPanel.classList.remove("hidden");
    const batchSummary = document.getElementById("batchSummary");
    const processedCount = Number(result.processed_count) || 0;
    const flaggedCount = Number(result.flagged_count) || 0;
    const flaggedRate = processedCount ? (flaggedCount / processedCount) * 100 : 0;
    const duration = Number(result.execution_time_seconds) || 0;
    batchSummary.innerHTML = [
      ["Total Processed", formatNumber(processedCount)],
      ["Flagged Rate", `${flaggedRate.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`],
      ["Estimasi Durasi Pemrosesan", `${duration.toLocaleString("id-ID", { maximumFractionDigits: 2 })} dtk`],
    ].map(([title, value]) => `<div class="batch-summary-item"><span>${escapeHtml(title)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    batchSummary.classList.remove("hidden");
    state.batchResults = Array.isArray(result.results) ? result.results : [];
    renderBatchResultsPage(1);
    await loadDashboardData();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    if (label) label.textContent = original;
    else button.textContent = original;
  }
}

function activateTab(tabName) {
  if (tabName === "batch" && document.body.dataset.role !== "admin_bpjs") return;
  if (tabName === "facilities" && document.body.dataset.role !== "admin_bpjs") return;
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `${tabName}Tab`);
  });
  document.querySelectorAll(".sidebar-nav [data-tab]").forEach((item) => {
    const active = item.dataset.tab === tabName;
    item.classList.toggle("active", active);
    item.setAttribute("aria-current", active ? "page" : "false");
  });
  if (tabName === "audit") { loadAuditHistory(); loadHospitalActivity(); }
  if (tabName === "disputes") document.dispatchEvent(new Event("klaimguard:load-disputes"));
  if (tabName === "reports") loadReportData();
  if (tabName === "facilities") loadFacilitiesPanel();
}

async function loadFacilitiesPanel() {
  try {
    const facilities = await getFacilities();
    const body = document.getElementById("facilityListBody");
    body.replaceChildren();
    document.getElementById("facilityCountLabel").textContent = `${formatNumber(facilities.length)} faskes terdaftar`;
    if (!facilities.length) {
      body.innerHTML = '<tr><td colspan="4" class="table-message">Belum ada faskes terdaftar.</td></tr>';
    } else {
      facilities.forEach((facility) => {
        const row = document.createElement("tr");
        [facility.name, facility.facility_code, facility.username || "Akun belum tersedia", formatNumber(facility.claim_count)].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        });
        body.append(row);
      });
    }
    await loadFacilityClaimOptions();
  } catch (error) {
    document.getElementById("facilityListBody").innerHTML = `<tr><td colspan="4" class="table-message is-error">${escapeHtml(error.message)}</td></tr>`;
    document.getElementById("facilityCountLabel").textContent = "Data faskes tidak dapat dimuat";
  }
}

async function loadFacilityClaimOptions() {
  const picker = document.getElementById("facilityClaimPicker");
  try {
    const claims = await searchFacilityClaims(document.getElementById("facilityClaimSearch").value.trim());
    picker.replaceChildren();
    claims.forEach((claim) => {
      const option = document.createElement("option");
      option.value = claim.claim_id;
      option.textContent = claim.current_facility
        ? `${claim.claim_id} · saat ini: ${claim.current_facility}`
        : `${claim.claim_id} · belum dialokasikan`;
      option.selected = selectedFacilityClaimIds.has(claim.claim_id);
      picker.append(option);
    });
    if (!claims.length) {
      const option = document.createElement("option");
      option.disabled = true;
      option.textContent = "Klaim tidak ditemukan";
      picker.append(option);
    }
  } catch (error) {
    picker.replaceChildren();
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = error.message;
    picker.append(option);
  }
}

function updateSelectedFacilityClaims() {
  const picker = document.getElementById("facilityClaimPicker");
  const visible = [...picker.options].filter((option) => option.value);
  visible.forEach((option) => {
    if (option.selected) selectedFacilityClaimIds.add(option.value);
    else selectedFacilityClaimIds.delete(option.value);
  });
}

async function submitFacilityForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById("facilityFormResult");
  const button = document.getElementById("createFacilityButton");
  if (!selectedFacilityClaimIds.size) {
    result.textContent = "Pilih setidaknya satu klaim untuk dialokasikan ke faskes.";
    result.classList.add("is-error");
    return;
  }
  button.disabled = true;
  button.textContent = "Mendaftarkan...";
  result.textContent = "";
  result.classList.remove("is-error");
  try {
    const created = await createFacility({
      name: document.getElementById("facilityNameInput").value.trim(),
      facility_code: document.getElementById("facilityCodeInput").value.trim(),
      address: document.getElementById("facilityAddressInput").value.trim(),
      username: document.getElementById("facilityUsernameInput").value.trim(),
      password: document.getElementById("facilityPasswordInput").value,
      claim_ids: [...selectedFacilityClaimIds],
    });
    result.textContent = `Faskes ${created.name} terdaftar. Akun ${created.username} dibuat dan ${formatNumber(created.assigned_claims)} klaim dialokasikan.`;
    form.reset();
    selectedFacilityClaimIds.clear();
    await loadFacilitiesPanel();
    showToast("Faskes berhasil didaftarkan.");
  } catch (error) {
    result.textContent = error.message;
    result.classList.add("is-error");
  } finally {
    button.disabled = false;
    button.textContent = "Daftarkan Faskes";
  }
}

async function loadAuditHistory(page) {
  const body = document.getElementById("auditHistoryBody");
  body.innerHTML = '<tr><td colspan="5" class="table-message">Memuat riwayat...</td></tr>';
  try {
    const targetPage = page || 1;
    const pageData = await getAuditLogs(targetPage, state.limit);
    state.auditPage = targetPage;
    if (!pageData.data.length) {
      body.innerHTML = '<tr><td colspan="5" class="table-message">Belum ada keputusan audit yang tersimpan.</td></tr>';
    } else {
      body.innerHTML = pageData.data.map((entry) => {
        const created = entry.timestamp ? new Date(entry.timestamp).toLocaleString("id-ID") : "-";
        return `<tr><td>${escapeHtml(created)}</td><td><strong>${escapeHtml(entry.claim_id)}</strong></td><td>${escapeHtml(entry.verifier_id)}</td><td>${escapeHtml(entry.decision)}</td><td>${escapeHtml(entry.notes || "-")}</td></tr>`;
      }).join("");
    }
    renderPagination(pageData, (nextPage) => loadAuditHistory(nextPage), "auditPagination");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5" class="table-message is-error">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadHospitalActivity(page = 1) {
  const body = document.getElementById("hospitalActivityBody");
  const pagination = document.getElementById("hospitalActivityPagination");
  try {
    const pageSize = 10;
    const result = await getHospitalActivity(page, pageSize);
    body.replaceChildren();
    if (!result.data.length) {
      const row = document.createElement("tr"); row.innerHTML = '<td colspan="6" class="table-message">Belum ada aktivitas portal RS.</td>'; body.append(row);
      pagination.replaceChildren();
      return;
    }
    result.data.forEach((entry) => {
      const row = document.createElement("tr");
      [entry.created_at ? new Date(entry.created_at).toLocaleString("id-ID") : "-", entry.user_id, entry.facility_code, entry.dispute_case_id || "-", entry.action, [entry.response_version ? `Versi ${entry.response_version}` : "", entry.details || ""].filter(Boolean).join(" · ") || "-"].forEach((value) => {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      });
      body.append(row);
    });
    renderPagination({ ...result, limit: pageSize, item_label: "aktivitas RS" }, (nextPage) => loadHospitalActivity(nextPage), "hospitalActivityPagination");
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="table-message is-error">${escapeHtml(error.message)}</td></tr>`;
    pagination.replaceChildren();
  }
}

const CLINICAL_CODE_NAMES = {
  '["H10.9", "13.41"]': "Katarak & Fakoemulsifikasi [H10.9, 13.41]",
  '["I25.9", "R57.0"]': "Iskemia Jantung + Syok Kardiogenik [I25.9, R57.0]",
  '["A01.0", "A09"]': "Demam Tifoid + Diare Berat [A01.0, A09]",
  '["D64.9", "D61.9"]': "Anemia Defisiensi + Anemia Aplastik [D64.9, D61.9]",
  '["I10", "N17"]': "Hipertensi + Gagal Ginjal Akut [I10, N17]",
  '["K29.1", "K92.1"]': "Gastritis Akut + Perdarahan Lambung [K29.1, K92.1]",
  '["E11.9", "R02"]': "Diabetes Melitus + Gangren [E11.9, R02]",
  '["47.09", "54.11"]': "Apendektomi + Laparatomi Eksplorasi [47.09, 54.11]",
  '["J06.9", "J20.9"]': "ISPA + Bronkitis Akut [J06.9, J20.9]",
  '["39.95", "99.21"]': "Hemodialisa + Injeksi Terpisah [39.95, 99.21]",
};

function formatMiliar(num) {
  if (num >= 1000000000) {
    return (num / 1000000000).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " M";
  }
  if (num >= 1000000) {
    return (num / 1000000).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " Jt";
  }
  return formatNumber(num);
}

function applyAnalyticsFilter() {
  const { category, cost } = state.analyticsFilter;
  const statusEl = document.getElementById("analyticsFilterStatus");
  let filterText = [];
  if (category !== "all") filterText.push(`Kategori: ${category.toUpperCase()}`);
  if (cost !== "all") filterText.push(`Biaya: ${cost}`);
  if (statusEl) {
    statusEl.textContent = filterText.length
      ? `Filter Aktif: ${filterText.join(" · ")}`
      : "Menampilkan data menyeluruh";
  }
  renderAllAnalyticsCharts();
}

function getChartThemeColors() {
  const isDark = document.body.classList.contains("dark-mode");
  return {
    textColor: isDark ? "#94a3b8" : "#475569",
    gridColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
    cardBg: isDark ? "#1b2922" : "#ffffff",
    titleColor: isDark ? "#f8fafc" : "#1e293b",
  };
}

window.addEventListener("klaimguard:theme-change", () => {
  if (state.analyticsData) {
    renderAllAnalyticsCharts();
  }
});

function renderAllAnalyticsCharts() {
  const analytics = state.analyticsData;
  if (!analytics || typeof window.Chart === "undefined") return;
  const filterCat = state.analyticsFilter.category;
  const chartTheme = getChartThemeColors();

  // Chart 1: Financial Comparison (Grouped Bar)
  financialComparisonChart?.destroy();
  const fin = analytics.financial_summary;
  let labels = ["Klaim Aman", "Upcoding", "Unbundling"];
  let chargeData = [fin.safe_charge, fin.upcoding_charge, fin.unbundling_charge];
  let approvedData = [fin.safe_approved, fin.upcoding_approved, fin.unbundling_approved];
  let savingData = [0, fin.upcoding_saving, fin.unbundling_saving];

  if (filterCat === "upcoding") {
    labels = ["Upcoding"];
    chargeData = [fin.upcoding_charge];
    approvedData = [fin.upcoding_approved];
    savingData = [fin.upcoding_saving];
  } else if (filterCat === "unbundling") {
    labels = ["Unbundling"];
    chargeData = [fin.unbundling_charge];
    approvedData = [fin.unbundling_approved];
    savingData = [fin.unbundling_saving];
  } else if (filterCat === "safe") {
    labels = ["Klaim Aman"];
    chargeData = [fin.safe_charge];
    approvedData = [fin.safe_approved];
    savingData = [0];
  }

  const ctx1 = document.getElementById("financialComparisonChart");
  if (ctx1) {
    financialComparisonChart = new window.Chart(ctx1, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Total Tagihan RS",
            data: chargeData,
            backgroundColor: "#0284c7",
            borderRadius: 6,
          },
          {
            label: "Tarif Disetujui INA-CBG",
            data: approvedData,
            backgroundColor: "#10b981",
            borderRadius: 6,
          },
          {
            label: "Potensi Penghematan",
            data: savingData,
            backgroundColor: "#ef4444",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: chartTheme.textColor, boxWidth: 12, font: { size: 11, family: "Plus Jakarta Sans" } } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatIdr(context.raw)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              color: chartTheme.textColor,
              callback: (value) => "Rp " + formatMiliar(value),
              font: { size: 10 },
            },
            grid: { color: chartTheme.gridColor },
          },
          x: {
            ticks: { color: chartTheme.textColor, font: { size: 11, weight: "600" } },
            grid: { color: chartTheme.gridColor },
          },
        },
      },
    });
  }

  // Chart 2: LOS Correlation (Dual Axis: Bar + Line)
  losCorrelationChart?.destroy();
  const losItems = analytics.los_breakdown || [];
  const losLabels = losItems.map((item) => `${item.length_of_stay} Hari`);
  const losVolume = losItems.map((item) => item.count);
  const losFraudRate = losItems.map((item) => item.fraud_rate_pct);
  const losAvgCharge = losItems.map((item) => item.avg_charge);

  const ctx2 = document.getElementById("losCorrelationChart");
  if (ctx2) {
    losCorrelationChart = new window.Chart(ctx2, {
      data: {
        labels: losLabels,
        datasets: [
          {
            type: "bar",
            label: "Volume Pasien",
            data: losVolume,
            backgroundColor: "rgba(14, 165, 233, 0.45)",
            borderColor: "#0284c7",
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "Tingkat Anomali (%)",
            data: losFraudRate,
            borderColor: "#dc2626",
            backgroundColor: "#dc2626",
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.35,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", labels: { color: chartTheme.textColor, boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const idx = ctx.dataIndex;
                return `Rata-rata Tagihan: ${formatIdr(losAvgCharge[idx])}`;
              },
            },
          },
        },
        scales: {
          y: {
            type: "linear",
            position: "left",
            beginAtZero: true,
            title: { display: true, text: "Jumlah Klaim", color: chartTheme.textColor, font: { size: 10 } },
            ticks: { color: chartTheme.textColor, font: { size: 10 } },
            grid: { color: chartTheme.gridColor },
          },
          y1: {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            title: { display: true, text: "% Anomali", color: chartTheme.textColor, font: { size: 10 } },
            ticks: {
              color: chartTheme.textColor,
              callback: (v) => v + "%",
              font: { size: 10 },
            },
            grid: { drawOnChartArea: false },
          },
          x: {
            ticks: { color: chartTheme.textColor, font: { size: 10 } },
            grid: { color: chartTheme.gridColor },
          },
        },
      },
    });
  }

  // Chart 3: Cost Risk Distribution (Segmented Donut)
  costRiskDistChart?.destroy();
  const buckets = analytics.cost_buckets || [];
  const bucketLabels = buckets.map((b) => `${b.bucket} (${b.fraud_rate_pct}% anomali)`);
  const bucketCounts = buckets.map((b) => b.count);
  const bucketSavings = buckets.map((b) => b.total_saving);

  const ctx3 = document.getElementById("costRiskDistChart");
  if (ctx3) {
    costRiskDistChart = new window.Chart(ctx3, {
      type: "doughnut",
      data: {
        labels: bucketLabels,
        datasets: [
          {
            data: bucketCounts,
            backgroundColor: ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"],
            borderColor: chartTheme.cardBg,
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "60%",
        plugins: {
          legend: { position: "bottom", labels: { color: chartTheme.textColor, boxWidth: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                return ` ${formatNumber(bucketCounts[idx])} Klaim · Potensi Hemat: ${formatIdr(bucketSavings[idx])}`;
              },
            },
          },
        },
      },
    });
  }

  // Chart 4: Top Anomalies (Horizontal Bar)
  topAnomaliesChart?.destroy();
  let anomalyList = analytics.top_anomalies || [];
  if (filterCat !== "all") {
    anomalyList = anomalyList.filter((a) => a.fraud_type === filterCat);
  }
  const top8 = anomalyList.slice(0, 8);
  const anomalyLabels = top8.map((a) => CLINICAL_CODE_NAMES[a.admin_billing_code] || a.admin_billing_code);
  const anomalyValues = top8.map((a) => a.total_saving);
  const anomalyColors = top8.map((a) => a.fraud_type === "upcoding" ? "#ef4444" : "#f59e0b");

  const ctx4 = document.getElementById("topAnomaliesChart");
  if (ctx4) {
    topAnomaliesChart = new window.Chart(ctx4, {
      type: "bar",
      data: {
        labels: anomalyLabels,
        datasets: [
          {
            label: "Potensi Penghematan",
            data: anomalyValues,
            backgroundColor: anomalyColors,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = top8[ctx.dataIndex];
                return [
                  `Potensi Hemat: ${formatIdr(item.total_saving)}`,
                  `Total: ${formatNumber(item.count)} Klaim · Tipe: ${item.fraud_type.toUpperCase()}`,
                  `Regulasi: ${item.rule_code} (${item.regulation_ref})`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              color: chartTheme.textColor,
              callback: (v) => "Rp " + formatMiliar(v),
              font: { size: 10 },
            },
            grid: { color: chartTheme.gridColor },
          },
          y: {
            ticks: {
              color: chartTheme.textColor,
              font: { size: 10, weight: "600" },
              callback: function(val) {
                const label = this.getLabelForValue(val);
                return label.length > 28 ? label.substring(0, 26) + "…" : label;
              },
            },
            grid: { color: chartTheme.gridColor },
          },
        },
      },
    });
  }
}

async function loadReportData() {
  const summary = document.getElementById("reportSummary");
  try {
    const [data, analytics, rules] = await Promise.all([
      state.stats || getStats(),
      getAnalytics(),
      state.rules.length ? Promise.resolve(state.rules) : getRules(),
    ]);

    state.stats = data;
    state.analyticsData = analytics;
    state.rules = rules;

    // Update 4 Executive KPI Cards
    const fin = analytics.financial_summary || {};
    const totalChargeEl = document.getElementById("analyticsTotalCharge");
    const totalSavingEl = document.getElementById("analyticsTotalSaving");
    const anomalyRateEl = document.getElementById("analyticsAnomalyRate");
    const anomalyBreakdownEl = document.getElementById("analyticsAnomalyBreakdown");
    const costDisparityEl = document.getElementById("analyticsCostDisparity");

    if (totalChargeEl) totalChargeEl.textContent = formatIdr(fin.total_charge || 0);
    if (totalSavingEl) totalSavingEl.textContent = formatIdr(fin.total_saving || 0);
    if (anomalyRateEl) {
      const rate = data.total_claims ? ((data.fraud_claims / data.total_claims) * 100).toFixed(1) : "0.0";
      anomalyRateEl.textContent = `${rate}%`;
    }
    if (anomalyBreakdownEl) {
      anomalyBreakdownEl.textContent = `${formatNumber(data.upcoding_count)} Upcoding · ${formatNumber(data.unbundling_count)} Unbundling`;
    }
    if (costDisparityEl) {
      const totalFraudCharge = (fin.upcoding_charge || 0) + (fin.unbundling_charge || 0);
      const avgFraud = data.fraud_claims ? totalFraudCharge / data.fraud_claims : 0;
      costDisparityEl.textContent = formatIdr(avgFraud);
    }

    // Populate High-Impact Table
    const highImpactBody = document.getElementById("highImpactTableBody");
    if (highImpactBody && analytics.high_impact_claims?.length) {
      highImpactBody.innerHTML = analytics.high_impact_claims.map((claim) => {
        const typeBadge = claim.fraud_type === "upcoding"
          ? '<span class="status-chip is-fraud">Upcoding</span>'
          : '<span class="status-chip is-fraud" style="background:#fff7ed;color:#c2410c;border-color:#ffedd5;">Unbundling</span>';
        return `<tr>
          <td><strong>${escapeHtml(claim.claim_id)}</strong><br><span style="font-size:11px;color:var(--text-secondary);">${escapeHtml(claim.sep_number)}</span></td>
          <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(claim.doctor_notes)}">${escapeHtml(claim.doctor_notes)}</td>
          <td><code>${escapeHtml(claim.admin_billing_code)}</code></td>
          <td>${formatIdr(claim.total_charge)}</td>
          <td>${formatIdr(claim.approved_tariff)}</td>
          <td style="color:#059669;font-weight:700;">${formatIdr(claim.potential_saving)}</td>
          <td>${typeBadge}</td>
          <td><button class="button button-quiet" type="button" data-high-impact-id="${escapeHtml(claim.claim_id)}" style="font-size:11px;padding:4px 9px;">Periksa ↗</button></td>
        </tr>`;
      }).join("");

      highImpactBody.querySelectorAll("[data-high-impact-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetId = btn.dataset.highImpactId;
          const claim = analytics.high_impact_claims.find((c) => c.claim_id === targetId);
          if (claim) {
            setActiveClaim(claim.claim_id);
            openModal(claim, async () => {
              await loadDashboardData();
              await loadReportData();
              showToast("Keputusan verifikator tersimpan.");
            });
          }
        });
      });
    }

    // Regulation Sources & Rules
    const sourceNames = rules.map((rule) => rule.legal_source).filter(Boolean);
    state.reportSources = [...new Set(sourceNames.map(formatDocumentTitle).filter(Boolean))];
    const sourceList = document.getElementById("reportSourcesList");
    if (sourceList) {
      sourceList.innerHTML = state.reportSources.length
        ? state.reportSources.map((title) => `<li>${escapeHtml(title)}</li>`).join("")
        : "<li>Belum ada sumber regulasi yang tersedia.</li>";
    }
    const sourcesMetaEl = document.getElementById("reportSourcesMeta");
    if (sourcesMetaEl) {
      sourcesMetaEl.textContent = `${formatNumber(state.reportSources.length)} sumber regulasi tercatat pada Rule Engine.`;
    }
    const ruleCountEl = document.getElementById("reportRuleCount");
    if (ruleCountEl) {
      ruleCountEl.textContent = `${formatNumber(rules.length)} aturan tercatat di Rule Engine.`;
    }

    const coverage = Number(data.audit_coverage_pct) || 0;
    if (summary) {
      summary.innerHTML = `<strong>Ringkasan Audit Dataset:</strong> Dari <strong>${formatNumber(data.total_claims)} klaim</strong> aktif FKRTL, teridentifikasi <strong>${formatNumber(data.safe_claims)} klaim aman</strong> (65%) dan <strong>${formatNumber(data.fraud_claims)} klaim anomali</strong> (35%). Total akumulasi paparan tagihan mencapai <strong>${formatIdr(fin.total_charge || 0)}</strong> dengan estimasi penghematan dana JKN sebesar <strong>${formatIdr(data.total_potential_saving_idr)}</strong>. Cakupan verifikasi manusia saat ini berada pada level <strong>${coverage.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>.`;
    }

    renderAllAnalyticsCharts();
  } catch (error) {
    if (summary) summary.textContent = `Laporan tidak dapat dimuat: ${error.message}`;
    showToast(`Gagal memuat analitik: ${error.message}`, true);
  }
}

function exportReportPdf() {
  if (!window.jspdf?.jsPDF) {
    window.print();
    return;
  }
  const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const data = state.stats || {};
  const fin = state.analyticsData?.financial_summary || {};
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const charts = [
    ["financialComparisonChart", "Perbandingan finansial"],
    ["losCorrelationChart", "Korelasi lama rawat dan biaya"],
    ["costRiskDistChart", "Distribusi biaya dan risiko"],
    ["topAnomaliesChart", "Anomali yang paling sering ditemukan"],
  ].filter(([id]) => document.getElementById(id));
  const drawHeader = (subtitle) => {
    pdf.setFillColor(11, 43, 29);
    pdf.rect(0, 0, pageWidth, 29, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.text("KlaimGuard AI", margin, 13);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(subtitle, margin, 21);
    pdf.setFontSize(8);
    pdf.text(`Dibuat ${new Date().toLocaleString("id-ID")}`, pageWidth - margin, 21, { align: "right" });
    pdf.setTextColor(34, 48, 66);
  };
  const drawFooter = (pageNumber) => {
    const height = pdf.internal.pageSize.getHeight();
    pdf.setDrawColor(218, 227, 222);
    pdf.line(margin, height - 10, pageWidth - margin, height - 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(104, 117, 122);
    pdf.text("KlaimGuard AI · Ringkasan analitik untuk bahan telaah verifikator", margin, height - 5);
    pdf.text(`Halaman ${pageNumber}`, pageWidth - margin, height - 5, { align: "right" });
  };
  const cards = [
    ["TOTAL KLAIM", formatNumber(data.total_claims)],
    ["KLAIM AMAN", formatNumber(data.safe_claims)],
    ["INDIKASI ANOMALI", formatNumber(data.fraud_claims)],
    ["POTENSI PENGHEMATAN", formatIdr(data.total_potential_saving_idr)],
  ];
  drawHeader("Laporan eksekutif analitik dan audit klaim");
  const cardGap = 5;
  const cardWidth = (pageWidth - margin * 2 - cardGap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + cardGap);
    pdf.setFillColor(247, 250, 248);
    pdf.setDrawColor(220, 229, 223);
    pdf.roundedRect(x, 36, cardWidth, 24, 2, 2, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(92, 108, 99);
    pdf.text(label, x + 5, 44);
    pdf.setFontSize(value.length > 19 ? 11 : 15);
    pdf.setTextColor(25, 45, 37);
    pdf.text(value, x + 5, 54);
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(65, 78, 73);
  const coverage = Number(data.audit_coverage_pct) || 0;
  pdf.text(`Total tagihan ${formatIdr(fin.total_charge || 0)}   ·   Upcoding ${formatNumber(data.upcoding_count)}   ·   Unbundling ${formatNumber(data.unbundling_count)}   ·   Cakupan verifikasi ${coverage.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`, margin, 68);
  const drawChart = (chart, index, y) => {
    const [id, title] = chart;
    const canvas = document.getElementById(id);
    const col = index % 2;
    const row = Math.floor(index / 2);
    const boxWidth = (pageWidth - margin * 2 - 8) / 2;
    const x = margin + col * (boxWidth + 8);
    const boxY = y + row * 73;
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(220, 229, 223);
    pdf.roundedRect(x, boxY, boxWidth, 68, 2, 2, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(25, 55, 42);
    pdf.text(title, x + 5, boxY + 7);
    try {
      const image = canvas.toDataURL("image/png");
      const imageWidth = boxWidth - 10;
      const imageHeight = 53;
      const ratio = Math.min(imageWidth / canvas.width, imageHeight / canvas.height);
      const width = canvas.width * ratio;
      const height = canvas.height * ratio;
      pdf.addImage(image, "PNG", x + (boxWidth - width) / 2, boxY + 10 + (imageHeight - height) / 2, width, height);
    } catch { /* skip an unavailable chart image */ }
  };
  charts.slice(0, 2).forEach((chart, index) => drawChart(chart, index, 75));
  drawFooter(1);
  if (charts.length > 2) {
    pdf.addPage();
    drawHeader("Visualisasi lanjutan dan catatan laporan");
    charts.slice(2).forEach((chart, index) => drawChart(chart, index, 39));
    let noteY = 118;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(25, 55, 42);
    pdf.text("Sumber regulasi yang tercatat", margin, noteY);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(65, 78, 73);
    const sources = state.reportSources?.length ? state.reportSources : ["Tidak ada sumber regulasi tercatat"];
    const sourceLines = pdf.splitTextToSize(sources.join(" · "), pageWidth - margin * 2);
    pdf.text(sourceLines.slice(0, 3), margin, noteY + 6);
    drawFooter(2);
  }
  pdf.save("KlaimGuard-Laporan-Eksekutif-Analitik.pdf");
  showToast("Laporan PDF berhasil diunduh.");
}

async function analyzeManualClaim(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("analyzeClaimBtn");
  const resultPanel = document.getElementById("manualResult");
  const values = new FormData(form);
  button.disabled = true;
  button.textContent = "Menganalisis…";
  try {
    const result = await analyzeClaim({
      claim_id: String(values.get("claim_id")).trim(),
      doctor_notes: String(values.get("doctor_notes")).trim(),
      admin_billing_code: String(values.get("admin_billing_code")).split(",").map((code) => code.trim()).filter(Boolean),
      length_of_stay: Number(values.get("length_of_stay")),
      total_charge: Number(values.get("total_charge")),
    });
    result.manual_only = true;
    resultPanel.classList.remove("hidden", "is-error");
    resultPanel.innerHTML = `<strong>${escapeHtml(result.is_fraud ? `FLAGGED · ${result.fraud_type || "anomali"}` : "AMAN")}</strong> · Skor risiko AI ${Math.round(Number(result.risk_score) * 100)}% · ${escapeHtml(result.reason_narrative)} <button class="detail-button" type="button" id="manualDetailButton">Lihat Detail ↗</button>`;
    document.getElementById("manualDetailButton").addEventListener("click", () => openModal(result, loadDashboardData));
  } catch (error) {
    resultPanel.classList.remove("hidden");
    resultPanel.classList.add("is-error");
    resultPanel.textContent = `Analisis gagal: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Analisis Klaim";
  }
}

bootstrap();
