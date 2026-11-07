(() => {
  'use strict';

  const key = 'luckzip-display-mode';
  const root = document.documentElement;
  const viewport = document.querySelector('meta[name="viewport"]');
  const mobileViewport = viewport?.getAttribute('content') || 'width=device-width, initial-scale=1';
  const originalMedia = new WeakMap();
  let desktop = false;
  let storageUsable = true;

  function savedMode() {
    if (!storageUsable) return desktop;
    try { return localStorage.getItem(key) === 'desktop'; }
    catch (_) { storageUsable = false; return desktop; }
  }

  function renderControls() {
    for (const button of document.querySelectorAll('[data-display-mode-toggle]')) {
      button.textContent = desktop ? '모바일 버전' : 'PC 버전';
      button.setAttribute('aria-label',desktop ? '모바일 버전으로 전환' : 'PC 버전으로 전환');
    }
    // Use the same desktop artwork even if an in-app browser keeps reporting
    // its narrow CSS viewport after the explicit desktop preference is set.
    for (const source of document.querySelectorAll('.fortune-entry picture source')) {
      if (!originalMedia.has(source)) originalMedia.set(source,source.getAttribute('media'));
      const media = desktop ? 'all' : originalMedia.get(source);
      if (media === null) source.removeAttribute('media');
      else source.setAttribute('media',media);
    }
  }

  function apply(value, persist = false) {
    desktop = Boolean(value);
    if (persist) {
      try {
        if (desktop) localStorage.setItem(key,'desktop');
        else localStorage.removeItem(key);
        storageUsable = true;
      } catch (_) { storageUsable = false; }
    }
    root.classList.toggle('view-desktop',desktop);
    if (viewport) viewport.setAttribute('content',desktop ? 'width=1100, viewport-fit=cover' : mobileViewport);
    renderControls();
  }

  // Run synchronously in the head so a saved preference is used for the first
  // layout, without changing the URL, browser history or any entered numbers.
  apply(savedMode());
  document.addEventListener('click',event => {
    const button = event.target.closest?.('[data-display-mode-toggle]');
    if (!button) return;
    event.preventDefault();
    apply(!desktop,true);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',renderControls,{once:true});
  else renderControls();
  window.addEventListener('pageshow',() => apply(savedMode()));
  window.addEventListener('storage',event => {
    if (event.key === key || event.key === null) apply(savedMode());
  });
  window.LuckzipDisplayMode = Object.freeze({
    get mode() { return desktop ? 'desktop' : 'mobile'; },
    setMode(value) { apply(value === 'desktop',true); },
  });
})();
