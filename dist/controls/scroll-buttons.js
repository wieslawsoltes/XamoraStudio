/** A scrollable strip with explicit navigation, preserving touchpad and keyboard use. */
export class ScrollButtons {
  constructor(viewport, { label = 'tabs' } = {}) {
    this.viewport = viewport;
    this.host = document.createElement('div');
    this.host.className = 'scroll-button-strip';
    this.previous = this.button('‹', 'Scroll ' + label + ' left', -1);
    this.next = this.button('›', 'Scroll ' + label + ' right', 1);
    viewport.classList.add('scroll-button-viewport');
    this.host.append(this.previous, viewport, this.next);
    this.update = () => {
      this.previous.disabled = viewport.scrollLeft <= 1;
      this.next.disabled = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
    };
    viewport.addEventListener('scroll', this.update);
    this.observer = new ResizeObserver(this.update);
    this.observer.observe(viewport);
    if (typeof MutationObserver === 'function') {
      this.mutations = new MutationObserver(this.update);
      this.mutations.observe(viewport, { childList: true, subtree: true, characterData: true });
    }
    requestAnimationFrame(this.update);
  }
  button(text, label, direction) {
    const b = document.createElement('button');
    b.className = 'strip-scroll-button';
    b.textContent = text;
    b.type = 'button';
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
    this.viewport.removeEventListener('scroll', this.update);
    this.observer.disconnect();
    this.mutations?.disconnect();
  }
}
