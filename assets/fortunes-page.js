(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = window.FortunesAPI;
  const dialog = $('fortuneDialog');
  let selectedSign = null;
  let returnFocus = null;
  let current = null;
  let requestId = 0;
  let pending = null;
  let refreshTimer = null;
  let failure = null;

  const animalImage = new Image();
  animalImage.onload = () => {
    document.documentElement.classList.add('has-zodiac-art');
    for (const name of document.querySelectorAll('.zodiac-name')) name.hidden = false;
  };
  animalImage.src = '/assets/zodiac-animals.webp?v=20261103-1';

  function fresh() { return current && performance.now() < current.expires_at; }

  function clearResults() {
    $('fortuneList').replaceChildren();
    $('fortuneList').hidden = true;
    $('fortuneDate').textContent = '';
    $('fortuneDate').hidden = true;
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
    if (!dialog.open || !selectedSign) return;
    clearResults();
    $('fortuneContent').setAttribute('aria-busy','false');
    if (!fresh()) {
      const setup = failure && ['FORTUNE_NOT_CONFIGURED','FORTUNE_SETUP_REQUIRED'].includes(failure.code);
      state(failure ? failure.message : '오늘의 운세를 불러오고 있습니다.',Boolean(failure && !setup),Boolean(failure));
      return;
    }
    const [year,month,day] = current.date.split('-').map(Number);
    $('fortuneDate').textContent = `${year}년 ${month}월 ${day}일`;
    $('fortuneDate').hidden = false;
    const items = current.items.filter(item => item.zodiac === selectedSign);
    if (items.length !== 5) {
      state('오늘의 운세를 준비 중입니다.',false,true);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      const label = document.createElement('dt');
      label.textContent = `${item.birth_year}년생`;
      const text = document.createElement('dd');
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
  }

  async function load(force = false) {
    if (document.hidden) return;
    if (pending && !force) return pending;
    const id = ++requestId;
    current = null;
    failure = null;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (dialog.open) showLoading();
    const operation = Promise.resolve().then(async () => {
      try {
        if (!api?.isConfigured()) {
          const error = new Error('오늘의 운세를 준비 중입니다.');
          error.code = 'FORTUNE_NOT_CONFIGURED';
          throw error;
        }
        const result = await api.today();
        if (id !== requestId || document.hidden) return;
        current = result;
        const remaining = current.expires_at-performance.now();
        if (remaining <= 0) {
          invalidate();
          return load();
        }
        refreshTimer = setTimeout(() => {
          invalidate();
          load();
        },remaining);
      } catch (error) {
        if (id !== requestId || document.hidden) return;
        failure = error && typeof error.message === 'string' ? error : new Error('오늘의 운세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        if (failure.code === 'FORTUNE_STALE_RESPONSE') {
          refreshTimer = setTimeout(() => load(),1000);
        } else if (dialog.open && !['FORTUNE_NOT_CONFIGURED','FORTUNE_SETUP_REQUIRED'].includes(failure.code)) {
          refreshTimer = setTimeout(() => load(),30000);
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

  for (const button of document.querySelectorAll('.zodiac-button')) {
    button.addEventListener('click',event => {
      // Keep real link navigation for new tabs, modifier clicks and browsers
      // without dialog support. A normal click retains the existing popup.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
          event.ctrlKey || event.shiftKey || event.altKey ||
          typeof dialog.showModal !== 'function') return;
      event.preventDefault();
      selectedSign = button.dataset.zodiac;
      returnFocus = button;
      $('fortuneDialogTitle').textContent = selectedSign+'띠 오늘의 운세';
      showLoading();
      dialog.showModal();
      document.body.classList.add('has-fortune-dialog');
      $('fortuneDialogTitle').focus({preventScroll:true});
      if (fresh()) render();
      else if (!pending) load();
    });
  }
  $('closeFortuneDialog').addEventListener('click',() => dialog.close());
  dialog.addEventListener('click',event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close',() => {
    selectedSign = null;
    document.body.classList.remove('has-fortune-dialog');
    clearResults();
    returnFocus?.focus({preventScroll:true});
  });
  $('retryFortunes').addEventListener('click',() => load(true));
  document.addEventListener('visibilitychange',() => {
    invalidate();
    if (!document.hidden) load();
  });
  window.addEventListener('pagehide',invalidate);
  window.addEventListener('pageshow',event => {
    if (event.persisted) {
      invalidate();
      load();
    }
  });
  window.addEventListener('focus',() => {
    if (!document.hidden) {
      invalidate();
      load();
    }
  });
  load();
})();
