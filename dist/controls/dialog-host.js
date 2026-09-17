/** Controlled modal presentation; independent of Studio and document semantics. */
const owners = new WeakMap();
const documents = new WeakMap();
const focusSelector = 'button,input,select,textarea,a[href],[tabindex]';
function documentState(document) {
  if (!documents.has(document)) documents.set(document, { stack: [], inert: new Map() });
  return documents.get(document);
}
function updateModality(document) {
  const state = documentState(document);
  for (const [node, value] of state.inert) {
    if (value === null) node.removeAttribute('inert');
    else node.setAttribute('inert', value);
  }
  state.inert.clear();
  const top = state.stack.at(-1);
  state.stack.forEach((item, index) => {
    item.dialog.setAttribute('aria-modal', String(item === top));
    item.overlay.style.zIndex = `calc(var(--dialog-z-index, 10000) + ${index})`;
  });
  if (!top) return;
  for (let node = top.overlay; node && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement?.children || []) {
      if (sibling === node) continue;
      state.inert.set(sibling, sibling.getAttribute('inert'));
      sibling.setAttribute('inert', '');
    }
  }
}
function visibleFocusTarget(node, dialog) {
  if (
    !node ||
    node.nodeType !== 1 ||
    !dialog.contains(node) ||
    node.matches(':disabled') ||
    node.closest('[hidden],[inert]')
  )
    return false;
  const view = dialog.ownerDocument.defaultView;
  for (
    let parent = node;
    parent && parent !== dialog.parentElement;
    parent = parent.parentElement
  ) {
    const style = view.getComputedStyle(parent);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
  }
  return true;
}
function focusable(dialog) {
  return [...dialog.querySelectorAll(focusSelector)].filter(
    (node) => node.tabIndex >= 0 && visibleFocusTarget(node, dialog),
  );
}

