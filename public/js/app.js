import {
  deleteReviewer,
  getReviewer,
  getReviewers,
  saveReviewer,
  updateReviewer
} from "./storage.js";
import { createFlashcardSession } from "./flashcards.js";
import { createQuizSession } from "./quiz.js";

const MIN_CONTENT_LENGTH = 20;
const GENERIC_GENERATE_ERROR = "Something went wrong while generating your reviewer. Please try again.";
let deferredInstallPrompt;

function initInstallPrompt() {
  const nav = qs(".nav");
  if (!nav || !deferredInstallPrompt || window.matchMedia("(display-mode: standalone)").matches) {
    return;
  }

  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.className = "button button-secondary install-button";
  installButton.textContent = "Install app";
  installButton.addEventListener("click", async () => {
    installButton.disabled = true;
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === "accepted") {
      installButton.remove();
    } else {
      installButton.disabled = false;
    }
    deferredInstallPrompt = null;
  });
  nav.append(installButton);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  initInstallPrompt();
});

window.addEventListener("appinstalled", () => {
  document.querySelector(".install-button")?.remove();
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is optional when the browser blocks service workers.
    });
  });
}

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setActiveNav() {
  const page = document.body.dataset.page;
  qsa("[data-nav]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === page);
  });
}

function showAlert(element, message, type = "error") {
  if (!element) {
    return;
  }
  element.hidden = !message;
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success");
  element.textContent = message || "";
}

function openModal(modal) {
  if (!modal) {
    return;
  }
  modal.hidden = false;
  const focusTarget = modal.querySelector("input, button");
  focusTarget?.focus();
}

function closeModal(modal) {
  if (!modal) {
    return;
  }
  modal.hidden = true;
}

function initDashboard() {
  const reviewers = getReviewers();
  const countEl = qs("[data-reviewer-count]");
  const recentEl = qs("[data-recent-list]");
  const emptyEl = qs("[data-dashboard-empty]");

  if (countEl) {
    countEl.textContent = String(reviewers.length);
  }

  if (!recentEl) {
    return;
  }

  const recent = reviewers.slice(0, 6);
  if (!recent.length) {
    recentEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return;
  }

  if (emptyEl) emptyEl.hidden = true;
  recentEl.innerHTML = recent
    .map(
      (reviewer) => `
      <a class="reviewer-card" href="/reviewer?id=${encodeURIComponent(reviewer.id)}">
        <h3>${escapeHtml(reviewer.title)}</h3>
        <p>${escapeHtml(reviewer.summary || "")}</p>
        <p class="meta">${reviewer.flashcards?.length || 0} flashcards · ${reviewer.multipleChoice?.length || 0} questions</p>
      </a>
    `
    )
    .join("");
}

function initCreate() {
  const form = qs("[data-create-form]");
  const content = qs("#content");
  const title = qs("#title");
  const counter = qs("[data-char-count]");
  const alertEl = qs("[data-alert]");
  const submitBtn = qs("[data-generate]");
  const overlay = qs("[data-loading]");

  if (!form || !content) {
    return;
  }

  const updateCount = () => {
    if (counter) {
      counter.textContent = `${content.value.length} characters`;
    }
  };

  content.addEventListener("input", updateCount);
  updateCount();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showAlert(alertEl, "");

    const studyContent = content.value.trim();
    const studyTitle = title.value.trim();

    if (studyContent.length < MIN_CONTENT_LENGTH) {
      showAlert(alertEl, "Please paste more study material so the AI can build a useful reviewer.");
      content.focus();
      return;
    }

    submitBtn.disabled = true;
    if (overlay) overlay.hidden = false;

    try {
      const response = await fetch("/api/study-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: studyContent,
          title: studyTitle
        })
      });

      let data;
      try {
        data = await response.json();
      } catch (_error) {
        throw new Error("parse");
      }

      if (!response.ok || !data?.success || !data.reviewer) {
        throw new Error("generate");
      }

      saveReviewer(data.reviewer);
      window.location.href = `/reviewer?id=${encodeURIComponent(data.reviewer.id)}`;
    } catch (error) {
      const message =
        error && error.message === "storage-write"
          ? "Your reviewer was generated, but it could not be saved on this device."
          : GENERIC_GENERATE_ERROR;
      showAlert(alertEl, message);
      submitBtn.disabled = false;
      if (overlay) overlay.hidden = true;
    }
  });
}

function reviewerCard(reviewer) {
  return `
    <article class="library-card" data-card-id="${escapeHtml(reviewer.id)}">
      <div>
        <h2>${escapeHtml(reviewer.title)}</h2>
        <p>${escapeHtml(reviewer.summary || "")}</p>
        <p class="meta">${reviewer.flashcards?.length || 0} flashcards · ${reviewer.multipleChoice?.length || 0} questions</p>
        <p class="meta">Created ${formatDate(reviewer.createdAt)}</p>
      </div>
      <details class="card-menu">
        <summary class="menu-button" aria-label="Actions for ${escapeHtml(reviewer.title)}">&#8942;</summary>
        <div class="menu-items">
          <a class="menu-item" href="/reviewer?id=${encodeURIComponent(reviewer.id)}">Open</a>
          <button type="button" class="menu-item" data-rename="${escapeHtml(reviewer.id)}">Rename</button>
          <button type="button" class="menu-item menu-item-danger" data-delete="${escapeHtml(reviewer.id)}">Delete</button>
        </div>
      </details>
    </article>
  `;
}

