/** A scrollable strip with explicit navigation, preserving touchpad and keyboard use. */
export class ScrollButtons {
  constructor(viewport, { label = 'tabs' } = {}) {
    this.viewport = viewport;
    this.document = viewport.ownerDocument || document;
    this.host = this.document.createElement('div');
    this.host.className = 'scroll-button-strip';
    this.previous = this.button('‹', 'Scroll ' + label + ' left', -1);
    this.next = this.button('›', 'Scroll ' + label + ' right', 1);
    viewport.classList.add('scroll-button-viewport');
    this.host.append(this.previous, viewport, this.next);
    this.update = () => {
      const available =
        viewport.clientWidth +
        (this.previous.hidden ? 0 : this.previous.offsetWidth || 0) +
        (this.next.hidden ? 0 : this.next.offsetWidth || 0);
      const overflow = viewport.clientWidth > 0 && viewport.scrollWidth > available + 1;
      this.previous.hidden = this.next.hidden = !overflow;
      this.previous.disabled = !overflow || viewport.scrollLeft <= 1;
      this.next.disabled =
        !overflow || viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
    };
    viewport.addEventListener('scroll', this.update);
    const view = this.document.defaultView || globalThis;
    this.observer = new (view.ResizeObserver || ResizeObserver)(this.update);
    this.observer.observe(viewport);
    this.observer.observe(this.host);
    if (typeof view.MutationObserver === 'function') {
      this.mutations = new view.MutationObserver(this.update);
      this.mutations.observe(viewport, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      });
    }
    this.frameWindow = view;
    this.frame = view.requestAnimationFrame(this.update);
  }
  button(text, label, direction) {
    const b = this.document.createElement('button');
    b.className = 'strip-scroll-button';
    b.textContent = text;
    b.type = 'button';
    b.hidden = true;
    b.disabled = true;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.onkeydown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        this.viewport.scrollLeft =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? this.viewport.scrollWidth
              : this.viewport.scrollLeft + (e.key === 'ArrowLeft' ? -100 : 100);
        this.update();
      }
      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'Home',
          'End',
          'Delete',
          'Backspace',
          ' ',
          'Enter',
        ].includes(e.key)
      )
        e.stopPropagation();
    };
    b.onclick = (e) => {
      e.stopPropagation();
      this.viewport.scrollLeft += direction * Math.max(60, this.viewport.clientWidth * 0.7);
      this.update();
    };
    return b;
  }
  reveal(element) {
    if (!element) return;
    const a = element.getBoundingClientRect(),
      b = this.viewport.getBoundingClientRect();
    if (a.left < b.left) this.viewport.scrollLeft -= b.left - a.left;
    else if (a.right > b.right) this.viewport.scrollLeft += a.right - b.right;
    this.update();
  }
  dispose() {
    this.frameWindow.cancelAnimationFrame(this.frame);
    this.viewport.removeEventListener('scroll', this.update);
    this.observer.disconnect();
    this.mutations?.disconnect();
  }
}
