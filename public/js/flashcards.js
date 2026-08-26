export function createFlashcardSession(root, cards, options = {}) {
  const deck = Array.isArray(cards) ? cards : [];
  let index = 0;
  let flipped = false;
  let keyHandler = null;

  function currentCard() {
    return deck[index] || null;
  }

  function render() {
    const card = currentCard();
    const total = deck.length;
    const progress = root.querySelector("[data-fc-progress]");
    const front = root.querySelector("[data-fc-front]");
    const back = root.querySelector("[data-fc-back]");
    const flipEl = root.querySelector("[data-fc-card]");
    const prevBtn = root.querySelector("[data-fc-prev]");
    const nextBtn = root.querySelector("[data-fc-next]");
    const flipBtn = root.querySelector("[data-fc-flip]");
    const answerPrompt = root.querySelector("[data-fc-answer-prompt]");
    const gotItBtn = root.querySelector("[data-fc-got-it]");
    const missedBtn = root.querySelector("[data-fc-missed]");

    if (!card) {
      if (progress) progress.textContent = "No flashcards available.";
      if (front) front.textContent = "This reviewer has no flashcards.";
      if (back) back.textContent = "";
      return;
    }

    if (progress) {
      progress.textContent = `Card ${index + 1} of ${total}`;
    }
    if (front) front.textContent = card.front;
    if (back) back.textContent = card.back;
    if (flipEl) {
      flipEl.classList.toggle("is-flipped", flipped);
      flipEl.setAttribute("aria-label", flipped ? `Answer: ${card.back}` : `Question: ${card.front}`);
    }
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === total - 1;
    if (flipBtn) flipBtn.setAttribute("aria-pressed", flipped ? "true" : "false");
    if (answerPrompt) answerPrompt.hidden = !flipped;
    if (gotItBtn) gotItBtn.disabled = !flipped;
    if (missedBtn) missedBtn.disabled = !flipped;
  }

  function flip() {
    if (!currentCard()) {
      return;
    }
    flipped = !flipped;
    render();
  }

  function previous() {
    if (index === 0) {
      return;
    }
    index -= 1;
    flipped = false;
    render();
  }

  function next() {
    if (index >= deck.length - 1) {
      return;
    }
    index += 1;
    flipped = false;
    render();
  }

  function answer(correct) {
    const card = currentCard();
    if (!card || !flipped) return;
    options.onAnswer?.(card, correct);
  }

  function onKeyDown(event) {
    if (event.target && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      flip();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    }
  }

  function bind() {
    root.querySelector("[data-fc-card]")?.addEventListener("click", flip);
    root.querySelector("[data-fc-flip]")?.addEventListener("click", flip);
    root.querySelector("[data-fc-prev]")?.addEventListener("click", previous);
    root.querySelector("[data-fc-next]")?.addEventListener("click", next);
    root.querySelector("[data-fc-got-it]")?.addEventListener("click", () => answer(true));
    root.querySelector("[data-fc-missed]")?.addEventListener("click", () => answer(false));
  }

  function activate() {
    if (keyHandler) {
      return;
    }
    keyHandler = onKeyDown;
    window.addEventListener("keydown", keyHandler);
  }

  function deactivate() {
    if (!keyHandler) {
      return;
    }
    window.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }

  bind();
  render();

  return {
    render,
    activate,
    deactivate
  };
}
