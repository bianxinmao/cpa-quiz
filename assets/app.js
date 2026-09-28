"use strict";

const STORAGE_KEY = "cpa-quiz-wrong-book-v1";
const SESSION_STORAGE_KEY = "cpa-quiz-random-session-v1";

const dom = {
  bankStatus: document.getElementById("bank-status"),
  startAll: document.getElementById("start-all"),
  startWrong: document.getElementById("start-wrong"),
  restartAll: document.getElementById("restart-all"),
  exportWrong: document.getElementById("export-wrong"),
  questionCard: document.getElementById("question-card"),
  questionIndex: document.getElementById("question-index"),
  questionType: document.getElementById("question-type"),
  questionTopic: document.getElementById("question-topic"),
  questionStem: document.getElementById("question-stem"),
  answerForm: document.getElementById("answer-form"),
  options: document.getElementById("options"),
  submitAnswer: document.getElementById("submit-answer"),
  nextQuestion: document.getElementById("next-question"),
  removeWrong: document.getElementById("remove-wrong"),
  resultPanel: document.getElementById("result-panel"),
  resultTitle: document.getElementById("result-title"),
  userAnswer: document.getElementById("user-answer"),
  correctAnswer: document.getElementById("correct-answer"),
  questionAnalysis: document.getElementById("question-analysis"),
  emptyState: document.getElementById("empty-state"),
  emptyTitle: document.getElementById("empty-title"),
  emptyDescription: document.getElementById("empty-description"),
};

const state = {
  questions: [],
  questionsById: new Map(),
  wrongBook: createEmptyWrongBook(),
  queue: [],
  queueIndex: 0,
  mode: "all",
  submitted: false,
};

function createEmptyWrongBook() {
  return { version: 1, questions: {} };
}

function loadWrongBook() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return createEmptyWrongBook();
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.questions || typeof parsed.questions !== "object") {
      return createEmptyWrongBook();
    }

    const validRecords = {};
    for (const [id, record] of Object.entries(parsed.questions)) {
      if (!id || !record || typeof record !== "object") {
        continue;
      }
      validRecords[id] = {
        wrongCount: Number.isFinite(record.wrongCount) ? Math.max(0, Math.trunc(record.wrongCount)) : 1,
        correctCount: Number.isFinite(record.correctCount) ? Math.max(0, Math.trunc(record.correctCount)) : 0,
        addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date().toISOString(),
        lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : new Date().toISOString(),
        lastAnswer: typeof record.lastAnswer === "string" ? record.lastAnswer : "",
      };
    }
    return { version: 1, questions: validRecords };
  } catch (error) {
    console.warn("错题本读取失败，已重建空错题本。", error);
    return createEmptyWrongBook();
  }
}

function saveWrongBook() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.wrongBook));
}