export class DialogHost {
  constructor(host) {
    if (!host?.ownerDocument || typeof host.replaceChildren !== 'function')
      throw new TypeError('DialogHost requires a DOM host.');
    if (owners.has(host)) throw new Error('Dispose the existing DialogHost before replacing it.');
    this.host = host;
    this.document = host.ownerDocument;
    this.current = null;
    this.disposed = false;
    this.hadClass = host.classList.contains('xamora-dialog-host');
    host.classList.add('xamora-dialog-host');
    owners.set(host, this);
  }
  get isOpen() {
    return !!this.current;
  }
  get element() {
    return this.current?.dialog ?? null;
  }
  get body() {
    return this.current?.body ?? null;
  }
  open({
    title = '',
    content = '',
    html,
    actions = [],
    wide = false,
    cancelLabel = 'Cancel',
    closeLabel = 'Close dialog',
    dismissOnEscape = true,
    dismissOnOverlay = true,
    initialFocus,
    returnFocus,
  } = {}) {
    if (this.disposed) throw new Error('DialogHost is disposed.');
    if (!this.document.body.contains(this.host))
      throw new Error('Attach the dialog host to the document body before opening.');
    if (
      !Array.isArray(actions) ||
      actions.some((action) => !action || typeof action.run !== 'function')
    )
      throw new TypeError('Dialog actions require a run callback.');
    if (html !== undefined && (typeof html !== 'string' || content !== ''))
      throw new TypeError('Use either content or explicit trusted HTML.');
    if (
      typeof content !== 'string' &&
      (!content ||
        content.nodeType !== 1 ||
        content.ownerDocument !== this.document ||
        content.contains(this.host))
    )
      throw new TypeError(
        'Content must be text or an element from the host document, not a host ancestor.',
      );
    if (initialFocus !== undefined && typeof initialFocus !== 'function')
      throw new TypeError('initialFocus must be a function.');
    if (returnFocus !== undefined && typeof returnFocus !== 'function')
      throw new TypeError('returnFocus must be a function.');
    actions = actions.map((action) => ({ ...action }));
    const previousFocus = this.current?.previousFocus || this.document.activeElement;
    this.close(false);
    // Abort listeners may synchronously dispose this host or open a newer dialog.
    // Never resurrect a disposed owner or leave an untracked second overlay.
    if (this.disposed || this.current)
      throw new Error('Dialog replacement was superseded during cancellation.');
    const create = (tag, className, text) => {
      const node = this.document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    const overlay = create('div', 'modal-overlay');
    const dialog = create('section', 'modal' + (wide ? ' wide' : ''));
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', String(title));
    dialog.tabIndex = -1;
    const header = create('div', 'modal-header');
    const close = create('button', 'icon-button', '×');
    close.type = 'button';
    close.dataset.dialogClose = '';
    close.setAttribute('aria-label', String(closeLabel));
    header.append(create('h2', '', title), close);
    const body = create('div', 'modal-body');
    const error = create('span', 'modal-error');
    error.setAttribute('role', 'alert');
    const footer = create('div', 'modal-footer');
    footer.append(error);
    const state = {
      overlay,
      dialog,
      body,
      error,
      previousFocus,
      listeners: [],
      buttons: [],
      controller: new AbortController(),
      busy: false,
      timer: null,
      initialFocus,
      returnFocus,
      actions,
      actionButtons: [],
    };
    if (typeof content !== 'string') {
      state.content = content;
      state.parent = content.parentNode;
      state.next = content.nextSibling;
      body.append(content);
    } else if (html !== undefined)
      body.innerHTML = html; // Explicit application-owned trusted markup only.
    else body.textContent = content;
    if (actions.length && cancelLabel !== false) {
      const cancel = create('button', 'button', cancelLabel);
      cancel.type = 'button';
      cancel.dataset.dialogCancel = '';
      cancel.onclick = () => this.current === state && this.close();
      state.buttons.push(cancel);
      footer.append(cancel);
    }
    const actionButtons = actions.map((action, index) => {
      const button = create(
        'button',
        'button' + (action.primary ? ' primary' : ''),
        action.label ?? 'Action',
      );
      button.type = 'button';
      button.dataset.modalAction = String(index);
      button.disabled = !!action.disabled;
      button.onclick = async () => {
        if (this.current !== state || state.busy || action.disabled) return;
        state.busy = true;
        error.textContent = '';
        dialog.setAttribute('aria-busy', 'true');
        actionButtons.forEach((node) => {
          node.disabled = true;
        });
        try {
          const result = await action.run({
            host: this,
            dialog,
            body,
            signal: state.controller.signal,
          });
          if (this.current === state && action.closeOnSuccess && result !== false) this.close();
        } catch (failure) {
          if (this.current === state) error.textContent = String(failure?.message ?? failure);
        } finally {
          if (this.current === state) {
            state.busy = false;
            dialog.removeAttribute('aria-busy');
            actionButtons.forEach((node, i) => {
              node.disabled = !!actions[i].disabled;
            });
          }
        }
      };
      footer.append(button);
      state.buttons.push(button);
      return button;
    });
    state.actionButtons = actionButtons;
    close.onclick = () => this.current === state && this.close();
    state.buttons.push(close);
    dialog.append(header, body, footer);
    overlay.append(dialog);
    this.host.append(overlay);
    this.current = state;
    documentState(this.document).stack.push(state);
    updateModality(this.document);
    const top = () => documentState(this.document).stack.at(-1) === state;
    const listen = (node, event, fn, capture = false) => {
      node.addEventListener(event, fn, capture);
      state.listeners.push(() => node.removeEventListener(event, fn, capture));
    };
    listen(overlay, 'pointerdown', (event) => {
      if (top() && event.target === overlay && dismissOnOverlay) this.close();
    });
    listen(
      this.document,
      'keydown',
      (event) => {
        if (!top()) return;
        if (event.key === 'Escape' && dismissOnEscape && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        } else if (event.key === 'Tab') {
          const nodes = focusable(dialog);
          const index = nodes.indexOf(this.document.activeElement);
          if (
            !nodes.length ||
            index < 0 ||
            (!event.shiftKey && index === nodes.length - 1) ||
            (event.shiftKey && index === 0)
          ) {
            event.preventDefault();
            (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
            if (!nodes.length) dialog.focus();
          }
        }
      },
      true,
    );
    listen(this.document, 'focusin', (event) => {
      if (top() && !dialog.contains(event.target)) this.focus();
    });
    state.timer = setTimeout(() => {
      if (this.current === state && top()) this.focus();
    }, 0);
    return dialog;
  }
  focus() {
    const state = this.current;
    if (!state || documentState(this.document).stack.at(-1) !== state) return;
    let preferred;
    try {
      preferred = state.initialFocus?.(state.dialog);
    } catch (error) {
      this.showError(error?.message ?? error);
    }
    if (this.current !== state || documentState(this.document).stack.at(-1) !== state) return;
    const nodes = focusable(state.dialog);
    const preferredIsVisible =
      visibleFocusTarget(preferred, state.dialog) &&
      (preferred.tabIndex >= 0 || preferred.hasAttribute('tabindex'));
    const target = preferredIsVisible
      ? preferred
      : nodes.find((node) => state.body.contains(node)) || nodes[0] || state.dialog;
    target.focus();
  }
  setActionDisabled(index, disabled) {
    const state = this.current;
    if (!state) return false;
    if (!Number.isInteger(index) || index < 0 || index >= state.actions.length)
      throw new RangeError('Dialog action index is out of range.');
    state.actions[index].disabled = !!disabled;
    state.actionButtons[index].disabled = state.busy || !!disabled;
    return true;
  }
  showError(message) {
    if (this.current) this.current.error.textContent = String(message ?? '');
  }
  close(restoreFocus = true) {
    const state = this.current;
    if (!state) return false;
    this.current = null;
    clearTimeout(state.timer);
    state.listeners.forEach((dispose) => dispose());
    state.buttons.forEach((button) => {
      button.onclick = null;
    });
    state.controller.abort();
    if (state.content && state.body.contains(state.content)) {
      if (state.parent)
        state.parent.insertBefore(
          state.content,
          state.next?.parentNode === state.parent ? state.next : null,
        );
      else state.content.remove();
    }
    state.overlay.remove();
    const stack = documentState(this.document).stack;
    const wasTop = stack.at(-1) === state;
    stack.splice(stack.indexOf(state), 1);
    updateModality(this.document);
    if (restoreFocus && wasTop && state.returnFocus) state.returnFocus();
    else if (restoreFocus && wasTop) {
      const target = state.previousFocus;
      if (target?.isConnected && !target.closest('[inert],[hidden]')) target.focus();
      else stack.at(-1)?.dialog.focus();
    }
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    if (!this.hadClass) this.host.classList.remove('xamora-dialog-host');
    owners.delete(this.host);
  }
}
