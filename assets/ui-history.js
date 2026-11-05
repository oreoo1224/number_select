(() => {
  'use strict';

  const slot = '__luckzipUI';
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function create({key, root, read, restore, layer = () => '', normalize = value => value}) {
    if (typeof key !== 'string' || !key || typeof read !== 'function' || typeof restore !== 'function') {
      throw new TypeError('A page key, reader and restorer are required.');
    }
    const snapshot = value => {
      const result = copy(normalize(copy(value)));
      if (!object(result)) throw new TypeError('UI history snapshots must be objects.');
      return result;
    };
    const base = snapshot(root);
    const known = new Map([[0, base]]);
    const chainId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let chain = chainId(), depth = 0, current = snapshot(read());
    let applying = false, pending = false, queued = null, destroyed = false, timer = null;

    function entry(state) {
      const value = object(state) && state[slot];
      if (!object(value) || value.key !== key || typeof value.chain !== 'string' ||
          !value.chain || value.chain.length > 100 || !Number.isInteger(value.depth) || value.depth < 0 ||
          value.depth > history.length - 1 || !object(value.value)) return null;
      try { return {...value, value:snapshot(value.value)}; } catch (_) { return null; }
    }
    function write(method) {
      const state = object(history.state) ? {...history.state} : {};
      state[slot] = {key, chain, depth, value:copy(current)};
      history[method](state, '', location.href);
      known.set(depth, copy(current));
    }
    function replace(value) {
      current = snapshot(value);
      write('replaceState');
    }
    function apply(value) {
      current = snapshot(value);
      applying = true;
      try { restore(copy(current)); }
      finally { applying = false; }
      // A reload cannot recreate an expired, transient export or confirmation.
      const actual = snapshot(read());
      if (!equal(actual, current)) replace(actual);
    }
    function finishPending() {
      pending = false;
      clearTimeout(timer);
      timer = null;
    }
    function travel(distance, fallback) {
      pending = true;
      queued = null;
      try { history.go(distance); }
      catch (_) { finishPending(); replace(fallback); return; }
      // Defend against a no-op traversal without repeatedly invoking Back.
      timer = setTimeout(() => {
        if (!pending || destroyed) return;
        const latest = queued;
        finishPending();
        replace(fallback);
        if (latest && !equal(latest, current)) sync(latest);
      },1500);
    }
    function sync(value) {
      if (destroyed || applying) return;
      const next = snapshot(value === undefined ? read() : value);
      if (pending) { queued = next; return; }
      if (equal(next, current)) return;
      const previous = known.get(depth - 1);
      if (depth > 0 && equal(next, base)) {
        travel(-depth, next);
      } else if (depth > 0 && previous && equal(next, previous)) {
        travel(-1, next);
      } else if (depth > 0 && layer(current) && !layer(next)) {
        // Closing an overlay consumes its entry. Closing while advancing a
        // wizard replaces it so Back does not reopen an obsolete confirmation.
        if (!previous || equal(previous, next)) travel(-1, next);
        else replace(next);
      } else {
        for (const index of known.keys()) if (index > depth) known.delete(index);
        current = next;
        depth++;
        write('pushState');
      }
    }
    function onPop(event) {
      if (destroyed) return;
      const latest = queued;
      finishPending();
      queued = null;
      const target = entry(event.state);
      if (!target) {
        // Unmanaged history entries remain ordinary browser navigation.
        chain = chainId(); depth = 0; known.clear(); known.set(0, copy(base));
        applying = true;
        try { current = copy(base); restore(copy(base)); }
        finally { applying = false; }
        return;
      }
      if (chain !== target.chain) {
        known.clear(); known.set(0, copy(base));
      }
      chain = target.chain; depth = target.depth;
      known.set(depth, copy(target.value));
      apply(target.value);
      // A quick close-and-reopen should retain the user's newest action.
      if (latest && !equal(latest, current)) queueMicrotask(() => {
        if (destroyed) return;
        const wanted = snapshot(latest);
        applying = true;
        try { restore(copy(wanted)); }
        finally { applying = false; }
        sync();
      });
    }
    function onShow(event) {
      if (!event.persisted || destroyed) return;
      finishPending(); queued = null;
      const target = entry(history.state);
      if (target) {
        chain = target.chain; depth = target.depth;
        known.set(depth, copy(target.value));
        apply(target.value);
      }
    }
    function onHide() { clearTimeout(timer); timer = null; }

    const saved = entry(history.state);
    if (saved) {
      chain = saved.chain; depth = saved.depth; current = saved.value;
      known.set(depth, copy(current));
      if (!equal(snapshot(read()), current)) apply(current);
      write('replaceState');
    } else if (!equal(current, base)) {
      // A tap before a deferred controller starts still needs a way Back home.
      const initial = current;
      current = copy(base);
      write('replaceState');
      current = initial; depth = 1;
      write('pushState');
    } else {
      write('replaceState');
    }

    const observer = new MutationObserver(() => sync());
    observer.observe(document.body, {subtree:true, attributes:true, attributeFilter:['hidden','open','class']});
    const cancelHandlers = [];
    for (const dialog of document.querySelectorAll('dialog')) {
      const cancel = event => {
        if (event.defaultPrevented || !dialog.open) return;
        event.preventDefault();
        dialog.close();
      };
      dialog.addEventListener('cancel',cancel);
      cancelHandlers.push([dialog,cancel]);
    }
    window.addEventListener('popstate',onPop);
    window.addEventListener('pageshow',onShow);
    window.addEventListener('pagehide',onHide);

    return Object.freeze({
      sync,
      reset(value = base) {
        finishPending(); queued = null;
        replace(value);
      },
      get current() { return copy(current); },
      get depth() { return depth; },
      destroy() {
        destroyed = true; finishPending(); observer.disconnect();
        for (const [dialog,cancel] of cancelHandlers) dialog.removeEventListener('cancel',cancel);
        window.removeEventListener('popstate',onPop);
        window.removeEventListener('pageshow',onShow);
        window.removeEventListener('pagehide',onHide);
      },
    });
  }

  window.LuckzipHistory = Object.freeze({create});
})();
