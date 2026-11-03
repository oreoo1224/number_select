(function () {
  'use strict';

  const fields = document.querySelectorAll('[data-fortune-date]');
  if (!fields.length) return;
  const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  let timer;

  function refresh() {
    clearTimeout(timer);
    const now = new Date();
    const parts = {};
    for (const part of calendar.formatToParts(now)) parts[part.type] = part.value;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const label = `${Number(parts.month)}월 ${Number(parts.day)}일`;
    for (const field of fields) {
      field.textContent = label;
      field.dateTime = date;
    }
    if (!document.hidden) {
      const nextMidnight = Date.parse(`${date}T00:00:00+09:00`) + 86400000;
      timer = setTimeout(refresh, Math.max(100, nextMidnight - now.getTime() + 50));
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  refresh();
}());
