/**
 * app.js - エントリーポイント: イベントリスナー登録と初期化
 */
(function (App) {
  'use strict';

  const { state, els } = App;

  let currentView = 'play';

  /**
   * アクティブビューを切り替え
   */
  function setActiveView(view) {
    currentView = view;
    els.viewPlay.classList.toggle('hidden', view !== 'play');
    els.viewManage.classList.toggle('hidden', view !== 'manage');
    els.tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.viewSwitch === view));
    if (view === 'manage' && !state.admin.loaded) {
      App.admin.loadQuestions();
    }
  }

  // --- イベントリスナー登録 ---

  // クイズ選択肢
  els.choiceButtons.forEach((btn) =>
    btn.addEventListener('click', () => App.quiz.postAnswer(btn.dataset.choice)),
  );

  // 次の問題へ
  if (els.nextBtn) {
    els.nextBtn.addEventListener('click', App.quiz.nextQuestion);
  }

  // 再挑戦
  if (els.restartBtn) {
    els.restartBtn.addEventListener('click', App.quiz.loadQuiz);
  }

  // 履歴クリア
  if (els.clearHistory) {
    els.clearHistory.addEventListener('click', App.quiz.clearHistory);
  }

  // タブ切り替え
  els.tabs.forEach((btn) =>
    btn.addEventListener('click', () => {
      const view = btn.dataset.viewSwitch;
      if (view) setActiveView(view);
    }),
  );

  // 問題一覧更新
  if (els.refreshQuestions) {
    els.refreshQuestions.addEventListener('click', App.admin.loadQuestions);
  }

  // クイズオプション（問題数選択）
  if (els.quizOptions) {
    els.quizOptions.addEventListener('submit', (e) => {
      e.preventDefault();
      App.quiz.loadQuiz();
    });
  }

  // カスタム問題数入力の有効/無効切り替え
  if (els.quizCountRadios.length > 0 && els.quizCountCustom) {
    els.quizCountRadios.forEach((radio) =>
      radio.addEventListener('change', () => {
        const isCustom = els.quizCountRadios.find((r) => r.checked)?.value === 'custom';
        els.quizCountCustom.disabled = !isCustom;
      }),
    );
  }

  // 問題作成フォーム
  if (els.createForm) {
    els.createForm.addEventListener('submit', App.admin.handleCreateQuestion);
  }

  // 問題編集フォーム
  if (els.editForm) {
    els.editForm.addEventListener('submit', App.admin.handleEditQuestion);
  }

  // 編集フォームリセット
  if (els.clearEdit) {
    els.clearEdit.addEventListener('click', App.admin.resetEditForm);
  }

  // --- 初期化 ---
  App.quiz.renderHistory();
  App.quiz.loadQuiz();
  setActiveView('play');
})(App);
