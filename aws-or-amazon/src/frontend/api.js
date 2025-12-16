/**
 * api.js - 共通API通信ユーティリティ
 */
(function (App) {
  'use strict';

  /**
   * 共通リクエスト処理
   * @param {string} url - APIエンドポイント
   * @param {RequestInit} options - fetch オプション
   * @returns {Promise<any>} レスポンスデータ
   * @throws {Error} リクエスト失敗時
   */
  async function request(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body?.error?.message || 'リクエストに失敗しました。';
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  App.api = {
    request,

    /**
     * GET リクエスト
     */
    get(url) {
      return request(url);
    },

    /**
     * POST リクエスト
     */
    post(url, data) {
      return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    /**
     * PUT リクエスト
     */
    put(url, data) {
      return request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    /**
     * DELETE リクエスト
     */
    delete(url) {
      return request(url, { method: 'DELETE' });
    },
  };
})(App);

