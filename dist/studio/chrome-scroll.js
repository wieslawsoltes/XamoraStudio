/** Application bars scroll natively; arrow controls belong only to docking tab strips. */
export class ChromeScroll {
  constructor(studio) {
    const document = studio.docking?.control.document || globalThis.document;
    this.bars = [];
    for (const selector of ['.topbar', '.ide-menubar', '.toolbar', '.statusbar']) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const parent = node.parentElement,
        next = node.nextSibling,
        wrapper = document.createElement('div'),
        hadViewport = node.classList.contains('scroll-button-viewport');
      wrapper.className = 'chrome-scroll-wrapper scroll-button-strip';
      node.classList.add('scroll-button-viewport');
      wrapper.append(node);
      parent.insertBefore(wrapper, next);
      this.bars.push({ node, wrapper, hadViewport });
    }
  }
  dispose() {
    for (const { node, wrapper, hadViewport } of this.bars) {
      if (node.parentElement === wrapper) wrapper.replaceWith(node);
      if (!hadViewport) node.classList.remove('scroll-button-viewport');
    }
    this.bars = [];
  }
}
