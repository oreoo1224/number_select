(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const api = window.ReviewsAPI;
  const params = new URLSearchParams(window.location.search);
  const pageNumber = Math.max(1, Math.min(100000, Number.parseInt(params.get('page') || '1', 10) || 1));
  const pageSize = 10;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const listURL = pageNumber > 1 ? `/reviews.html?page=${pageNumber}` : '/reviews.html';
  const dateFormat = new Intl.DateTimeFormat('ko-KR', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Seoul'});
  let currentPost = null;
  let formMode = 'create';
  let creationReady = false;
  let saving = false;
  let deleting = false;
  let deleteReturnFocus = null;

  function urlForPost(id, edit = false) {
    const query = new URLSearchParams({post: id});
    if (pageNumber > 1) query.set('page', String(pageNumber));
    if (edit) query.set('edit', '1');
    return `/reviews.html?${query}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
  }

  function messageFor(error, fallback) {
    const messages = {
      NOT_CONFIGURED:'후기 게시판을 준비하고 있습니다.',
      REVIEW_PASSWORD_INCORRECT:'비밀번호가 일치하지 않습니다.',
      REVIEW_NOT_FOUND:'후기를 찾을 수 없습니다. 삭제된 글인지 확인해 주세요.',
      REVIEW_RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    };
    if (messages[error?.code]) return messages[error.code];
    return error?.message && typeof error.message === 'string' ? error.message : fallback;
  }

  function setState(message, isError = false, retry = false) {
    $('boardState').textContent = message;
    $('boardState').hidden = !message;
    $('boardState').classList.toggle('is-error', isError);
    $('retryReviews').hidden = !retry;
  }

  function showView(id) {
    for (const view of ['reviewListView','reviewDetailView','reviewFormView']) $(view).hidden = view !== id;
  }

  function addMeta(parent, nickname, createdAt) {
    const author = document.createElement('span');
    author.textContent = nickname;
    const time = document.createElement('time');
    time.textContent = formatDate(createdAt);
    if (Number.isFinite(new Date(createdAt).getTime())) time.dateTime = new Date(createdAt).toISOString();
    parent.append(author, time);
  }

  async function loadList() {
    setState('후기 목록을 불러오고 있습니다.');
    const result = await api.list({limit:pageSize, offset:(pageNumber - 1) * pageSize});
    const items = Array.isArray(result?.items) ? result.items : [];
    const total = Number.isFinite(Number(result?.total)) ? Math.max(0, Number(result.total)) : items.length;
    $('reviewList').replaceChildren();
    $('reviewPagination').replaceChildren();
    $('reviewCount').textContent = `총 ${total.toLocaleString('ko-KR')}개의 후기`;
    for (const post of items) {
      if (!post || !uuidPattern.test(String(post.id))) continue;
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'review-row';
      link.href = urlForPost(String(post.id));
      const excerpt = document.createElement('p');
      excerpt.className = 'review-row-excerpt';
      excerpt.textContent = post.excerpt || post.content || '';
      const meta = document.createElement('div');
      meta.className = 'review-row-meta';
      addMeta(meta, post.nickname, post.created_at);
      link.append(excerpt, meta);
      item.appendChild(link);
      $('reviewList').appendChild(item);
    }
    showView('reviewListView');
    if (!items.length) {
      setState(total ? '이 페이지에는 후기가 없습니다. 앞 페이지에서 확인해 주세요.' : '아직 등록된 후기가 없습니다. 첫 후기를 남겨 주세요.');
    } else {
      setState('');
    }
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (pageCount > 1 || pageNumber > 1) {
      const previous = document.createElement(pageNumber > 1 ? 'a' : 'span');
      previous.textContent = '← 이전';
      if (pageNumber > 1) previous.href = `/reviews.html?page=${pageNumber - 1}`;
      else previous.className = 'pagination-disabled';
      const indicator = document.createElement('span');
      indicator.textContent = `${pageNumber} / ${pageCount}`;
      indicator.setAttribute('aria-current','page');
      const next = document.createElement(pageNumber < pageCount ? 'a' : 'span');
      next.textContent = '다음 →';
      if (pageNumber < pageCount) next.href = `/reviews.html?page=${pageNumber + 1}`;
      else next.className = 'pagination-disabled';
      $('reviewPagination').append(previous, indicator, next);
    }
  }

  function displayPost(post) {
    currentPost = post;
    $('postNickname').textContent = post.nickname;
    $('postCreatedAt').textContent = formatDate(post.created_at);
    if (Number.isFinite(new Date(post.created_at).getTime())) $('postCreatedAt').dateTime = new Date(post.created_at).toISOString();
    const changed = new Date(post.updated_at).getTime() > new Date(post.created_at).getTime() + 1000;
    $('postUpdatedAt').textContent = changed ? `수정 ${formatDate(post.updated_at)}` : '';
    $('postContent').textContent = post.content;
    $('detailBack').href = listURL;
    $('editReview').href = urlForPost(String(post.id), true);
    showView('reviewDetailView');
    setState('');
  }

  function displayForm(post = null) {
    currentPost = post;
    formMode = post ? 'edit' : 'create';
    creationReady = false;
    $('reviewFormTitle').textContent = post ? '후기 수정' : '후기 쓰기';
    $('reviewPasswordLabel').textContent = '작성 비밀번호';
    $('reviewPasswordLimit').textContent = post ? '기존 비밀번호' : '숫자 4자리';
    $('reviewPassword').autocomplete = post ? 'current-password' : 'new-password';
    $('reviewPassword').minLength = 4;
    $('reviewPassword').maxLength = post ? 128 : 4;
    $('reviewPassword').inputMode = post ? 'text' : 'numeric';
    if (post) $('reviewPassword').removeAttribute('pattern');
    else $('reviewPassword').pattern = '[0-9]{4}';
    $('reviewPassword').placeholder = post ? '이 글의 작성 비밀번호' : '숫자 4자리';
    $('reviewPasswordHelp').textContent = post ? '이전에 긴 비밀번호로 작성한 글은 기존 비밀번호를 그대로 입력해 주세요.' : '';
    $('reviewPasswordHelp').hidden = !post;
    $('reviewPassword').setAttribute('aria-describedby',post ? 'reviewFormNote reviewPasswordHelp' : 'reviewFormNote');
    $('reviewFormNote').textContent = post ? '이 글을 수정하려면 작성할 때 설정한 비밀번호가 필요합니다. 비밀번호는 변경되지 않습니다.' : '작성 비밀번호는 이 글을 수정하거나 삭제할 때 필요합니다.';
    $('reviewNickname').value = post?.nickname || '';
    $('reviewContent').value = post?.content || '';
    $('reviewPassword').value = '';
    $('reviewFormError').textContent = '';
    $('submitReview').textContent = post ? '수정 저장' : '후기 등록';
    const back = post ? urlForPost(String(post.id)) : listURL;
    $('formBack').href = back;
    $('formBack').textContent = post ? '← 후기 보기' : '← 후기 목록';
    $('cancelReview').href = back;
    $('writeReview').hidden = true;
    showView('reviewFormView');
    setState('');
  }

  async function prepareNewForm() {
    displayForm();
    $('submitReview').disabled = true;
    $('submitReview').textContent = '작성 설정 확인 중…';
    setState('작성 설정을 확인하고 있습니다.');
    let policy = null;
    try {
      if (typeof api.passwordPolicy === 'function') policy = await api.passwordPolicy();
    } catch (_) { /* A missing policy keeps new writes unavailable. */ }
    creationReady = policy?.passwordDigits === 4;
    $('submitReview').disabled = !creationReady;
    $('submitReview').textContent = '후기 등록';
    if (creationReady) setState('');
    else setState('작성 설정을 업데이트하고 있습니다. 잠시 후 다시 시도해 주세요.',false,true);
  }

  function formData() {
    const nickname = $('reviewNickname').value.trim();
    const content = $('reviewContent').value.trim();
    const password = $('reviewPassword').value;
    for (const [value,max,label] of [[nickname,20,'닉네임'],[content,4000,'내용']]) {
      if (!value || [...value].length > max) throw new Error(`${label}은 1~${max.toLocaleString('ko-KR')}자로 입력해 주세요.`);
    }
    if (formMode === 'create' && !/^[0-9]{4}$/.test(password)) throw new Error('비밀번호는 숫자 4자리로 입력해 주세요.');
    if (formMode === 'edit' && !validExistingPassword(password)) throw new Error('작성할 때 설정한 숫자 4자리 또는 기존 비밀번호를 입력해 주세요.');
    return {nickname,content,password};
  }

  function validExistingPassword(password) {
    return /^[0-9]{4}$/.test(password) || ([...password].length >= 8 && [...password].length <= 128);
  }

  function setFormBusy(busy) {
    saving = busy;
    $('reviewForm').setAttribute('aria-busy',String(busy));
    for (const input of $('reviewForm').querySelectorAll('input,textarea,button')) input.disabled = busy;
    $('submitReview').disabled = busy || (formMode === 'create' && !creationReady);
    $('submitReview').textContent = busy ? '저장 중…' : formMode === 'edit' ? '수정 저장' : '후기 등록';
    $('cancelReview').setAttribute('aria-disabled',String(busy));
  }

  $('reviewForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !api?.isConfigured()) return;
    if (formMode === 'create' && !creationReady) {
      setState('작성 설정을 업데이트하고 있습니다. 잠시 후 다시 시도해 주세요.',false,true);
      return;
    }
    $('reviewFormError').textContent = '';
    let values;
    try { values = formData(); }
    catch (error) { $('reviewFormError').textContent = error.message; return; }
    setFormBusy(true);
    try {
      const post = formMode === 'edit' ? await api.update(currentPost.id, values) : await api.create(values);
      if (!post || !uuidPattern.test(String(post.id))) throw new Error('저장 결과를 확인하지 못했습니다. 후기 목록을 확인해 주세요.');
      $('reviewPassword').value = '';
      window.location.assign(urlForPost(String(post.id)));
    } catch (error) {
      $('reviewFormError').textContent = messageFor(error,'후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      $('reviewPassword').value = '';
      setFormBusy(false);
    }
  });

  for (const id of ['formBack','cancelReview']) $(id).addEventListener('click',event => { if (saving) event.preventDefault(); });
  $('retryReviews').addEventListener('click',() => window.location.reload());

  function setDeleteBusy(busy) {
    deleting = busy;
    $('deleteReviewForm').setAttribute('aria-busy',String(busy));
    for (const id of ['deleteReviewPassword','confirmDeleteReview','cancelDeleteReview','closeDeleteReview']) $(id).disabled = busy;
    $('confirmDeleteReview').textContent = busy ? '삭제 중…' : '삭제하기';
  }

  function closeDelete() { if (!deleting) $('deleteReviewDialog').close(); }
  $('openDeleteReview').addEventListener('click',() => {
    if (!currentPost || !api?.isConfigured()) return;
    deleteReturnFocus = document.activeElement;
    $('deleteReviewPassword').value = '';
    $('deleteReviewError').textContent = '';
    $('deleteReviewDialog').showModal();
  });
  $('closeDeleteReview').addEventListener('click',closeDelete);
  $('cancelDeleteReview').addEventListener('click',closeDelete);
  $('deleteReviewDialog').addEventListener('cancel',event => { if (deleting) event.preventDefault(); });
  $('deleteReviewDialog').addEventListener('close',() => {
    $('deleteReviewPassword').value = '';
    $('deleteReviewError').textContent = '';
    deleteReturnFocus?.focus({preventScroll:true});
  });
  $('deleteReviewDialog').addEventListener('click',event => {
    if (event.target !== $('deleteReviewDialog') || deleting) return;
    const bounds = $('deleteReviewDialog').getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDelete();
  });
  $('deleteReviewForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (deleting || !currentPost || !api?.isConfigured()) return;
    const password = $('deleteReviewPassword').value;
    if (!validExistingPassword(password)) {
      $('deleteReviewError').textContent = '작성할 때 설정한 숫자 4자리 또는 기존 비밀번호를 입력해 주세요.';
      return;
    }
    $('deleteReviewError').textContent = '';
    setDeleteBusy(true);
    try {
      const result = await api.remove(currentPost.id, password);
      if (result?.deleted !== true) throw new Error('삭제 결과를 확인하지 못했습니다. 후기 목록을 확인해 주세요.');
      $('deleteReviewPassword').value = '';
      window.location.assign(listURL);
    } catch (error) {
      $('deleteReviewError').textContent = messageFor(error,'후기를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      $('deleteReviewPassword').value = '';
      setDeleteBusy(false);
    }
  });

  window.addEventListener('pagehide',() => {
    $('reviewPassword').value = '';
    $('deleteReviewPassword').value = '';
  });

  async function init() {
    if (!api?.isConfigured()) {
      setState('후기 게시판을 준비하고 있습니다.');
      $('writeReview').hidden = true;
      showView(null);
      return;
    }
    $('writeReview').hidden = false;
    $('reviewsTitle').setAttribute('aria-busy','true');
    try {
      if (params.get('write') === '1') {
        await prepareNewForm();
      } else if (params.has('post')) {
        const id = params.get('post');
        if (!uuidPattern.test(id)) {
          setState('후기를 찾을 수 없습니다. 주소를 확인해 주세요.',true);
          return;
        }
        setState('후기를 불러오고 있습니다.');
        const post = await api.get(id);
        if (!post || String(post.id).toLowerCase() !== id.toLowerCase()) {
          setState('후기를 찾을 수 없습니다. 삭제된 글인지 확인해 주세요.',true);
          return;
        }
        if (params.get('edit') === '1') displayForm(post);
        else displayPost(post);
      } else {
        await loadList();
      }
    } catch (error) {
      showView(null);
      setState(messageFor(error,'후기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'),true,true);
    } finally {
      $('reviewsTitle').setAttribute('aria-busy','false');
    }
  }

  init();
})();
