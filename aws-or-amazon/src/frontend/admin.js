/**
 * admin.js - 問題管理機能（CRUD）
 */
(function (App) {
  'use strict';

  const { state, els } = App;

  /**
   * 一覧ステータスを表示
   */
  function setListStatus(message, isError = false) {
    if (!els.questionListStatus) return;
    els.questionListStatus.textContent = message || '';
    els.questionListStatus.classList.toggle('status-error', isError);
  }

  /**
   * 問題一覧を描画
   */
  function renderQuestionList() {
    const list = state.admin.questions;
    if (!els.questionList) return;

    if (!list || list.length === 0) {
      els.questionList.innerHTML = '<p class="muted">まだ問題がありません。</p>';
      return;
    }

    els.questionList.innerHTML = list
      .map(
        (item) => `
        <div class="question-row">
          <div>
            <div class="row-top">
              <span class="badge">${item.id || '-'}</span>
              ${item.namespace ? `<span class="tag">${item.namespace}</span>` : ''}
              ${item.answer ? `<span class="answer-chip ${item.answer}">${item.answer === 'aws' ? 'AWS' : 'Amazon'}</span>` : ''}
            </div>
            <p class="question-text">${item.text || ''}</p>
          </div>
          <div class="row-actions">
            <button class="ghost small" data-edit="${item.id}">編集</button>
            <button class="ghost danger small" data-delete="${item.id}">削除</button>
          </div>
        </div>
      `,
      )
      .join('');

    els.questionList.querySelectorAll('button[data-edit]').forEach((btn) =>
      btn.addEventListener('click', () => startEdit(btn.dataset.edit)),
    );
    els.questionList.querySelectorAll('button[data-delete]').forEach((btn) =>
      btn.addEventListener('click', () => handleDeleteQuestion(btn.dataset.delete)),
    );
  }

  /**
   * 問題一覧を読み込み
   */
  async function loadQuestions() {
    if (!els.questionList) return;
    setListStatus('読み込み中...');
    try {
      const data = await App.api.get('/api/questions');
      const items = Array.isArray(data) ? data : data.items || [];
      state.admin.questions = items;
      renderQuestionList();
      setListStatus(`合計 ${items.length} 件`);
      state.admin.loaded = true;
    } catch (err) {
      console.error(err);
      setListStatus(err.message || '取得に失敗しました。', true);
    }
  }

  /**
   * 編集フォームをリセット
   */
  function resetEditForm() {
    if (!els.editForm) return;
    els.editForm.reset();
    state.admin.selectedId = '';
    els.editTitle.textContent = '選択中: なし';
    els.editStatus.textContent = '';
  }

  /**
   * 編集を開始
   */
  function startEdit(id) {
    if (!els.editForm) return;
    const item = state.admin.questions.find((q) => q.id === id);
    if (!item) return;
    state.admin.selectedId = item.id;
    els.editTitle.textContent = `選択中: ${state.admin.selectedId}`;
    els.editStatus.textContent = '';
    els.editForm.elements.id.value = item.id || '';
    els.editForm.elements.namespace.value = item.namespace || '';
    els.editForm.elements.text.value = item.text || '';
    if (els.editForm.elements.answer) {
      els.editForm.elements.answer.value = item.answer || '';
    }
  }

  /**
   * フォームデータからペイロードを生成
   */
  function buildPayload(formData) {
    return {
      id: (formData.get('id') || '').trim(),
      namespace: (formData.get('namespace') || '').trim() || undefined,
      text: (formData.get('text') || '').trim(),
      answer: formData.get('answer'),
    };
  }

  /**
   * ペイロードのバリデーション
   */
  function validatePayload(payload) {
    return payload.id && payload.text && payload.answer;
  }

  /**
   * 問題作成ハンドラ
   */
  async function handleCreateQuestion(event) {
    event.preventDefault();
    if (!els.createForm) return;
    els.createStatus.textContent = '送信中...';
    els.createStatus.classList.remove('status-success', 'status-error');

    const payload = buildPayload(new FormData(els.createForm));

    if (!validatePayload(payload)) {
      els.createStatus.textContent = '必須項目が未入力です。';
      els.createStatus.classList.add('status-error');
      return;
    }

    try {
      await App.api.post('/api/questions', payload);
      els.createStatus.textContent = '作成しました。';
      els.createStatus.classList.add('status-success');
      els.createForm.reset();
      loadQuestions();
    } catch (err) {
      els.createStatus.textContent = err.message;
      els.createStatus.classList.add('status-error');
    }
  }

  /**
   * 問題編集ハンドラ
   */
  async function handleEditQuestion(event) {
    event.preventDefault();
    if (!els.editForm) return;
    if (!state.admin.selectedId) {
      els.editStatus.textContent = '一覧から編集対象を選択してください。';
      els.editStatus.classList.add('status-error');
      return;
    }
    els.editStatus.textContent = '送信中...';
    els.editStatus.classList.remove('status-success', 'status-error');

    const payload = buildPayload(new FormData(els.editForm));

    if (!validatePayload(payload)) {
      els.editStatus.textContent = '必須項目が未入力です。';
      els.editStatus.classList.add('status-error');
      return;
    }

    try {
      const targetId = state.admin.selectedId || payload.id;
      await App.api.put(`/api/questions/${encodeURIComponent(targetId)}`, payload);
      els.editStatus.textContent = '保存しました。';
      els.editStatus.classList.add('status-success');
      state.admin.selectedId = payload.id;
      loadQuestions();
    } catch (err) {
      els.editStatus.textContent = err.message;
      els.editStatus.classList.add('status-error');
    }
  }

  /**
   * 問題削除ハンドラ
   */
  async function handleDeleteQuestion(id) {
    if (!id) return;
    const ok = window.confirm(`ID: ${id} を削除しますか？`);
    if (!ok) return;
    setListStatus('削除しています...');

    try {
      await App.api.delete(`/api/questions/${encodeURIComponent(id)}`);
      setListStatus('削除しました。');
      if (state.admin.selectedId === id) {
        resetEditForm();
      }
      loadQuestions();
    } catch (err) {
      console.error(err);
      setListStatus(err.message || '削除に失敗しました。', true);
    }
  }

  // 公開API
  App.admin = {
    loadQuestions,
    resetEditForm,
    handleCreateQuestion,
    handleEditQuestion,
  };
})(App);
