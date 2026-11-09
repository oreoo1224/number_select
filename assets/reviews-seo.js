(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const requestedPost = params.get('post');
  const postId = uuidPattern.test(requestedPost || '') ? requestedPost.toLowerCase() : null;
  const pageNumber = Math.max(1,Math.min(100000,Number.parseInt(params.get('page') || '1',10) || 1));
  const writing = params.get('write') === '1';
  const routeBlocked = writing || params.get('edit') === '1' || (params.has('post') && !postId);
  const canonical = new URL('https://luckzip.com/reviews.html');
  if (!writing && postId) canonical.searchParams.set('post',postId);
  else if (!writing && !params.has('post') && pageNumber > 1) canonical.searchParams.set('page',String(pageNumber));

  function meta(name,content,property = false) {
    const attribute = property ? 'property' : 'name';
    let element = document.querySelector(`meta[${attribute}="${name}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute,name);
      document.head.appendChild(element);
    }
    element.setAttribute('content',content);
  }

  function robots(blocked) {
    meta('robots',blocked ? 'noindex,follow' : 'index,follow');
  }

  function allow() {
    robots(routeBlocked);
  }

  function update(title,description) {
    document.title = title;
    meta('description',description);
    meta('og:title',title,true);
    meta('og:description',description,true);
    meta('og:url',canonical.href,true);
  }

  const compact = value => String(value || '').replace(/\s+/g,' ').trim();
  const shorten = (value,length) => Array.from(value).slice(0,length).join('');
  let canonicalLink = document.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    canonicalLink = document.createElement('link');
    canonicalLink.setAttribute('rel','canonical');
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.setAttribute('href',canonical.href);
  allow();
  const pageLabel = !params.has('post') && !writing && pageNumber > 1 ? ` ${pageNumber}페이지` : '';
  update(`후기 게시판${pageLabel} | 행운설계소`,
    document.querySelector('meta[name="description"]')?.getAttribute('content') || '행운설계소 이용 후기와 의견을 나누는 게시판입니다.');

  window.ReviewsSEO = Object.freeze({
    setPost(post) {
      if (!postId || String(post?.id || '').toLowerCase() !== postId) return;
      const content = compact(post.content || post.excerpt);
      const nickname = compact(post.nickname);
      const title = `${shorten(content,50) || '후기 내용'} | 후기 게시판 - 행운설계소`;
      const description = shorten(`${nickname ? nickname+'님의 후기: ' : ''}${content}`,150);
      update(title,description || '행운설계소 이용 후기입니다.');
      allow();
    },
    allow,
    exclude() { robots(true); },
  });
})();
