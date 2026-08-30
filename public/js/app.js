import {
  deleteReviewer,
  getReviewer,
  getReviewers,
  saveReviewer,
  updateReviewer,
  getReviewerProgress,
  getGlobalStats,
  recordFlashcardAnswer,
  recordQuizAnswer,
  recordQuizResult,
  recordStudySession
} from "./storage.js?v=23";
import { createFlashcardSession } from "./flashcards.js?v=23";
import { createQuizSession } from "./quiz.js?v=23";

const MIN_CONTENT_LENGTH = 20;
const GENERIC_GENERATE_ERROR = "Something went wrong while generating your reviewer. Please try again.";
const STICKER_EMOJIS = ["🚀", "🪐", "💡", "🔬", "📚", "🎨", "🏛️", "🌱", "⚡", "🌟", "🧩", "🦄"];
let deferredInstallPrompt;
let toastTimeout = null;
let currentUser = null;
let googleClientId = null;

/* ==============================================================================
   Theme Management (inside Kebab Menu)
============================================================================== */

function initTheme() {
  const root = document.documentElement;
  const savedTheme = localStorage.getItem("revia-theme");
  const theme = savedTheme === "dark" ? "dark" : "light";
  root.dataset.theme = theme;

  const toggleBtn = qs("[data-menu-theme-toggle]");
  if (toggleBtn) {
    updateThemeToggleUI(toggleBtn, theme);
    toggleBtn.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = nextTheme;
      localStorage.setItem("revia-theme", nextTheme);
      updateThemeToggleUI(toggleBtn, nextTheme);
      closeHeaderMenu();
    });
  }
}

