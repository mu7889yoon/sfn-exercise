/**
 * quiz.js - クイズプレイ機能と履歴管理
 */
(function (App) {
  'use strict';

  const { state, els, HISTORY_KEY } = App;

  /**
   * 履歴をローカルストレージに保存
   */
  function saveHistory(entry) {
    const existing = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    existing.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(existing.slice(0, 20)));
  }

  /**
   * 履歴を画面に描画
   */
  function renderHistory() {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (history.length === 0) {
      els.history.innerHTML = '<p class="muted">まだ履歴はありません。</p>';
      return;
    }

    els.history.innerHTML = history
      .map(
        (item) => `
        <div class="history-item">
          <div>${new Date(item.timestamp).toLocaleString()}<br/><small>ID: ${item.quizId}</small></div>
          <div class="history-score">${item.score} / ${item.total}</div>
          <div>${item.duration}s</div>
        </div>
      `,
      )
      .join('');
  }

  /**
   * 進捗表示を更新
   */
  function updateProgress() {
    els.quizId.textContent = state.quizId || '-';
    els.progress.textContent = `${Math.min(state.currentIndex + 1, state.questions.length)} / ${state.questions.length}`;
    els.score.textContent = `得点: ${state.score}`;
  }

  /**
   * フィードバックを表示
   */
  function showFeedback(result) {
    if (!result) {
      els.feedback.classList.add('hidden');
      return;
    }
    els.feedback.classList.remove('hidden');
    els.feedback.classList.toggle('success', result.correct);
    els.feedback.classList.toggle('error', !result.correct);
    const status = result.correct ? '正解！' : '残念…';
    els.feedback.innerHTML = `<strong>${status}</strong>`;
  }

  /**
   * 問題を画面に描画
   */
  function renderQuestion() {
    els.summary.classList.add('hidden');
    const question = state.questions[state.currentIndex];
    if (!question) return;

    els.questionText.textContent = question.text;
    els.questionMeta.innerHTML = question.namespace ? `<span class="tag">${question.namespace}</span>` : '';
    els.feedback.classList.add('hidden');
    els.nextBtn.disabled = true;
    els.nextBtn.textContent = state.currentIndex === state.questions.length - 1 ? '結果を見る' : '次の問題へ';

    els.choiceButtons.forEach((btn) => {
      btn.disabled = false;
      btn.classList.remove('selected');
    });

    updateProgress();
  }

  /**
   * 結果サマリーを表示
   */
  function showSummary() {
    els.summary.classList.remove('hidden');
    els.summaryText.textContent = `${state.score} / ${state.questions.length} 正解`;
    els.summaryList.innerHTML = state.results
      .map(
        (res) => `<li>${res.correct ? '✅' : '❌'} ${res.questionId} - あなた: ${res.answer} / 正解: ${res.correctAnswer}</li>`,
      )
      .join('');
  }

  /**
   * 回答を送信して採点
   */
  async function postAnswer(choice) {
    const question = state.questions[state.currentIndex];
    if (!question) return;

    state.answers[state.currentIndex] = { questionId: question.id, choice };

    els.choiceButtons.forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.choice === choice) btn.classList.add('selected');
    });

    const payload = { answers: state.answers.filter(Boolean) };

    try {
      const data = await App.api.post(`/api/quizzes/${encodeURIComponent(state.quizId)}`, payload);
      state.score = data.score;
      state.results = data.results;

      const currentResult = data.results.find((r) => r.questionId === question.id);
      showFeedback(currentResult);
      els.nextBtn.disabled = false;
      updateProgress();
    } catch (err) {
      console.error('API error:', err);
      els.feedback.classList.remove('hidden');
      els.feedback.classList.add('error');
      els.feedback.textContent = `採点に失敗しました。${err.message} もう一度お試しください。`;
      els.choiceButtons.forEach((btn) => (btn.disabled = false));
    }
  }

  /**
   * クイズ終了処理
   */
  function maybeFinish() {
    if (state.currentIndex < state.questions.length - 1) return;
    showSummary();
    saveHistory({
      timestamp: Date.now(),
      score: state.score,
      total: state.questions.length,
      quizId: state.quizId,
      duration: Math.ceil((performance.now() - state.startedAt) / 1000),
    });
    renderHistory();
  }

  /**
   * 次の問題へ進む
   */
  function nextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
    } else {
      maybeFinish();
    }
  }

  /**
   * 選択された問題数を取得
   */
  function getSelectedCount() {
    const selected = els.quizCountRadios.find((r) => r.checked)?.value;
    if (selected === 'custom') {
      const value = Number(els.quizCountCustom?.value);
      if (Number.isFinite(value) && value > 0 && value <= 20) return value;
      return 10;
    }
    const num = Number(selected);
    return Number.isFinite(num) ? num : 10;
  }

  /**
   * クイズを読み込む
   */
  async function loadQuiz() {
    state.currentIndex = 0;
    state.answers = [];
    state.results = [];
    state.score = 0;
    els.questionText.textContent = '読み込み中...';
    els.feedback.classList.add('hidden');
    els.summary.classList.add('hidden');
    els.choiceButtons.forEach((btn) => (btn.disabled = true));

    const count = getSelectedCount();

    try {
      const query = count ? `?count=${count}` : '';
      const data = await App.api.get(`/api/quizzes${query}`);
      state.quizId = data.quizId;
      state.questions = data.questions || [];
      state.startedAt = performance.now();
    } catch (err) {
      if (err.status === 404) {
        els.questionText.textContent = 'まだ問題がありません。問題管理から作成してから「別のセットで再挑戦」を押してください。';
      } else {
        els.questionText.textContent = 'クイズの取得に失敗しました。リロードしてください。';
        console.error(err);
      }
      return;
    }

    els.choiceButtons.forEach((btn) => (btn.disabled = false));
    renderQuestion();
  }

  /**
   * 履歴をクリア
   */
  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }

  // 公開API
  App.quiz = {
    renderHistory,
    loadQuiz,
    postAnswer,
    nextQuestion,
    clearHistory,
  };
})(App);