function initLibrary() {
  const list = qs("[data-library-list]");
  const empty = qs("[data-library-empty]");
  const search = qs("#search");
  const deleteModal = qs("[data-delete-modal]");
  const renameModal = qs("[data-rename-modal]");
  const renameInput = qs("#rename-title");
  let pendingId = "";

  function render(filter = "") {
    const query = filter.trim().toLowerCase();
    const reviewers = getReviewers().filter((reviewer) => {
      if (!query) {
        return true;
      }
      const haystack = `${reviewer.title || ""} ${reviewer.summary || ""}`.toLowerCase();
      return haystack.includes(query);
    });

    if (!reviewers.length) {
      list.innerHTML = "";
      empty.hidden = false;
      empty.textContent = query
        ? "No reviewers match your search."
        : "No saved reviewers yet. Create one from your notes.";
      return;
    }

    empty.hidden = true;
    list.innerHTML = reviewers.map(reviewerCard).join("");
  }

  list.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-delete]");
    const renameBtn = event.target.closest("[data-rename]");

    if (deleteBtn) {
      pendingId = deleteBtn.dataset.delete;
      openModal(deleteModal);
    }

    if (renameBtn) {
      pendingId = renameBtn.dataset.rename;
      const current = getReviewer(pendingId);
      if (renameInput) {
        renameInput.value = current?.title || "";
      }
      openModal(renameModal);
    }
  });

  qs("[data-confirm-delete]")?.addEventListener("click", () => {
    try {
      deleteReviewer(pendingId);
      pendingId = "";
      closeModal(deleteModal);
      render(search?.value || "");
    } catch (_error) {
      closeModal(deleteModal);
    }
  });

  qs("[data-confirm-rename]")?.addEventListener("click", () => {
    const nextTitle = renameInput?.value.trim();
    if (!nextTitle) {
      renameInput?.focus();
      return;
    }
    try {
      updateReviewer(pendingId, { title: nextTitle });
      pendingId = "";
      closeModal(renameModal);
      render(search?.value || "");
    } catch (_error) {
      closeModal(renameModal);
    }
  });

  qsa("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(deleteModal);
      closeModal(renameModal);
    });
  });

  search?.addEventListener("input", () => render(search.value));
  render();
}

function initReviewer() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const reviewer = getReviewer(id);
  const missing = qs("[data-missing]");
  const content = qs("[data-reviewer-content]");

  if (!reviewer) {
    if (missing) missing.hidden = false;
    if (content) content.hidden = true;
    return;
  }

  qs("[data-title]").textContent = reviewer.title;
  qs("[data-summary]").textContent = reviewer.summary;
  qs("[data-created]").textContent = `Created ${formatDate(reviewer.createdAt)}`;
  qs("[data-fc-count]").textContent = String(reviewer.flashcards?.length || 0);
  qs("[data-mcq-count]").textContent = String(reviewer.multipleChoice?.length || 0);

  const flashcardsRoot = qs("[data-flashcards-root]");
  const quizRoot = qs("[data-quiz-root]");
  const flashcards = createFlashcardSession(flashcardsRoot, reviewer.flashcards || []);
  createQuizSession(quizRoot, reviewer.multipleChoice || []);

  const panels = {
    overview: qs("[data-panel='overview']"),
    flashcards: qs("[data-panel='flashcards']"),
    quiz: qs("[data-panel='quiz']")
  };

  function showPanel(name) {
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== name;
    });
    qsa("[data-tab]").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (name === "flashcards") {
      flashcards.activate();
    } else {
      flashcards.deactivate();
    }
  }

  qsa("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => showPanel(tab.dataset.tab));
  });

  window.addEventListener("revia:show-overview", () => showPanel("overview"));

  const deleteModal = qs("[data-delete-modal]");
  const renameModal = qs("[data-rename-modal]");
  const renameInput = qs("#rename-title");

  qs("[data-open-rename]")?.addEventListener("click", () => {
    if (renameInput) renameInput.value = reviewer.title;
    openModal(renameModal);
  });

  qs("[data-open-delete]")?.addEventListener("click", () => openModal(deleteModal));

  qs("[data-confirm-delete]")?.addEventListener("click", () => {
    try {
      deleteReviewer(reviewer.id);
      window.location.href = "/library";
    } catch (_error) {
      closeModal(deleteModal);
    }
  });

  qs("[data-confirm-rename]")?.addEventListener("click", () => {
    const nextTitle = renameInput?.value.trim();
    if (!nextTitle) {
      renameInput?.focus();
      return;
    }
    try {
      updateReviewer(reviewer.id, { title: nextTitle });
      qs("[data-title]").textContent = nextTitle;
      document.title = `${nextTitle} · Revia`;
      closeModal(renameModal);
    } catch (_error) {
      closeModal(renameModal);
    }
  });

  qsa("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(deleteModal);
      closeModal(renameModal);
    });
  });

  showPanel("overview");
}

function initSharedUi() {
  qsa(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    qsa(".modal").forEach((modal) => {
      if (!modal.hidden) {
        closeModal(modal);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initInstallPrompt();
  setActiveNav();
  initSharedUi();
  const page = document.body.dataset.page;

  if (page === "dashboard") initDashboard();
  if (page === "create") initCreate();
  if (page === "library") initLibrary();
  if (page === "reviewer") initReviewer();
});