function updateThemeToggleUI(btn, theme) {
  const isDark = theme === "dark";
  const icon = btn.querySelector("[data-theme-icon]");
  const label = btn.querySelector("[data-theme-label]");

  if (icon) icon.textContent = isDark ? "☀️" : "🌙";
  if (label) label.textContent = isDark ? "Light Mode" : "Dark Mode";
  btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

/* ==============================================================================
   PWA Install Prompt (inside Kebab Menu)
============================================================================== */

function initInstallPrompt() {
  const slot = qs("[data-menu-install-section]");
  if (!slot || !deferredInstallPrompt || window.matchMedia("(display-mode: standalone)").matches) {
    return;
  }

  slot.innerHTML = `
    <button type="button" class="menu-item" data-menu-install>
      <span>📱</span>
      <span>Install App</span>
    </button>
  `;

  slot.querySelector("[data-menu-install]")?.addEventListener("click", async () => {
    closeHeaderMenu();
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === "accepted") {
      slot.innerHTML = "";
    }
    deferredInstallPrompt = null;
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  initInstallPrompt();
});

window.addEventListener("appinstalled", () => {
  const slot = qs("[data-menu-install-section]");
  if (slot) slot.innerHTML = "";
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* ==============================================================================
   DOM & Helper Utilities
============================================================================== */

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
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

function getStickerEmoji(id) {
  let hash = 0;
  for (let i = 0; i < (id || "").length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % STICKER_EMOJIS.length;
  return STICKER_EMOJIS[index];
}

function updateGlobalHeaderGamification() {
  const stats = getGlobalStats();
  const streakEl = qs("[data-global-streak]");
  const xpEl = qs("[data-global-xp]");

  if (streakEl) {
    streakEl.textContent = String(stats.currentStreak || stats.maxStreak || 0);
  }
  if (xpEl) {
    xpEl.textContent = String(stats.totalXp || 0);
  }
}

function setActiveNav() {
  const page = document.body.dataset.page;
  qsa("[data-nav]").forEach((link) => {
    const isActive = link.dataset.nav === page;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
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

export function showToast(message, icon = "📋") {
  const toast = qs("[data-toast]");
  if (!toast) return;

  const msgEl = toast.querySelector(".toast-message") || toast;
  const iconEl = toast.querySelector(".toast-icon");

  if (msgEl) msgEl.textContent = message;
  if (iconEl) iconEl.textContent = icon;

  toast.hidden = false;

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

export async function shareReviewerDeck(reviewer) {
  if (!reviewer || !reviewer.id) return;

  const shareUrl = `${window.location.origin}/reviewer?id=${encodeURIComponent(reviewer.id)}`;

  try {
    fetch("/api/reviewer/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer })
    }).catch(() => {});

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Link copied to clipboard! 📋🎉 Share it with anyone!", "🔗");
    } else {
      prompt("Copy share link:", shareUrl);
    }
  } catch (_err) {
    prompt("Copy share link:", shareUrl);
  }
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

function closeHeaderMenu() {
  const menu = qs("[data-header-menu]");
  if (menu) menu.removeAttribute("open");
}

/* ==============================================================================
   Google Authentication & User Account Management
============================================================================== */

async function initAuth() {
  const authSection = qs("[data-menu-auth-section]");
  if (!authSection) return;

  try {
    const configRes = await fetch("/api/auth/config");
    const configData = await configRes.json();
    googleClientId = configData?.googleClientId || null;

    const meRes = await fetch("/api/auth/me");
    const meData = await meRes.json();
    currentUser = meData?.user || null;

    renderAuthKebabSection();
    setupGoogleButton();
  } catch (error) {
    console.warn("[Auth] Could not initialize auth:", error.message);
    renderAuthKebabSection();
  }
}

function renderAuthKebabSection() {
  const authSection = qs("[data-menu-auth-section]");
  if (!authSection) return;

  if (currentUser) {
    const avatar = currentUser.avatarUrl
      ? `<img class="user-avatar-img" src="${escapeHtml(currentUser.avatarUrl)}" alt="${escapeHtml(currentUser.name)}" referrerpolicy="no-referrer">`
      : `<div class="user-avatar-fallback">⭐</div>`;

    authSection.innerHTML = `
      <div class="menu-user-card">
        ${avatar}
        <div>
          <strong>${escapeHtml(currentUser.name)}</strong>
          <span>${escapeHtml(currentUser.email)}</span>
        </div>
      </div>
      <button type="button" class="menu-item" data-sync-cloud>
        <span>☁️</span>
        <span>Sync Cloud Decks</span>
      </button>
      <button type="button" class="menu-item menu-item-danger" data-auth-logout>
        <span>🚪</span>
        <span>Sign Out</span>
      </button>
    `;

    authSection.querySelector("[data-auth-logout]")?.addEventListener("click", () => {
      closeHeaderMenu();
      handleLogout();
    });

    authSection.querySelector("[data-sync-cloud]")?.addEventListener("click", () => {
      closeHeaderMenu();
      syncLocalDecksToCloud(true);
    });
  } else {
    authSection.innerHTML = `
      <button type="button" class="menu-item" data-open-auth-modal style="font-weight:700;">
        <svg class="google-g-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
        </svg>
        <span>Sign in with Google</span>
      </button>
    `;

    authSection.querySelector("[data-open-auth-modal]")?.addEventListener("click", () => {
      closeHeaderMenu();
      openModal(qs("[data-auth-modal]"));
      renderGoogleButtonInModal();
    });
  }
}

function setupGoogleButton() {
  if (typeof google === "undefined" || !google.accounts || !google.accounts.id || !googleClientId) {
    return;
  }

  try {
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredentialResponse,
      auto_select: false
    });
  } catch (err) {
    console.warn("[Google Auth] Error initializing GIS:", err.message);
  }
}

function renderGoogleButtonInModal() {
  const slot = qs("[data-google-btn-slot]");
  if (!slot) return;

  if (!googleClientId) {
    slot.innerHTML = `
      <div style="background:var(--sun-yellow-soft);border:2px dashed var(--ink);border-radius:18px;padding:16px;font-size:0.95rem;">
        <strong>⚙️ Google Login Setup</strong>
        <p style="margin:6px 0 0;color:var(--muted);">To enable Google Sign-In, add your <code>GOOGLE_CLIENT_ID</code> to your <code>.env</code> file.</p>
      </div>
    `;
    return;
  }

  slot.innerHTML = "";
  if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
    google.accounts.id.renderButton(slot, {
      theme: "filled_blue",
      size: "large",
      shape: "pill",
      text: "signin_with",
      logo_alignment: "left"
    });
  }
}

async function handleGoogleCredentialResponse(response) {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await res.json();
    if (res.ok && data?.success && data?.user) {
      currentUser = data.user;
      closeModal(qs("[data-auth-modal]"));
      renderAuthKebabSection();
      showToast(`Welcome, ${currentUser.name.split(" ")[0]}! 🎉 Signed in!`, "🌟");
      await syncLocalDecksToCloud(false);

      if (document.body.dataset.page === "library") {
        initLibrary();
      }
    } else {
      showToast(data?.error || "Google login failed.", "⚠️");
    }
  } catch (_err) {
    showToast("Unable to reach authentication server.", "⚠️");
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
    currentUser = null;
    renderAuthKebabSection();
    showToast("Signed out! You're in guest mode.", "👋");
  } catch (_err) {
    showToast("Failed to sign out.", "⚠️");
  }
}

async function syncLocalDecksToCloud(showToastNotice = true) {
  if (!currentUser) return;
  const localDecks = getReviewers();

  if (!localDecks.length) {
    if (showToastNotice) showToast("Your cloud account is up to date! ☁️✨", "⭐");
    return;
  }

  try {
    const res = await fetch("/api/user/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewers: localDecks })
    });
    const data = await res.json();
    if (res.ok && data?.success) {
      if (showToastNotice) {
        showToast(`Synced ${data.syncedCount || localDecks.length} decks to your cloud account! ☁️🎉`, "🚀");
      }
    }
  } catch (_err) {
    if (showToastNotice) showToast("Cloud sync failed. Will retry later.", "⚠️");
  }
}

/* ==============================================================================
   Page Initializers
============================================================================== */

function initDashboard() {
  const reviewers = getReviewers();
  const stats = getGlobalStats();
  const countEl = qs("[data-reviewer-count]");
  const masteredEl = qs("[data-mastered-count]");
  const streakEl = qs("[data-best-streak-count]");
  const recentEl = qs("[data-recent-list]");
  const emptyEl = qs("[data-dashboard-empty]");
  const greetingEl = qs("[data-mascot-greeting]");
  const journeyLevelEl = qs("[data-journey-level]");
  const journeyFillEl = qs("[data-journey-fill]");

  if (countEl) countEl.textContent = String(reviewers.length);
  if (masteredEl) masteredEl.textContent = String(stats.totalMastered);
  if (streakEl) streakEl.textContent = String(stats.maxStreak);

  const level = Math.max(1, Math.floor(stats.totalXp / 100) + 1);
  if (journeyLevelEl) journeyLevelEl.textContent = String(level);
  if (journeyFillEl) {
    const fillPercent = Math.min(100, Math.max(15, (stats.totalXp % 100) || (reviewers.length > 0 ? 35 : 15)));
    journeyFillEl.style.width = `${fillPercent}%`;
  }

  if (greetingEl) {
    if (reviewers.length === 0) {
      greetingEl.textContent = "Hi! I'm Revy, your study buddy! 🌟 Create your first study deck and let's have fun learning together!";
    } else if (stats.currentStreak >= 3) {
      greetingEl.textContent = `Whoa, look at you! You're on a ${stats.currentStreak}-streak! Keep that unstoppable momentum going! 🔥🚀`;
    } else if (stats.totalMastered > 0) {
      greetingEl.textContent = `Welcome back, superstar! You've mastered ${stats.totalMastered} cards so far. Ready for today's adventure? ⭐📚`;
    }
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
  recentEl.innerHTML = recent.map(renderStickerCard).join("");
}

function renderStickerCard(reviewer) {
  const progress = getReviewerProgress(reviewer.id);
  const cards = reviewer.flashcards || [];
  const mastered = cards.filter((card) => card.stats?.mastered).length;
  const percent = cards.length ? Math.round((mastered / cards.length) * 100) : 0;
  const emoji = getStickerEmoji(reviewer.id);

  return `
    <a class="reviewer-card" href="/reviewer?id=${encodeURIComponent(reviewer.id)}">
      <div>
        <div class="card-top">
          <div class="card-sticker-icon">${emoji}</div>
          <span class="badge-tag">⭐ ${percent}% Mastered</span>
        </div>
        <h3 class="card-title">${escapeHtml(reviewer.title)}</h3>
        <p class="card-summary">${escapeHtml(reviewer.summary || "Ready for flashcards and quiz questions!")}</p>
        
        <div class="progress-bar-chunky">
          <div class="progress-bar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>

      <div class="card-footer-stats">
        <span class="badge-tag">🃏 ${cards.length} cards</span>
        <span class="badge-tag">❓ ${reviewer.multipleChoice?.length || 0} questions</span>
        <span class="badge-tag">🔥 ${progress.currentStreak} streak</span>
      </div>
    </a>
  `;
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
      showAlert(alertEl, "Please paste a little more study material so Revy can build a rich deck for you! 🌟");
      content.focus();
      return;
    }

    submitBtn.disabled = true;
    if (overlay) overlay.hidden = false;

    try {
      const response = await fetch("/api/study-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: studyContent, title: studyTitle })
      });
      const data = await response.json();
      if (!response.ok || !data?.success || !data.reviewer) throw new Error("generate");
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

function libraryStickerCard(reviewer) {
  const progress = getReviewerProgress(reviewer.id);
  const cards = reviewer.flashcards || [];
  const mastered = cards.filter((card) => card.stats?.mastered).length;
  const percent = cards.length ? Math.round((mastered / cards.length) * 100) : 0;
  const emoji = getStickerEmoji(reviewer.id);

  return `
    <article class="library-card" data-card-id="${escapeHtml(reviewer.id)}">
      <div>
        <div class="card-top">
          <div class="card-sticker-icon">${emoji}</div>
          <details class="card-menu">
            <summary class="menu-button" aria-label="Actions for ${escapeHtml(reviewer.title)}">⋮</summary>
            <div class="menu-items">
              <a class="menu-item" href="/reviewer?id=${encodeURIComponent(reviewer.id)}">📖 Study Deck</a>
              <button type="button" class="menu-item" data-share="${escapeHtml(reviewer.id)}">🔗 Share Link</button>
              <button type="button" class="menu-item" data-rename="${escapeHtml(reviewer.id)}">✏️ Rename</button>
              <button type="button" class="menu-item menu-item-danger" data-delete="${escapeHtml(reviewer.id)}">🗑️ Delete</button>
            </div>
          </details>
        </div>
        <h3 class="card-title">${escapeHtml(reviewer.title)}</h3>
        <p class="card-summary">${escapeHtml(reviewer.summary || "")}</p>
        
        <div class="progress-bar-chunky">
          <div class="progress-bar-fill" style="width: ${percent}%;"></div>
        </div>
      </div>

      <div>
        <div class="card-footer-stats">
          <span class="badge-tag">🃏 ${cards.length} cards</span>
          <span class="badge-tag">⭐ ${mastered} mastered</span>
          <span class="badge-tag">🔥 ${progress.currentStreak} streak</span>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;">
          <a class="button button-primary" style="flex:1;min-height:42px;font-size:1rem;" href="/reviewer?id=${encodeURIComponent(reviewer.id)}">Study Now 🚀</a>
          <button type="button" class="button button-secondary" data-share="${escapeHtml(reviewer.id)}" style="min-height:42px;padding:6px 12px;font-size:1rem;" title="Share link">🔗</button>
        </div>
      </div>
    </article>
  `;
}

async function initLibrary() {
  const list = qs("[data-library-list]");
  const empty = qs("[data-library-empty]");
  const search = qs("#search");
  const deleteModal = qs("[data-delete-modal]");
  const renameModal = qs("[data-rename-modal]");
  const renameInput = qs("#rename-title");
  let pendingId = "";

  if (currentUser) {
    try {
      const res = await fetch("/api/user/reviewers");
      const data = await res.json();
      if (res.ok && data?.success && Array.isArray(data.reviewers)) {
        data.reviewers.forEach((r) => {
          if (!getReviewer(r.id)) {
            saveReviewer(r);
          }
        });
      }
    } catch (_err) {}
  }

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
        ? "🔍 No reviewers match your search. Try another keyword!"
        : "🎈 No saved reviewers yet. Create one to get started!";
      return;
    }

    empty.hidden = true;
    list.innerHTML = reviewers.map(libraryStickerCard).join("");
  }

  list.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-delete]");
    const renameBtn = event.target.closest("[data-rename]");
    const shareBtn = event.target.closest("[data-share]");

    if (shareBtn) {
      const id = shareBtn.dataset.share;
      const current = getReviewer(id);
      shareBtn.closest("details")?.removeAttribute("open");
      if (current) {
        shareReviewerDeck(current);
      }
      return;
    }

    if (deleteBtn) {
      pendingId = deleteBtn.dataset.delete;
      deleteBtn.closest("details")?.removeAttribute("open");
      openModal(deleteModal);
    }

    if (renameBtn) {
      pendingId = renameBtn.dataset.rename;
      renameBtn.closest("details")?.removeAttribute("open");
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
      updateGlobalHeaderGamification();
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
      closeModal(qs("[data-auth-modal]"));
    });
  });

  search?.addEventListener("input", () => render(search.value));
  render();
}

