/**
 * state.js - グローバル名前空間とアプリケーション状態の定義
 */
const App = (function () {
  'use strict';

  const HISTORY_KEY = 'aws-amazon-quiz-history';

  const state = {
    quizId: '',
    questions: [],
    currentIndex: 0,
    answers: [],
    score: 0,
    results: [],
    startedAt: 0,
    admin: {
      questions: [],
      selectedId: '',
      loaded: false,
    },
  };

  const els = {
    quizId: document.getElementById('quiz-id'),
    progress: document.getElementById('progress'),
    score: document.getElementById('score'),
    questionText: document.getElementById('question-text'),
    questionMeta: document.getElementById('question-meta'),
    feedback: document.getElementById('feedback'),
    summary: document.getElementById('summary'),
    summaryText: document.getElementById('summary-text'),
    summaryList: document.getElementById('summary-list'),
    history: document.getElementById('history'),
    nextBtn: document.getElementById('next-btn'),
    restartBtn: document.getElementById('restart-btn'),
    clearHistory: document.getElementById('clear-history'),
    choiceButtons: Array.from(document.querySelectorAll('.choice')),
    tabs: Array.from(document.querySelectorAll('[data-view-switch]')),
    viewPlay: document.getElementById('view-play'),
    viewManage: document.getElementById('view-manage'),
    questionList: document.getElementById('question-list'),
    questionListStatus: document.getElementById('question-list-status'),
    refreshQuestions: document.getElementById('refresh-questions'),
    createForm: document.getElementById('create-question-form'),
    createStatus: document.getElementById('create-status'),
    editForm: document.getElementById('edit-question-form'),
    editStatus: document.getElementById('edit-status'),
    editTitle: document.getElementById('edit-title'),
    clearEdit: document.getElementById('clear-edit'),
    quizOptions: document.getElementById('quiz-options'),
    quizCountRadios: Array.from(document.querySelectorAll('input[name="count"]')),
    quizCountCustom: document.getElementById('count-custom'),
  };

  return {
    HISTORY_KEY,
    state,
    els,
  };
})();

