(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const detail = $('fortuneDetail');
  if (!detail) return;
  const zodiac = detail.dataset.zodiac;
  const signs = ['쥐','소','호랑이','토끼','용','뱀','말','양','원숭이','닭','개','돼지'];
  const offset = signs.indexOf(zodiac);
  if (offset < 0) return;
  const years = Array.from({length:5},(_,index) => 1948+offset+12*index);
  const api = window.FortunesAPI;
  const setupCodes = ['FORTUNE_NOT_CONFIGURED','FORTUNE_SETUP_REQUIRED'];
  const checkedTime = new Intl.DateTimeFormat('ko-KR',{
    timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  });
  let current = null;
  let failure = null;
  let requestId = 0;
  let pending = null;
  let refreshTimer = null;
  let pageShown = false;

  function fresh() { return current && performance.now() < current.expires_at; }

  function complete() {
    return current && current.items.length === years.length && years.every(year =>
      current.items.some(item => item.zodiac === zodiac && item.birth_year === year));
  }

  function clearResults() {
    $('fortuneList').replaceChildren();
    $('fortuneList').hidden = true;
    $('fortuneTiming').hidden = true;
    for (const id of ['fortuneDate','fortuneServerTime']) {
      $(id).textContent = '';
      $(id).removeAttribute('datetime');
    }
  }

  function state(message, isError = false, retry = false) {
    $('fortuneState').textContent = message;
    $('fortuneState').hidden = !message;
    $('fortuneState').classList.toggle('is-error',isError);
    $('retryFortunes').hidden = !retry;
  }

  function showLoading() {
    clearResults();
    $('fortuneContent').setAttribute('aria-busy','true');
    state('오늘의 운세를 불러오고 있습니다.');
  }

  function render() {
    clearResults();
    $('fortuneContent').setAttribute('aria-busy','false');
    if (!fresh()) {
      const setup = failure && setupCodes.includes(failure.code);
      state(failure ? failure.message : '오늘의 운세를 불러오고 있습니다.',Boolean(failure && !setup),Boolean(failure));
      return;
    }
    if (!complete()) {
      state('오늘의 운세를 준비 중입니다.',false,true);
      return;
    }
    const [year,month,day] = current.date.split('-').map(Number);
    $('fortuneDate').dateTime = current.date;
    $('fortuneDate').textContent = `${year}년 ${month}월 ${day}일`;
    $('fortuneServerTime').dateTime = current.server_time;
    $('fortuneServerTime').textContent = checkedTime.format(new Date(current.server_time))+' (KST)';
    $('fortuneTiming').hidden = false;
    for (const year of years) {
      const item = current.items.find(item => item.birth_year === year);
      const row = document.createElement('div');
      const label = document.createElement('dt');
      const text = document.createElement('dd');
      label.textContent = `${item.birth_year}년생`;
      text.textContent = item.fortune_text;
      row.append(label,text);
      $('fortuneList').appendChild(row);
    }
    $('fortuneList').hidden = false;
    state('');
  }

  function invalidate() {
    current = null;
    failure = null;
    requestId++;
    pending = null;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    clearResults();
    $('fortuneContent').setAttribute('aria-busy','false');
    state('오늘의 운세를 불러오고 있습니다.');
  }

  async function load(force = false) {
    if (document.hidden) return;
    if (pending && !force) return pending;
    const id = ++requestId;
    current = null;
    failure = null;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    showLoading();
    const operation = Promise.resolve().then(async () => {
      try {
        if (!api?.isConfigured()) {
          const error = new Error('오늘의 운세를 준비 중입니다.');
          error.code = 'FORTUNE_NOT_CONFIGURED';
          throw error;
        }
        const result = await api.today(zodiac);
        if (id !== requestId || document.hidden) return;
        current = result;
        const remaining = current.expires_at-performance.now();
        if (remaining <= 0) {
          current = null;
          const error = new Error('날짜가 바뀌어 오늘의 운세를 다시 확인하고 있습니다.');
          error.code = 'FORTUNE_STALE_RESPONSE';
          throw error;
        }
        // Incomplete cohorts stay hidden and are checked again while this page is visible.
        refreshTimer = setTimeout(() => {
          invalidate();
          load();
        },complete() ? remaining : Math.min(remaining,30000));
      } catch (error) {
        if (id !== requestId || document.hidden) return;
        current = null;
        failure = error && typeof error.message === 'string' ? error : new Error('오늘의 운세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        if (!setupCodes.includes(failure.code)) {
          refreshTimer = setTimeout(() => load(),failure.code === 'FORTUNE_STALE_RESPONSE' ? 1000 : 30000);
        }
      } finally {
        if (id === requestId) {
          pending = null;
          render();
        }
      }
    });
    pending = operation;
    return operation;
  }

  function refresh() {
    invalidate();
    if (!document.hidden) load();
  }

  $('retryFortunes').addEventListener('click',() => load(true));
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('pagehide',invalidate);
  window.addEventListener('pageshow',event => {
    // Initial pageshow already has an on-load request; restored pages must refetch.
    if (event.persisted || pageShown) refresh();
    pageShown = true;
  });
  window.addEventListener('focus',refresh);
  load();
})();
