/** Progressive disclosure of secondary inspector actions without replacing their live controls. */
export class InspectorDisclosure {
  constructor() {
    this.expanded = new Map();
    this.sections = [
      ['appearance', '.blend-section'],
      ['helpers', '.editing-helpers'],
    ];
  }
  decorate(root) {
    if (!root) return;
    for (const [key, selector] of this.sections) {
      const section = root.querySelector(selector);
      if (!section || section.parentElement?.classList.contains('ux-inspector-disclosure'))
        continue;
      const document = section.ownerDocument,
        heading = section.querySelector('.section-heading');
      if (!heading) continue;
      const details = document.createElement('details');
      details.className = 'ux-inspector-disclosure';
      details.dataset.inspectorSection = key;
      details.open = this.expanded.get(key) || false;
      const summary = document.createElement('summary'),
        title = document.createElement('span'),
        count = document.createElement('small');
      title.textContent = heading.textContent;
      count.textContent = `${section.querySelectorAll('button').length} actions`;
      summary.append(title, count);
      heading.hidden = true;
      section.before(details);
      details.append(summary, section);
      details.ontoggle = () => {
        if (details.isConnected) this.expanded.set(key, details.open);
      };
    }
  }
  restore(root) {
    for (const details of root?.querySelectorAll('.ux-inspector-disclosure') || []) {
      details.ontoggle = null;
      const section = details.querySelector('.panel-section');
      if (section) {
        section.querySelector('.section-heading').hidden = false;
        details.replaceWith(section);
      }
    }
  }
}
