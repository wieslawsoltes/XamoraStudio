/** Keyboard accessible nested application menus. Entries have label, run, enabled, checked or children. */
export class MenuBar {
  constructor(host, menus, { onError = (error) => console.error(error) } = {}) {
    const document = host.ownerDocument || globalThis.document;
    this.document = document;
    this.window = document.defaultView || globalThis.window;
    this.host = host;
    this.menus = menus;
    this.onError = onError;
    this.stack = [];
    host.classList.add('ide-menubar');
    host.setAttribute('role', 'menubar');
    this.buttons = menus.map((menu, index) => {
      const b = document.createElement('button');
      b.textContent = menu.label;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.tabIndex = index ? -1 : 0;
      b.onpointerdown = () => {
        if (!this.stack.length) this.pendingFocus = document.activeElement;
      };
      b.onclick = () => {
        if (this.stack.length && this.rootIndex === index) this.close();
        else this.openRoot(index);
      };
      b.onpointerenter = () => {
        if (this.stack.length) this.openRoot(index, false);
      };
      host.append(b);
      return b;
    });
    this.key = (e) => this.keydown(e);
    this.outside = (e) => {
      if (!host.contains(e.target) && !this.stack.some((level) => level.el.contains(e.target)))
        this.close(false);
    };
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('pointerdown', this.outside);
  }
  value(v, fallback) {
    return typeof v === 'function' ? v() : (v ?? fallback);
  }
  openRoot(index, focus = true) {
    const document = this.document;
    const had = this.stack.length;
    this.close(false);
    if (!had) this.previous = this.pendingFocus || document.activeElement;
    this.pendingFocus = null;
    this.rootIndex = (index + this.menus.length) % this.menus.length;
    const button = this.buttons[this.rootIndex];
    this.buttons.forEach((b) => {
      b.tabIndex = b === button ? 0 : -1;
    });
    button.setAttribute('aria-expanded', 'true');
    this.open(this.menus[this.rootIndex], button.getBoundingClientRect(), 0, focus);
  }
  open(parent, anchor, depth, focus = true) {
    const document = this.document,
      window = this.window;
    while (this.stack.length > depth) this.removeLevel();
    const el = document.createElement('div');
    el.className = 'ide-menu-popup';
    el.setAttribute('role', 'menu');
    const entries = this.value(parent.children, []),
      items = [];
    for (const entry of entries) {
      if (entry.separator) {
        const hr = document.createElement('hr');
        hr.setAttribute('role', 'separator');
        el.append(hr);
        continue;
      }
      const b = document.createElement('button');
      b.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (entry.checked !== undefined)
        b.setAttribute('aria-checked', String(!!this.value(entry.checked, false)));
      b.disabled = !this.value(entry.enabled, true);
      for (const [tag, cls] of [
        ['span', 'menu-check'],
        ['span', 'menu-label'],
        ['kbd', ''],
        ['span', 'menu-arrow'],
      ]) {
        const part = document.createElement(tag);
        part.className = cls;
        // Checked/expanded state is conveyed by ARIA, not spoken decoration.
        if (cls === 'menu-check' || cls === 'menu-arrow') part.setAttribute('aria-hidden', 'true');
        b.append(part);
      }
      b.children[0].textContent = this.value(entry.checked, false) ? '✓' : '';
      b.children[1].textContent = entry.label;
      b.children[2].textContent = entry.shortcut || '';
      b.children[3].textContent = entry.children ? '›' : '';
      if (entry.children) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.onpointerenter = () => {
          if (!b.disabled) this.open(entry, b.getBoundingClientRect(), depth + 1, false);
        };
        b.onclick = () => this.open(entry, b.getBoundingClientRect(), depth + 1, true);
      } else {
        b.onpointerenter = () => {
          while (this.stack.length > depth + 1) this.removeLevel();
        };
        b.onclick = async (e) => {
          e.stopPropagation();
          if (!this.value(entry.enabled, true)) return;
          this.close();
          try {
            await entry.run?.();
          } catch (error) {
            this.onError(error);
          }
        };
      }
      items.push({ button: b, entry });
      el.append(b);
    }
    document.body.append(el);
    const rect = el.getBoundingClientRect();
    el.style.left =
      Math.max(
        4,
        Math.min(depth ? anchor.right - 3 : anchor.left, window.innerWidth - rect.width - 4),
      ) + 'px';
    el.style.top =
      Math.max(
        4,
        Math.min(
          depth ? anchor.top : anchor.bottom,
          window.innerHeight - Math.min(rect.height, window.innerHeight - 8) - 4,
        ),
      ) + 'px';
    this.stack.push({ el, items, parent, anchor });
    for (const level of this.stack)
      for (const item of level.items)
        if (item.entry.children)
          item.button.setAttribute(
            'aria-expanded',
            String(this.stack.some((child) => child.parent === item.entry)),
          );
    if (focus) items.find((item) => !item.button.disabled)?.button.focus();
  }
  removeLevel() {
    const removed = this.stack.pop();
    removed?.el.remove();
    for (const level of this.stack)
      level.items
        .find((item) => item.entry === removed?.parent)
        ?.button.setAttribute('aria-expanded', 'false');
  }
  close(restore = true) {
    for (const level of this.stack) level.el.remove();
    this.stack = [];
    this.buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (restore) this.previous?.focus?.({ preventScroll: true });
  }
  keydown(e) {
    const document = this.document;
    if (
      e.isComposing ||
      e.target.closest?.(
        '#modal-root,[role=dialog],[role=alertdialog],[data-dock-ignore-shortcuts]',
      )
    )
      return;
    if (e.key === 'F10' && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.buttons[0].focus();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      const index = this.menus.findIndex((m) => m.label[0].toLowerCase() === e.key.toLowerCase());
      if (index >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.openRoot(index);
        return;
      }
    }
    const root = this.buttons.indexOf(document.activeElement);
    if (!this.stack.length && root >= 0) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (['ArrowLeft', 'ArrowRight'].includes(e.key))
          this.buttons[
            (root + (e.key === 'ArrowRight' ? 1 : -1) + this.buttons.length) % this.buttons.length
          ].focus();
        else this.openRoot(root);
      }
      return;
    }
    if (!this.stack.length) return;
    const level =
        this.stack.find((l) => l.el.contains(document.activeElement)) || this.stack.at(-1),
      depth = this.stack.indexOf(level),
      items = level.items.filter((i) => !i.button.disabled),
      at = items.findIndex((i) => i.button === document.activeElement);
    let handled = true;
    if (e.key === 'Escape') {
      if (depth > 0) {
        this.removeLevel();
        const previous = this.stack.at(-1);
        previous.items.find((i) => i.entry === level.parent)?.button.focus();
      } else this.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.button.focus();
    else if (e.key === 'Home') items[0]?.button.focus();
    else if (e.key === 'End') items.at(-1)?.button.focus();
    else if (e.key === 'ArrowRight') {
      const item = items[at];
      if (item?.entry.children)
        this.open(item.entry, item.button.getBoundingClientRect(), depth + 1, true);
      else this.openRoot(this.rootIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      if (depth > 0) {
        while (this.stack.length > depth) this.removeLevel();
        this.stack
          .at(-1)
          .items.find((i) => i.entry === level.parent)
          ?.button.focus();
      } else this.openRoot(this.rootIndex - 1);
    } else if (e.key === 'Enter' || e.key === ' ') items[at]?.button.click();
    else if (e.key === 'Tab') {
      // Resume native navigation from a live menu trigger, not a removed popup item.
      const rootButton = this.buttons[this.rootIndex];
      this.close(false);
      rootButton?.focus();
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const match = items
        .slice(at + 1)
        .concat(items.slice(0, at + 1))
        .find((i) => i.entry.label.toLowerCase().startsWith(e.key.toLowerCase()));
      match?.button.focus();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  dispose() {
    const document = this.document;
    this.close(false);
    document.removeEventListener('keydown', this.key, true);
    document.removeEventListener('pointerdown', this.outside);
    this.host.replaceChildren();
  }
}