function loadPracticeSession() {
  try {
    const rawValue = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue);
    if (!parsed || parsed.version !== 1 || parsed.mode !== "all" || !Array.isArray(parsed.queueIds)) {
      return null;
    }

    return {
      version: 1,
      mode: "all",
      queueIds: parsed.queueIds.map(normalizeText).filter(Boolean),
      currentIndex: Number.isInteger(parsed.currentIndex) ? parsed.currentIndex : 0,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch (error) {
    console.warn("练习进度读取失败，将重新开始。", error);
    return null;
  }
}

function savePracticeSession() {
  if (state.mode !== "all" || state.queue.length === 0) return;

  const session = {
    version: 1,
    mode: "all",
    queueIds: state.queue.map((question) => question.id),
    currentIndex: state.queueIndex,
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  updateStartAllControls();
}

function clearPracticeSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  updateStartAllControls();
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateQuestionBank(data) {
  if (!data || !Array.isArray(data.questions)) {
    throw new Error("题库必须是包含 questions 数组的 JSON 对象");
  }

  const seenIds = new Set();
  const questions = [];

  data.questions.forEach((question, index) => {
    const id = normalizeText(question?.id);
    const type = normalizeText(question?.type);
    const stem = normalizeText(question?.stem);
    const analysis = normalizeText(question?.analysis);

    if (!id) throw new Error(`第 ${index + 1} 题缺少 id`);
    if (seenIds.has(id)) throw new Error(`题目 id 重复：${id}`);
    if (!["single", "multiple"].includes(type)) throw new Error(`题目 ${id} 的 type 必须是 single 或 multiple`);
    if (!stem) throw new Error(`题目 ${id} 缺少 stem`);
    if (!Array.isArray(question.options) || question.options.length < 2) throw new Error(`题目 ${id} 至少需要两个选项`);
    if (!analysis) throw new Error(`题目 ${id} 缺少 analysis`);

    const optionKeys = new Set();
    const options = question.options.map((option, optionIndex) => {
      const key = normalizeText(option?.key);
      const text = normalizeText(option?.text);
      if (!key || !text) throw new Error(`题目 ${id} 第 ${optionIndex + 1} 个选项缺少 key 或 text`);
      if (optionKeys.has(key)) throw new Error(`题目 ${id} 选项重复：${key}`);
      optionKeys.add(key);
      return { key, text };
    });

    if (!Array.isArray(question.answer) || question.answer.length === 0) {
      throw new Error(`题目 ${id} 的 answer 必须是非空数组`);
    }
    const answer = question.answer.map(normalizeText);
    if (answer.some((key) => !optionKeys.has(key))) throw new Error(`题目 ${id} 的 answer 包含不存在的选项`);
    if (new Set(answer).size !== answer.length) throw new Error(`题目 ${id} 的 answer 存在重复选项`);
    if (type === "single" && answer.length !== 1) throw new Error(`单选题 ${id} 只能有一个答案`);
    if (type === "multiple" && answer.length < 2) throw new Error(`多选题 ${id} 至少需要两个答案`);

    seenIds.add(id);
    questions.push({
      id,
      type,
      subject: normalizeText(question.subject) || "未分类",
      chapter: normalizeText(question.chapter),
      topic: normalizeText(question.topic),
      stem,
      options,
      answer,
      analysis,
      tags: Array.isArray(question.tags) ? question.tags.map(normalizeText).filter(Boolean) : [],
      difficulty: Number.isFinite(question.difficulty) ? Math.min(5, Math.max(1, Math.trunc(question.difficulty))) : null,
    });
  });

  if (questions.length === 0) throw new Error("题库为空");
  return questions;
}

async function loadQuestionBank() {
  const response = await fetch("./data/questions.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`题库读取失败：HTTP ${response.status}`);
  return validateQuestionBank(await response.json());
}

function getWrongQuestions() {
  return Object.keys(state.wrongBook.questions)
    .map((id) => state.questionsById.get(id))
    .filter(Boolean);
}

function buildQueue(mode, previousId = "") {
  const source = mode === "wrong" ? getWrongQuestions() : state.questions;
  const queue = shuffle(source);
  if (queue.length > 1 && previousId && queue[0].id === previousId) {
    queue.push(queue.shift());
  }
  return queue;
}

function updateBankStatus() {
  const wrongCount = Object.keys(state.wrongBook.questions).length;
  dom.bankStatus.textContent = `题库 ${state.questions.length} 题｜错题本 ${wrongCount} 题`;
  dom.exportWrong.hidden = wrongCount === 0;
}

function buildWrongExport() {
  const questions = Object.entries(state.wrongBook.questions)
    .map(([id, record]) => {
      const question = state.questionsById.get(id);
      if (!question) return null;
      return {
        id: question.id,
        subject: question.subject,
        chapter: question.chapter,
        topic: question.topic,
        stem: question.stem,
        options: Object.fromEntries(question.options.map((option) => [option.key, option.text])),
        answer: question.answer.join(""),
        lastAnswer: record.lastAnswer || "",
        wrongCount: record.wrongCount,
        correctCount: record.correctCount,
        analysis: question.analysis,
      };
    })
    .filter(Boolean);
  return { version: 1, exportedAt: new Date().toISOString(), questions };
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

async function handleExportWrong() {
  const exportData = buildWrongExport();
  if (exportData.questions.length === 0) {
    showEmpty("错题本为空", "先做随机练习，答错的题会自动进入错题本。");
    return;
  }

  try {
    await copyTextToClipboard(JSON.stringify(exportData));
    dom.exportWrong.textContent = "已复制，粘贴给Codex";
    dom.exportWrong.disabled = true;
    setTimeout(() => {
      dom.exportWrong.textContent = "导出错题";
      dom.exportWrong.disabled = false;
    }, 2000);
  } catch {
    dom.exportWrong.textContent = "复制失败，请重试";
    setTimeout(() => {
      dom.exportWrong.textContent = "导出错题";
    }, 2000);
  }
}

function updateStartAllControls() {
  const hasPracticeSession = loadPracticeSession() !== null;
  dom.startAll.textContent = hasPracticeSession ? "继续练习" : "随机练习";
  dom.restartAll.hidden = !hasPracticeSession;
}

function showEmpty(title, description) {
  dom.questionCard.hidden = true;
  dom.emptyState.hidden = false;
  dom.emptyTitle.textContent = title;
  dom.emptyDescription.textContent = description;
}

function restorePracticeSession() {
  const session = loadPracticeSession();
  if (!session) return false;

  const existingIds = new Set();
  const queue = [];
  session.queueIds.forEach((id) => {
    if (existingIds.has(id) || !state.questionsById.has(id)) return;
    existingIds.add(id);
    queue.push(state.questionsById.get(id));
  });

  state.questions.forEach((question) => {
    if (existingIds.has(question.id)) return;
    existingIds.add(question.id);
    queue.push(question);
  });

  if (queue.length === 0) {
    clearPracticeSession();
    return false;
  }

  state.mode = "all";
  state.queue = queue;
  state.queueIndex = Math.min(Math.max(session.currentIndex, 0), queue.length - 1);
  dom.emptyState.hidden = true;
  dom.questionCard.hidden = false;
  renderQuestion();
  return true;
}

function startQuiz(mode) {
  state.mode = mode;
  state.queue = buildQueue(mode);
  state.queueIndex = 0;

  if (state.queue.length === 0) {
    showEmpty(
      mode === "wrong" ? "错题本为空" : "题库为空",
      mode === "wrong" ? "先做随机练习，答错的题会自动进入错题本。" : "请检查 data/questions.json。"
    );
    return;
  }

  dom.emptyState.hidden = true;
  dom.questionCard.hidden = false;
  if (mode === "all") {
    savePracticeSession();
  }
  renderQuestion();
}

function renderQuestion() {
  const question = state.queue[state.queueIndex];
  if (!question) {
    startQuiz(state.mode);
    return;
  }

  state.submitted = false;
  if (state.mode === "all") {
    savePracticeSession();
  }
  dom.questionIndex.textContent = `第 ${state.queueIndex + 1}/${state.queue.length} 道`;
  dom.questionType.textContent = question.type === "single" ? "单选题" : "多选题";
  dom.questionTopic.textContent = question.topic || question.chapter || question.subject;
  dom.questionStem.textContent = question.stem;
  dom.resultPanel.hidden = true;
  dom.nextQuestion.hidden = true;
  dom.removeWrong.hidden = true;
  dom.submitAnswer.hidden = false;
  dom.submitAnswer.disabled = true;
  dom.options.innerHTML = "";

  const fragment = document.createDocumentFragment();
  question.options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "option";
    label.dataset.key = option.key;

    const input = document.createElement("input");
    input.type = question.type === "single" ? "radio" : "checkbox";
    input.name = "answer";
    input.value = option.key;
    input.addEventListener("change", updateSubmitState);

    const content = document.createElement("span");
    content.className = "option-content";
    const key = document.createElement("span");
    key.className = "option-key";
    key.textContent = option.key;
    const text = document.createElement("span");
    text.className = "option-text";
    text.textContent = option.text;

    content.append(key, text);
    label.append(input, content);
    fragment.append(label);
  });
  dom.options.append(fragment);
}

function getSelectedAnswers() {
  return [...dom.options.querySelectorAll('input[name="answer"]:checked')].map((input) => input.value);
}

function updateSubmitState() {
  dom.submitAnswer.disabled = state.submitted || getSelectedAnswers().length === 0;
}

function sameAnswer(selected, correct) {
  const selectedSet = new Set(selected);
  return selected.length === correct.length && correct.every((key) => selectedSet.has(key));
}

function markOptions(selected, correct) {
  const selectedSet = new Set(selected);
  const correctSet = new Set(correct);
  dom.options.querySelectorAll(".option").forEach((label) => {
    const key = label.dataset.key;
    label.querySelector("input").disabled = true;
    label.classList.toggle("is-selected", selectedSet.has(key));
    label.classList.toggle("is-correct", correctSet.has(key));
    label.classList.toggle("is-incorrect", selectedSet.has(key) && !correctSet.has(key));
  });
}

function formatAnswer(answer) {
  return answer.length ? answer.join("") : "未作答";
}

function updateWrongRecord(question, selected, isCorrect) {
  const now = new Date().toISOString();
  const record = state.wrongBook.questions[question.id] || {
    wrongCount: 0,
    correctCount: 0,
    addedAt: now,
  };

  record.lastSeenAt = now;
  record.lastAnswer = selected.join("");
  if (isCorrect) record.correctCount += 1;
  else record.wrongCount += 1;

  state.wrongBook.questions[question.id] = record;
  saveWrongBook();
  updateBankStatus();
}

function handleSubmit(event) {
  event.preventDefault();
  if (state.submitted) return;

  const selected = getSelectedAnswers();
  if (selected.length === 0) return;

  const question = state.queue[state.queueIndex];
  const isCorrect = sameAnswer(selected, question.answer);
  state.submitted = true;

  markOptions(selected, question.answer);
  updateWrongRecord(question, selected, isCorrect);

  dom.submitAnswer.hidden = true;
  dom.resultPanel.hidden = false;
  dom.resultTitle.textContent = isCorrect ? "回答正确" : "回答错误";
  dom.resultTitle.className = `result-title ${isCorrect ? "correct" : "wrong"}`;
  dom.userAnswer.textContent = formatAnswer(selected);
  dom.correctAnswer.textContent = formatAnswer(question.answer);
  dom.questionAnalysis.textContent = question.analysis;
  dom.nextQuestion.hidden = false;
  dom.removeWrong.hidden = !(isCorrect && state.wrongBook.questions[question.id]);
  dom.nextQuestion.focus();
}

function handleNext() {
  state.queueIndex += 1;
  if (state.queueIndex >= state.queue.length) {
    const previousQuestion = state.queue[state.queue.length - 1];
    state.queue = buildQueue(state.mode, previousQuestion?.id || "");
    state.queueIndex = 0;
  }
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleRemoveWrong() {
  const question = state.queue[state.queueIndex];
  if (!question) return;

  delete state.wrongBook.questions[question.id];
  saveWrongBook();
  updateBankStatus();
  dom.removeWrong.hidden = true;

  if (state.mode === "wrong" && Object.keys(state.wrongBook.questions).length === 0) {
    showEmpty("错题本已清空", "可以回到随机练习继续巩固。");
  }
}

async function initialize() {
  dom.startAll.disabled = true;
  dom.startWrong.disabled = true;
  dom.restartAll.disabled = true;
  dom.exportWrong.disabled = true;
  try {
    state.questions = await loadQuestionBank();
    state.questionsById = new Map(state.questions.map((question) => [question.id, question]));
    state.wrongBook = loadWrongBook();
    const staleWrongIds = Object.keys(state.wrongBook.questions).filter((id) => !state.questionsById.has(id));
    if (staleWrongIds.length > 0) {
      staleWrongIds.forEach((id) => delete state.wrongBook.questions[id]);
      saveWrongBook();
    }
    updateBankStatus();
    updateStartAllControls();
    dom.startAll.disabled = false;
    dom.startWrong.disabled = false;
    dom.restartAll.disabled = false;
    dom.exportWrong.disabled = false;
  } catch (error) {
    console.error(error);
    showEmpty("题库加载失败", "请确认 data/questions.json 格式正确；部署后访问 index.html。");
    dom.bankStatus.textContent = "题库加载失败";
  }
}

dom.answerForm.addEventListener("submit", handleSubmit);
dom.nextQuestion.addEventListener("click", handleNext);
dom.removeWrong.addEventListener("click", handleRemoveWrong);
dom.startAll.addEventListener("click", () => {
  if (!restorePracticeSession()) {
    startQuiz("all");
  }
});
dom.startWrong.addEventListener("click", () => startQuiz("wrong"));
dom.exportWrong.addEventListener("click", handleExportWrong);
dom.restartAll.addEventListener("click", () => {
  clearPracticeSession();
  startQuiz("all");
});

initialize();
