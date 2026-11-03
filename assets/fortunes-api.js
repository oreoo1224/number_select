(function () {
  'use strict';

  const signs = Object.freeze(['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지']);
  const messages = {
    FORTUNE_NOT_CONFIGURED:'오늘의 운세를 준비 중입니다.',
    FORTUNE_SETUP_REQUIRED:'오늘의 운세를 준비 중입니다.',
    FORTUNE_UNAVAILABLE:'오늘의 운세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    FORTUNE_INVALID_INPUT:'띠를 다시 선택해 주세요.',
    FORTUNE_INVALID_RESPONSE:'오늘의 운세 자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    FORTUNE_STALE_RESPONSE:'날짜가 바뀌어 오늘의 운세를 다시 확인하고 있습니다.',
  };

  function fail(code) {
    const error = new Error(messages[code]);
    error.code = code;
    return error;
  }

  function connection() {
    const config = window.REVIEWS_CONFIG || {};
    const key = typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
    if (!config.supabaseUrl || !key || key.startsWith('sb_secret_')) return null;
    let url;
    try { url = new URL(config.supabaseUrl); } catch (_) { return null; }
    const loopback = ['localhost','127.0.0.1'];
    const local = loopback.includes(location.hostname) && loopback.includes(url.hostname);
    if ((!local && (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname))) ||
        (local && !['http:','https:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) return null;
    if (key.startsWith('eyJ')) {
      try {
        const encoded = key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        if (JSON.parse(atob(encoded)).role !== 'anon') return null;
      } catch (_) { return null; }
    } else if (!key.startsWith('sb_publishable_')) return null;
    return {url:url.origin,key};
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    return Date.parse(value);
  }

  function normalize(value, requestedSign, elapsed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('FORTUNE_INVALID_RESPONSE');
    const date = value.date;
    const serverTime = timestamp(value.server_time);
    const nextUpdate = timestamp(value.next_update_at);
    const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date+'T00:00:00Z') : null;
    if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date ||
        !Number.isFinite(serverTime) || !Number.isFinite(nextUpdate) ||
        new Date(serverTime+9*60*60*1000).toISOString().slice(0,10) !== date ||
        nextUpdate !== Date.parse(date+'T00:00:00+09:00')+24*60*60*1000 ||
        !Array.isArray(value.items)) throw fail('FORTUNE_INVALID_RESPONSE');
    const selectedSigns = requestedSign === null ? signs : [requestedSign];
    const expectedCount = selectedSigns.length*5;
    if (value.items.length !== 0 && value.items.length !== expectedCount) throw fail('FORTUNE_INVALID_RESPONSE');
    const seen = new Set();
    const items = value.items.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw fail('FORTUNE_INVALID_RESPONSE');
      const {zodiac,birth_year:year,fortune_text:text} = item;
      const signIndex = signs.indexOf(zodiac);
      if (!selectedSigns.includes(zodiac) || !Number.isInteger(year) || year < 1948 || year > 2007 ||
          signs[(year-4)%12] !== zodiac || signIndex < 0 || seen.has(year) ||
          typeof text !== 'string' || !text.trim() || text !== text.trim() || [...text].length > 300 || /[\u0000-\u001f\u007f]/.test(text)) throw fail('FORTUNE_INVALID_RESPONSE');
      seen.add(year);
      return {zodiac,birth_year:year,fortune_text:text};
    });
    const remaining = nextUpdate-serverTime-Math.max(0,elapsed)-50;
    if (remaining <= 0) throw fail('FORTUNE_STALE_RESPONSE');
    items.sort((a,b) => signs.indexOf(a.zodiac)-signs.indexOf(b.zodiac) || a.birth_year-b.birth_year);
    return {date,server_time:value.server_time,next_update_at:value.next_update_at,items,expires_at:performance.now()+remaining};
  }

  async function read(sign, retry = true) {
    const config = connection();
    if (!config) throw fail('FORTUNE_NOT_CONFIGURED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),12000);
    const started = performance.now();
    try {
      const response = await fetch(config.url+'/rest/v1/rpc/fortunes_today',{
        method:'POST',
        headers:{apikey:config.key,'Content-Type':'application/json',Accept:'application/json'},
        credentials:'omit',cache:'no-store',signal:controller.signal,
        body:JSON.stringify({p_zodiac:sign}),
      });
      if (!response.ok) throw fail(response.status === 404 ? 'FORTUNE_SETUP_REQUIRED' : 'FORTUNE_UNAVAILABLE');
      let result;
      try { result = await response.json(); } catch (_) { throw fail('FORTUNE_INVALID_RESPONSE'); }
      try { return normalize(result,sign,performance.now()-started); }
      catch (error) {
        if (retry && error.code === 'FORTUNE_STALE_RESPONSE') return await read(sign,false);
        throw error;
      }
    } catch (error) {
      if (error && Object.hasOwn(messages,error.code)) throw error;
      throw fail('FORTUNE_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }

  window.FortunesAPI = Object.freeze({
    isConfigured:() => Boolean(connection()),
    today(sign = null) {
      if (sign !== null && !signs.includes(sign)) return Promise.reject(fail('FORTUNE_INVALID_INPUT'));
      return read(sign);
    },
  });
}());
