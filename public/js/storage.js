const STORAGE_KEY = "ai-reviewer-library";

function defaultProgress() {
  return {
    flashcardsStudied: 0,
    flashcardsCorrect: 0,
    flashcardsIncorrect: 0,
    currentStreak: 0,
    bestStreak: 0,
    quizAttempts: 0,
    quizQuestionsAnswered: 0,
    quizCorrect: 0,
    quizIncorrect: 0,
    studySessions: 0,
    xp: 0,
    lastStudied: null
  };
}

function normalizeReviewer(reviewer) {
  const progress = { ...defaultProgress(), ...(reviewer.progress || {}) };
  const flashcards = (Array.isArray(reviewer.flashcards) ? reviewer.flashcards : []).map((card) => ({
    ...card,
    stats: { correct: 0, incorrect: 0, streak: 0, mastered: false, ...(card.stats || {}) }
  }));
  return { ...reviewer, progress, flashcards };
}

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
    const reviewers = safeParse(localStorage.getItem(STORAGE_KEY)).map(normalizeReviewer);
    return reviewers;
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
  reviewers.unshift(normalizeReviewer(reviewer));

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

  reviewers[index] = normalizeReviewer({
    ...reviewers[index],
    ...updates,
    id: reviewers[index].id,
    createdAt: reviewers[index].createdAt
  });

  if (!writeReviewers(reviewers)) {
    throw new Error("storage-write");
  }

  return reviewers[index];
}

export function getReviewerProgress(id) {
  return getReviewer(id)?.progress || defaultProgress();
}

export function getGlobalStats() {
  const reviewers = getReviewers();
  let totalXp = 0;
  let totalMastered = 0;
  let totalCards = 0;
  let maxStreak = 0;
  let currentStreak = 0;

  reviewers.forEach((r) => {
    const p = r.progress || defaultProgress();
    totalXp += p.xp || (p.flashcardsCorrect * 10 + p.quizCorrect * 25 + p.quizAttempts * 50);
    maxStreak = Math.max(maxStreak, p.bestStreak || 0);
    currentStreak = Math.max(currentStreak, p.currentStreak || 0);

    (r.flashcards || []).forEach((c) => {
      totalCards += 1;
      if (c.stats?.mastered) {
        totalMastered += 1;
      }
    });
  });

  return {
    reviewersCount: reviewers.length,
    totalCards,
    totalMastered,
    maxStreak,
    currentStreak,
    totalXp: Math.max(0, totalXp)
  };
}

export function recordFlashcardAnswer(id, cardId, correct) {
  const reviewer = getReviewer(id);
  if (!reviewer) return null;
  const card = reviewer.flashcards.find((item) => item.id === cardId);
  if (!card) return null;

  const stats = { correct: 0, incorrect: 0, streak: 0, mastered: false, ...(card.stats || {}) };
  stats.correct += correct ? 1 : 0;
  stats.incorrect += correct ? 0 : 1;
  stats.streak = correct ? stats.streak + 1 : 0;
  stats.mastered = correct && stats.streak >= 3;

  const progress = { ...defaultProgress(), ...reviewer.progress };
  progress.flashcardsStudied += 1;
  progress.flashcardsCorrect += correct ? 1 : 0;
  progress.flashcardsIncorrect += correct ? 0 : 1;
  progress.xp = (progress.xp || 0) + (correct ? 15 : 5);
  progress.lastStudied = new Date().toISOString();

  return updateReviewer(id, {
    progress,
    flashcards: reviewer.flashcards.map((item) => (item.id === cardId ? { ...item, stats } : item))
  });
}

export function recordQuizAnswer(id, correct) {
  const reviewer = getReviewer(id);
  if (!reviewer) return null;
  const progress = { ...defaultProgress(), ...reviewer.progress };
  progress.quizQuestionsAnswered += 1;
  progress.quizCorrect += correct ? 1 : 0;
  progress.quizIncorrect += correct ? 0 : 1;
  progress.currentStreak = correct ? progress.currentStreak + 1 : 0;
  progress.bestStreak = Math.max(progress.bestStreak, progress.currentStreak);
  progress.xp = (progress.xp || 0) + (correct ? 25 : 5);
  progress.lastStudied = new Date().toISOString();
  return updateReviewer(id, { progress });
}

export function recordQuizResult(id, correct, total) {
  const reviewer = getReviewer(id);
  if (!reviewer) return null;
  const progress = { ...defaultProgress(), ...reviewer.progress };
  progress.quizAttempts += 1;
  progress.xp = (progress.xp || 0) + Math.round((correct / (total || 1)) * 50);
  progress.lastStudied = new Date().toISOString();
  return updateReviewer(id, { progress });
}

export function recordStudySession(id) {
  const reviewer = getReviewer(id);
  if (!reviewer) return null;
  const progress = { ...defaultProgress(), ...reviewer.progress };
  progress.studySessions += 1;
  progress.xp = (progress.xp || 0) + 10;
  progress.lastStudied = new Date().toISOString();
  return updateReviewer(id, { progress });
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
