export function createQuizSession(root, questions, options = {}) {
  const items = Array.isArray(questions) ? questions.map((item) => ({ ...item })) : [];
  const state = {
    index: 0,
    selected: null,
    submitted: false,
    correct: 0,
    incorrect: 0
  };

  function currentQuestion() {
    return items[state.index] || null;
  }

  function optionMarkup(question, option, optionIndex) {
    const selected = state.selected === optionIndex;
    const submitted = state.submitted;
    const isCorrect = optionIndex === question.answerIndex;
    let extraClass = "";
    let status = "";

    if (submitted && isCorrect) {
      extraClass = "is-correct";
      status = "Correct option";
    } else if (submitted && selected && !isCorrect) {
      extraClass = "is-incorrect";
      status = "Your answer, incorrect";
    } else if (selected) {
      extraClass = "is-selected";
    }

    return `
      <label class="quiz-option ${extraClass}">
        <input
          type="radio"
          name="quiz-option"
          value="${optionIndex}"
          ${selected ? "checked" : ""}
          ${submitted ? "disabled" : ""}
        >
        <span class="quiz-option-marker" aria-hidden="true"></span>
        <span class="quiz-option-text">${escapeHtml(option)}</span>
        ${status ? `<span class="visually-hidden">${status}</span>` : ""}
      </label>
    `;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    const question = currentQuestion();
    const stage = root.querySelector("[data-quiz-stage]");
    if (!stage) {
      return;
    }

    if (!items.length) {
      stage.innerHTML = `<p class="empty-copy">This reviewer has no quiz questions.</p>`;
      return;
    }

    if (state.index >= items.length) {
      const total = items.length;
      const percent = total ? Math.round((state.correct / total) * 100) : 0;
      stage.innerHTML = `
        <div class="quiz-complete">
          <p class="eyebrow">Quiz complete</p>
          <h2>Score: ${state.correct} / ${total}</h2>
          <p class="quiz-percent">${percent}%</p>
          <div class="button-row">
            <button type="button" class="button button-primary" data-quiz-retry>Retry Quiz</button>
            <button type="button" class="button button-secondary" data-quiz-back>Back to Reviewer</button>
          </div>
        </div>
      `;
      stage.querySelector("[data-quiz-retry]")?.addEventListener("click", reset);
      if (!state.completed) {
        state.completed = true;
        options.onComplete?.(state.correct, total);
      }
      stage.querySelector("[data-quiz-back]")?.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("revia:show-overview"));
      });
      return;
    }

    const feedback = state.submitted
      ? state.selected === question.answerIndex
        ? `<div class="quiz-feedback is-correct" role="status"><strong>Correct!</strong><p>${escapeHtml(question.explanation)}</p></div>`
        : `<div class="quiz-feedback is-incorrect" role="status"><strong>Incorrect</strong><p>Correct answer: ${escapeHtml(question.options[question.answerIndex])}</p><p>${escapeHtml(question.explanation)}</p></div>`
      : "";

    stage.innerHTML = `
      <p class="eyebrow">Question ${state.index + 1} of ${items.length}</p>
      <h2 class="quiz-question">${escapeHtml(question.question)}</h2>
      <fieldset class="quiz-options" ${state.submitted ? "disabled" : ""}>
        <legend class="visually-hidden">Answer choices</legend>
        ${question.options.map((option, optionIndex) => optionMarkup(question, option, optionIndex)).join("")}
      </fieldset>
      ${feedback}
      <div class="button-row">
        ${
          state.submitted
            ? `<button type="button" class="button button-primary" data-quiz-next>${state.index === items.length - 1 ? "See Score" : "Next Question"}</button>`
            : `<button type="button" class="button button-primary" data-quiz-submit ${state.selected === null ? "disabled" : ""}>Submit Answer</button>`
        }
      </div>
    `;

    stage.querySelectorAll('input[name="quiz-option"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.selected = Number(input.value);
        render();
      });
    });

    stage.querySelector("[data-quiz-submit]")?.addEventListener("click", submit);
    stage.querySelector("[data-quiz-next]")?.addEventListener("click", next);
  }

  function submit() {
    const question = currentQuestion();
    if (state.submitted || state.selected === null || !question) {
      return;
    }

    state.submitted = true;
    if (state.selected === question.answerIndex) {
      state.correct += 1;
      options.onAnswer?.(true);
    } else {
      state.incorrect += 1;
      options.onAnswer?.(false);
    }
    render();
  }

  function next() {
    if (!state.submitted) {
      return;
    }
    state.index += 1;
    state.selected = null;
    state.submitted = false;
    state.completed = false;
    render();
  }

  function reset() {
    state.index = 0;
    state.selected = null;
    state.submitted = false;
    state.correct = 0;
    state.incorrect = 0;
    render();
  }

  render();

  return {
    render,
    reset
  };
}
