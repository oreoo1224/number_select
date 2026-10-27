(function () {
  'use strict';

  const messages = {
    NOT_CONFIGURED: '후기 게시판을 준비하고 있습니다.',
    REVIEW_PASSWORD_INCORRECT: '비밀번호가 맞지 않습니다.',
    REVIEW_NOT_FOUND: '글을 찾을 수 없습니다.',
    REVIEW_RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    REVIEW_INVALID_INPUT: '입력한 내용을 확인해 주세요.',
    SERVICE_UNAVAILABLE: '후기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };
  const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function fail(code, message) {
    const error = new Error(message || messages[code] || messages.SERVICE_UNAVAILABLE);
    error.code = code;
    return error;
  }

  function connection() {
    const config = window.REVIEWS_CONFIG || {};
    const key = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
    if (!config.supabaseUrl || !key || key.startsWith('sb_secret_')) return null;
    let url;
    try { url = new URL(config.supabaseUrl); } catch (_) { return null; }
    const local = ['localhost', '127.0.0.1'].includes(location.hostname) && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((!local && (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    if (key.startsWith('eyJ')) {
      try {
        const part = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claim = JSON.parse(atob(part));
        if (claim.role !== 'anon') return null;
      } catch (_) { return null; }
    } else if (!key.startsWith('sb_publishable_')) {
      return null;
    }
    return { url: url.origin, key };
  }

  function post(value, full) {
    if (!value || typeof value !== 'object' || !idPattern.test(value.id || '')) throw fail('SERVICE_UNAVAILABLE');
    const result = {};
    for (const field of ['id', 'title', 'nickname', 'created_at', 'updated_at']) result[field] = String(value[field] || '');
    result[full ? 'content' : 'excerpt'] = String(value[full ? 'content' : 'excerpt'] || '');
    return result;
  }

  async function rpc(name, body, mutating) {
    const config = connection();
    if (!config) throw fail('NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      let result;
      try { result = await response.json(); } catch (_) { throw fail('SERVICE_UNAVAILABLE'); }
      if (!response.ok) {
        const code = result && result.message;
        if (response.status === 429) throw fail('REVIEW_RATE_LIMITED');
        throw fail(Object.hasOwn(messages, code) ? code : 'SERVICE_UNAVAILABLE');
      }
      if (result && result.error) {
        const code = typeof result.error === 'object' ? result.error.code : result.error;
        throw fail(Object.hasOwn(messages, code) ? code : 'SERVICE_UNAVAILABLE');
      }
      return result;
    } catch (error) {
      if (error && typeof error.code === 'string' && (Object.hasOwn(messages, error.code) || error.code === 'NETWORK_ERROR')) throw error;
      throw fail('NETWORK_ERROR', mutating ? '처리 결과를 확인하지 못했습니다. 게시판을 확인한 뒤 다시 시도해 주세요.' : messages.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }

  function requireId(id) {
    if (!idPattern.test(String(id || ''))) throw fail('REVIEW_NOT_FOUND');
    return String(id);
  }

  window.ReviewsAPI = Object.freeze({
    isConfigured: () => Boolean(connection()),
    async list({ limit = 10, offset = 0 } = {}) {
      const result = await rpc('reviews_list', { p_limit: Math.max(1, Math.min(20, Math.trunc(Number(limit) || 10))), p_offset: Math.max(0, Math.min(10000, Math.trunc(Number(offset) || 0))) }, false);
      if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0) throw fail('SERVICE_UNAVAILABLE');
      return { items: result.items.map(item => post(item, false)), total: Number(result.total) };
    },
    async get(id) {
      const result = await rpc('review_get', { p_id: requireId(id) }, false);
      return result === null ? null : post(result, true);
    },
    async create({ nickname, title, content, password }) {
      return post(await rpc('review_create', { p_nickname: nickname, p_title: title, p_content: content, p_password: password }, true), true);
    },
    async update(id, { nickname, title, content, password }) {
      return post(await rpc('review_update', { p_id: requireId(id), p_nickname: nickname, p_title: title, p_content: content, p_password: password }, true), true);
    },
    async remove(id, password) {
      const result = await rpc('review_delete', { p_id: requireId(id), p_password: password }, true);
      if (!result || result.deleted !== true) throw fail('SERVICE_UNAVAILABLE');
      return { deleted: true };
    },
  });
}());
