(function () {
  'use strict';
  const list = document.getElementById('reviewsPreviewList');
  const status = document.getElementById('reviewsPreviewStatus');
  const write = document.getElementById('reviewsPreviewWrite');
  const retry = document.getElementById('reviewsPreviewRetry');
  if (!list || !status) return;
  const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });

  async function load() {
    list.replaceChildren();
    if (!window.ReviewsAPI || !window.ReviewsAPI.isConfigured()) {
      status.textContent = '후기 게시판을 준비하고 있습니다.';
      status.hidden = false;
      write.hidden = true;
      retry.hidden = true;
      return;
    }
    status.textContent = '최근 후기를 불러오는 중입니다.';
    status.hidden = false;
    retry.hidden = true;
    try {
      const data = await window.ReviewsAPI.list({ limit: 5, offset: 0 });
      for (const post of data.items) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/reviews.html?post=${encodeURIComponent(post.id)}`;
        link.className = 'reviews-preview-post';
        const excerpt = document.createElement('span');
        excerpt.className = 'reviews-preview-title';
        const content = Array.from(post.excerpt.replace(/\s+/g, ' ').trim());
        excerpt.textContent = content.slice(0, 75).join('') + (content.length > 75 ? '…' : '');
        const meta = document.createElement('span');
        meta.className = 'reviews-preview-meta';
        const nickname = document.createElement('span');
        nickname.textContent = post.nickname;
        const time = document.createElement('time');
        const created = new Date(post.created_at);
        if (Number.isFinite(created.getTime())) {
          time.dateTime = post.created_at;
          time.textContent = dateFormat.format(created);
        }
        meta.append(nickname, time);
        link.append(excerpt, meta);
        item.append(link);
        list.append(item);
      }
      status.textContent = data.items.length ? '' : '아직 등록된 후기가 없습니다.';
      status.hidden = data.items.length > 0;
      write.hidden = false;
    } catch (_) {
      status.textContent = '후기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      status.hidden = false;
      retry.hidden = false;
      write.hidden = true;
    }
  }
  retry.addEventListener('click', load);
  load();
}());
