(function () {
  'use strict';

  const messages = {
    DRAW_NOT_CONFIGURED: '등록된 당첨번호를 불러올 준비가 되지 않았습니다.',
    DRAW_SETUP_REQUIRED: '관리자 당첨번호 등록을 준비하고 있습니다.',
    DRAW_UNAVAILABLE: '등록된 당첨번호를 불러오지 못했습니다.',
    DRAW_INVALID_INPUT: '올바른 회차를 입력해 주세요.',
    DRAW_INVALID_RESPONSE: '등록된 당첨번호 형식을 확인할 수 없습니다.',
  };

  function fail(code) {
    const error = new Error(messages[code]);
    error.code = code;
    return error;
  }

  function connection() {
    // The existing project settings contain only a browser-safe public key.
    const config = window.REVIEWS_CONFIG || {};
    const key = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
    if (!config.supabaseUrl || !key || key.startsWith('sb_secret_')) return null;
    let url;
    try { url = new URL(config.supabaseUrl); } catch (_) { return null; }
    const loopback = ['localhost', '127.0.0.1'];
    const local = loopback.includes(location.hostname) && loopback.includes(url.hostname);
    if ((!local && (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname))) ||
        (local && !['http:', 'https:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    if (key.startsWith('eyJ')) {
      try {
        const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (JSON.parse(atob(encoded)).role !== 'anon') return null;
      } catch (_) { return null; }
    } else if (!key.startsWith('sb_publishable_')) return null;
    return { url: url.origin, key };
  }

  function koreanDate() {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = name => parts.find(part => part.type === name).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  function normalize(value, requestedRound) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('DRAW_INVALID_RESPONSE');
    const { draw_no: round, draw_date: date, winning_numbers: numbers, bonus_number: bonus, updated_at: updatedAt } = value;
    const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!Number.isInteger(round) || round < 1 || round > 2147483647 ||
        (requestedRound !== null && round !== requestedRound) ||
        !parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date > koreanDate() ||
        !Array.isArray(numbers) || numbers.length !== 6 || numbers.some((number, index) => !Number.isInteger(number) || number < 1 || number > 45 || (index > 0 && number <= numbers[index - 1])) ||
        !Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus) ||
        typeof updatedAt !== 'string' || !Number.isFinite(new Date(updatedAt).getTime())) throw fail('DRAW_INVALID_RESPONSE');
    return { draw_no: round, draw_date: date, winning_numbers: [...numbers], bonus_number: bonus, updated_at: updatedAt };
  }

  async function read(round) {
    const config = connection();
    if (!config) throw fail('DRAW_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/draw_result_get`, {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ p_draw_no: round }),
      });
      if (!response.ok) throw fail(response.status === 404 ? 'DRAW_SETUP_REQUIRED' : 'DRAW_UNAVAILABLE');
      let result;
      try { result = await response.json(); } catch (_) { throw fail('DRAW_INVALID_RESPONSE'); }
      return normalize(result, round);
    } catch (error) {
      if (error && Object.hasOwn(messages, error.code)) throw error;
      throw fail('DRAW_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  window.DrawsAPI = Object.freeze({
    isConfigured: () => Boolean(connection()),
    latest: () => read(null),
    get(round) {
      const requested = Number(round);
      if (!Number.isInteger(requested) || requested < 1 || requested > 2147483647) return Promise.reject(fail('DRAW_INVALID_INPUT'));
      return read(requested);
    },
  });
}());
