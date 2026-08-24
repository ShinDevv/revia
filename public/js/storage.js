const STORAGE_KEY = "ai-reviewer-library";

function safeParse(raw) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeReviewers(reviewers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reviewers));
    return true;
  } catch (_error) {
    return false;
  }
}

export function getReviewers() {
  try {
    return safeParse(localStorage.getItem(STORAGE_KEY));
  } catch (_error) {
    return [];
  }
}

export function getReviewer(id) {
  if (!id) {
    return null;
  }
  return getReviewers().find((reviewer) => reviewer.id === id) || null;
}

export function saveReviewer(reviewer) {
  if (!reviewer || !reviewer.id) {
    throw new Error("invalid-reviewer");
  }

  const reviewers = getReviewers().filter((item) => item.id !== reviewer.id);
  reviewers.unshift(reviewer);

  if (!writeReviewers(reviewers)) {
    throw new Error("storage-write");
  }

  return reviewer;
}

export function updateReviewer(id, updates) {
  const reviewers = getReviewers();
  const index = reviewers.findIndex((item) => item.id === id);

  if (index === -1) {
    return null;
  }

  reviewers[index] = {
    ...reviewers[index],
    ...updates,
    id: reviewers[index].id,
    createdAt: reviewers[index].createdAt
  };

  if (!writeReviewers(reviewers)) {
    throw new Error("storage-write");
  }

  return reviewers[index];
}

export function deleteReviewer(id) {
  const reviewers = getReviewers();
  const next = reviewers.filter((item) => item.id !== id);

  if (next.length === reviewers.length) {
    return false;
  }

  if (!writeReviewers(next)) {
    throw new Error("storage-write");
  }

  return true;
}

export function clearReviewers() {
  if (!writeReviewers([])) {
    throw new Error("storage-write");
  }
}
