import {
  WorkspaceDensity,
  DENSITY_MODES,
  DENSITY_KEY,
  validDensity,
} from '../controls/workspace-density.js';
export class DensityWorkspace extends WorkspaceDensity {
  constructor(studio) {
    super();
    this.studio = studio;
    studio.density = this;
    this.onChange = () => {
      if (this.select) this.select.value = this.value;
      // No source, document or dock-tree render: live inputs and selections survive.
      studio.docking?.control.cancelGesture?.();
      studio.direct?.cancelGesture?.();
      studio.docking?.resize();
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        studio.timeline?.applyZoom();
        studio.features?.prototype.drawConnections();
      });
    };
    this.addEventListener('change', this.onChange);
    this.syncStorage = (e) => {
      if (e.key === DENSITY_KEY || e.key === null)
        this.set(validDensity(e.newValue) ? e.newValue : 'compact', { persist: false });
    };
    window.addEventListener('storage', this.syncStorage);
    window.xamora.appearance = {
      getDensity: () => this.value,
      setDensity: (value) => this.set(value),
      densityModes: DENSITY_MODES,
    };
  }
  mount(host) {
    const label = document.createElement('label');
    label.className = 'density-picker';
    label.title = 'Interface density';
    const text = document.createElement('span');
    text.textContent = 'Density';
    const select = (this.select = document.createElement('select'));
    select.setAttribute('aria-label', 'Interface density');
    for (const mode of DENSITY_MODES) {
      const option = document.createElement('option');
      option.value = mode.id;
      option.textContent = mode.label;
      option.title = mode.description;
      select.append(option);
    }
    select.addEventListener('pointerdown', () => this.studio.menus?.bar.close(false));
    select.value = this.value;
    select.onchange = () => this.set(select.value);
    label.append(text, select);
    host.append(label);
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('storage', this.syncStorage);
    this.removeEventListener('change', this.onChange);
    this.select?.parentElement.remove();
  }
}