async function initReviewer() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const missing = qs("[data-missing]");
  const content = qs("[data-reviewer-content]");
  const remoteLoading = qs("[data-remote-loading]");
  const sharedBanner = qs("[data-shared-banner]");
  const saveToLibraryBtn = qs("[data-save-to-library]");

  if (!id) {
    if (missing) missing.hidden = false;
    if (content) content.hidden = true;
    return;
  }

  let reviewer = getReviewer(id);

  if (!reviewer) {
    if (remoteLoading) remoteLoading.hidden = false;
    if (content) content.hidden = true;
    if (missing) missing.hidden = true;

    try {
      const response = await fetch(`/api/reviewer/${encodeURIComponent(id)}`);
      const data = await response.json();
      if (response.ok && data?.success && data?.reviewer) {
        reviewer = data.reviewer;
      }
    } catch (_err) {
    } finally {
      if (remoteLoading) remoteLoading.hidden = true;
    }
  }

  if (!reviewer) {
    if (missing) missing.hidden = false;
    if (content) content.hidden = true;
    return;
  }

  if (content) content.hidden = false;
  if (missing) missing.hidden = true;

  const alreadySaved = Boolean(getReviewer(reviewer.id));
  if (sharedBanner) {
    sharedBanner.hidden = alreadySaved;
  }

  if (saveToLibraryBtn) {
    saveToLibraryBtn.addEventListener("click", () => {
      try {
        saveReviewer(reviewer);
        sharedBanner.hidden = true;
        showToast("Saved to your library! 💾✨ You can now track your study streaks!", "🎉");
        updateGlobalHeaderGamification();
        if (currentUser) {
          syncLocalDecksToCloud(false);
        }
      } catch (_err) {
        showToast("Could not save to local library.", "⚠️");
      }
    });
  }

  qs("[data-title]").textContent = reviewer.title;
  qs("[data-summary]").textContent = reviewer.summary;
  qs("[data-created]").textContent = `✨ Created ${formatDate(reviewer.createdAt)}`;
  qs("[data-fc-count]").textContent = String(reviewer.flashcards?.length || 0);
  qs("[data-mcq-count]").textContent = String(reviewer.multipleChoice?.length || 0);

  function renderProgress() {
    const current = getReviewer(id) || reviewer;
    const progress = getReviewerProgress(id);
    const cards = current?.flashcards || [];
    const mastered = cards.filter((card) => card.stats?.mastered).length;
    const percent = cards.length ? Math.round((mastered / cards.length) * 100) : 0;
    const answered = progress.quizQuestionsAnswered || 0;
    const accuracy = answered ? Math.round((progress.quizCorrect / answered) * 100) : 0;

    const setText = (selector, value) => {
      const element = qs(selector);
      if (element) element.textContent = value;
    };

    setText("[data-mastery-percent]", `${percent}%`);
    const masteryBar = qs("[data-mastery-bar]");
    if (masteryBar) masteryBar.style.width = `${percent}%`;
    setText("[data-mastery-label]", `${mastered} / ${cards.length} mastered ⭐`);
    setText("[data-current-streak]", String(progress.currentStreak));
    setText("[data-best-streak]", String(progress.bestStreak));
    setText("[data-quiz-accuracy]", `${accuracy}%`);
    setText("[data-quiz-attempts]", String(progress.quizAttempts));
    setText("[data-study-sessions]", String(progress.studySessions));
    setText("[data-last-studied]", progress.lastStudied ? formatDate(progress.lastStudied) : "Not yet");

    const mascotSpeech = qs("[data-reviewer-mascot-speech]");
    if (mascotSpeech) {
      if (percent === 100) {
        mascotSpeech.textContent = "🏆 Incredible! You've mastered 100% of this deck! You're a true champion! ✨";
      } else if (percent >= 50) {
        mascotSpeech.textContent = `🌟 Awesome progress! You're already ${percent}% of the way to full mastery! Keep going! 🚀`;
      } else {
        mascotSpeech.textContent = "Let's study! Review your flashcards first, then test your skills with the quiz! 💡✨";
      }
    }

    updateGlobalHeaderGamification();
  }

  renderProgress();

  const flashcardsRoot = qs("[data-flashcards-root]");
  const quizRoot = qs("[data-quiz-root]");
  const flashcards = createFlashcardSession(flashcardsRoot, reviewer.flashcards || [], {
    onAnswer(card, correct) {
      recordFlashcardAnswer(id, card.id, correct);
      renderProgress();
    }
  });
  createQuizSession(quizRoot, reviewer.multipleChoice || [], {
    onAnswer(correct) {
      recordQuizAnswer(id, correct);
      renderProgress();
    },
    onComplete(correct, total) {
      recordQuizResult(id, correct, total);
      renderProgress();
    }
  });

  const panels = {
    overview: qs("[data-panel='overview']"),
    flashcards: qs("[data-panel='flashcards']"),
    quiz: qs("[data-panel='quiz']")
  };
  let sessionStarted = false;

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
    if ((name === "flashcards" || name === "quiz") && !sessionStarted) {
      recordStudySession(id);
      sessionStarted = true;
      renderProgress();
    }
  }

  qsa("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => showPanel(tab.dataset.tab));
  });

  window.addEventListener("revia:show-overview", () => showPanel("overview"));

  const handleShare = () => {
    qs(".reviewer-menu")?.removeAttribute("open");
    shareReviewerDeck(reviewer);
  };

  qs("[data-open-share]")?.addEventListener("click", handleShare);
  qs("[data-menu-share]")?.addEventListener("click", handleShare);

  const deleteModal = qs("[data-delete-modal]");
  const renameModal = qs("[data-rename-modal]");
  const renameInput = qs("#rename-title");

  qs("[data-open-rename]")?.addEventListener("click", () => {
    qs(".reviewer-menu")?.removeAttribute("open");
    if (renameInput) renameInput.value = reviewer.title;
    openModal(renameModal);
  });

  qs("[data-open-delete]")?.addEventListener("click", () => {
    qs(".reviewer-menu")?.removeAttribute("open");
    openModal(deleteModal);
  });

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
      reviewer.title = nextTitle;
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
      closeModal(qs("[data-auth-modal]"));
    });
  });

  showPanel("overview");
}

/* ==============================================================================
   Shared UI & Global Event Listeners
============================================================================== */

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
    closeHeaderMenu();
  });

  // Close header kebab menu when clicking outside
  document.addEventListener("click", (event) => {
    const headerMenu = qs("[data-header-menu]");
    if (headerMenu && headerMenu.hasAttribute("open") && !headerMenu.contains(event.target)) {
      headerMenu.removeAttribute("open");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initInstallPrompt();
  setActiveNav();
  initSharedUi();
  updateGlobalHeaderGamification();
  initAuth();

  const page = document.body.dataset.page;
  if (page === "dashboard") initDashboard();
  if (page === "create") initCreate();
  if (page === "library") initLibrary();
  if (page === "reviewer") initReviewer();
});
