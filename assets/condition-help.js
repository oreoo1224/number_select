(() => {
  'use strict';

  const buttons = [...document.querySelectorAll('.condition-help-button')];
  const guides = [...document.querySelectorAll('.conditions-list > li')];
  const extra = document.getElementById('additionalConditions');
  const step = document.getElementById('step1');
  if (!buttons.length || !extra || !step) return;

  const byBit = new Map(buttons.map(button => [button.dataset.conditionHelp,button]));
  const guideFor = new Map(buttons.map((button,index) => [button,guides[index]]));
  const tooltip = document.createElement('div');
  tooltip.id = 'conditionHelpTooltip';
  tooltip.className = 'condition-help-tooltip';
  tooltip.setAttribute('role','tooltip');
  tooltip.hidden = true;
  const heading = document.createElement('strong');
  const description = document.createElement('p');
  const example = document.createElement('p');
  example.className = 'condition-help-example';
  const source = document.createElement('p');
  source.className = 'condition-help-source';
  tooltip.append(heading,description,example,source);
  document.body.appendChild(tooltip);

  let activeButton = null;
  let pinned = false;
  let closeTimer = null;
  let frame = null;
  let pointerFocusButton = null;
  let changing = false;

  function historyLayer() {
    return activeButton && pinned ? `ruleHelp-${activeButton.dataset.conditionHelp}` : null;
  }

  function notifyChange(previous) {
    if (!changing && previous !== historyLayer()) {
      document.dispatchEvent(new CustomEvent('conditionhelpchange'));
    }
  }

  function clearCloseTimer() {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function close() {
    const previous = historyLayer();
    clearCloseTimer();
    if (activeButton) {
      activeButton.setAttribute('aria-expanded','false');
      activeButton.removeAttribute('aria-describedby');
    }
    activeButton = null;
    pinned = false;
    tooltip.hidden = true;
    tooltip.classList.remove('is-pinned');
    notifyChange(previous);
  }

  function viewport() {
    const visual = window.visualViewport;
    return visual ? {left:visual.offsetLeft,top:visual.offsetTop,width:visual.width,height:visual.height} :
      {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
  }

  function position() {
    frame = null;
    if (!activeButton || tooltip.hidden) return;
    const rect = activeButton.getBoundingClientRect();
    const view = viewport();
    const margin = 12, gap = 8;
    const leftEdge = view.left + margin, topEdge = view.top + margin;
    const rightEdge = view.left + view.width - margin, bottomEdge = view.top + view.height - margin;
    if (!activeButton.getClientRects().length || rect.bottom < topEdge || rect.top > bottomEdge ||
        rect.right < leftEdge || rect.left > rightEdge || !extra.open || !step.classList.contains('active')) {
      close();
      return;
    }
    tooltip.style.width = `${Math.max(80,Math.min(310,view.width-margin*2))}px`;
    tooltip.style.maxHeight = `${Math.max(40,view.height-margin*2)}px`;
    const height = tooltip.getBoundingClientRect().height;
    const below = bottomEdge - rect.bottom - gap, above = rect.top - topEdge - gap;
    let top;
    if (below >= height) top = rect.bottom + gap;
    else if (above >= height) top = rect.top - gap - height;
    else {
      const space = Math.max(below,above);
      tooltip.style.maxHeight = `${Math.max(40,space)}px`;
      const boundedHeight = tooltip.getBoundingClientRect().height;
      top = below >= above ? rect.bottom + gap : rect.top - gap - boundedHeight;
    }
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(leftEdge,Math.min(rect.right-bounds.width,rightEdge-bounds.width))}px`;
    tooltip.style.top = `${Math.max(topEdge,Math.min(top,bottomEdge-bounds.height))}px`;
  }

  function schedulePosition() {
    if (activeButton && frame === null) frame = requestAnimationFrame(position);
  }

  function fill(button) {
    const guide = guideFor.get(button);
    if (!guide) return false;
    heading.textContent = guide.querySelector('h3')?.textContent || '';
    const text = guide.querySelector('p:not(.condition-example)')?.textContent || '';
    description.textContent = button.dataset.conditionHelp === '4' ?
      (text.match(/[^.!?]+[.!?]?/g) || [text]).slice(0,2).join(' ').trim() : text;
    example.textContent = guide.querySelector('.condition-example')?.textContent || '';
    example.hidden = !example.textContent;
    source.textContent = button.dataset.conditionHelp === '4' ?
      document.getElementById('overlapAvailability')?.textContent || '' : '';
    source.hidden = !source.textContent;
    return true;
  }

  function open(bit,{pinned:pin = true,ensureVisible = false} = {}) {
    const button = byBit.get(String(bit));
    if (!button || !extra.open || !step.classList.contains('active') || !fill(button)) return;
    const previous = historyLayer();
    clearCloseTimer();
    if (activeButton && activeButton !== button) {
      activeButton.setAttribute('aria-expanded','false');
      activeButton.removeAttribute('aria-describedby');
    }
    activeButton = button;
    pinned = Boolean(pin);
    button.setAttribute('aria-expanded','true');
    button.setAttribute('aria-describedby',tooltip.id);
    tooltip.hidden = false;
    tooltip.classList.toggle('is-pinned',pinned);
    if (ensureVisible) {
      const rect = button.getBoundingClientRect(), view = viewport();
      if (rect.top < view.top+12 || rect.bottom > view.top+view.height-12 ||
          rect.left < view.left+12 || rect.right > view.left+view.width-12) {
        try { button.scrollIntoView({behavior:'instant',block:'nearest',inline:'nearest'}); }
        catch (_) { button.scrollIntoView({block:'nearest',inline:'nearest'}); }
      }
    }
    changing = true;
    try { position(); }
    finally { changing = false; }
    notifyChange(previous);
  }

  function scheduleClose() {
    clearCloseTimer();
    if (pinned || activeButton?.matches(':focus-visible')) return;
    closeTimer = setTimeout(close,160);
  }

  for (const button of buttons) {
    button.setAttribute('aria-controls',tooltip.id);
    button.addEventListener('pointerdown',() => { pointerFocusButton = button; });
    button.addEventListener('pointerenter',event => {
      if (event.pointerType !== 'mouse' || (pinned && activeButton !== button)) return;
      open(button.dataset.conditionHelp,{pinned});
    });
    button.addEventListener('pointerleave',scheduleClose);
    button.addEventListener('focus',() => {
      if (pointerFocusButton !== button) open(button.dataset.conditionHelp,{pinned});
    });
    button.addEventListener('blur',event => {
      if (activeButton !== button || event.relatedTarget?.closest?.('.condition-help-button')) return;
      close();
    });
    button.addEventListener('click',event => {
      event.stopPropagation();
      pointerFocusButton = null;
      if (activeButton === button && pinned) close();
      else open(button.dataset.conditionHelp,{pinned:true});
    });
  }
  document.addEventListener('pointerup',() => { pointerFocusButton = null; });
  document.addEventListener('pointercancel',() => { pointerFocusButton = null; });
  tooltip.addEventListener('pointerenter',clearCloseTimer);
  tooltip.addEventListener('pointerleave',scheduleClose);
  document.addEventListener('pointerdown',event => {
    if (!activeButton || tooltip.contains(event.target) || event.target.closest?.('.condition-help-button')) return;
    close();
  },true);
  document.addEventListener('keydown',event => {
    if (!activeButton || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  },true);
  extra.addEventListener('toggle',() => { if (!extra.open) close(); });
  new MutationObserver(() => { if (!step.classList.contains('active')) close(); })
    .observe(step,{attributes:true,attributeFilter:['class']});
  document.addEventListener('scroll',schedulePosition,true);
  window.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('resize',schedulePosition);
  window.visualViewport?.addEventListener('scroll',schedulePosition);
  const availability = document.getElementById('overlapAvailability');
  if (availability) new MutationObserver(() => {
    if (activeButton?.dataset.conditionHelp === '4') { fill(activeButton); schedulePosition(); }
  }).observe(availability,{childList:true,characterData:true,subtree:true});

  window.ConditionHelp = Object.freeze({
    open,close,
    get historyLayer() { return historyLayer(); },
  });
})();
