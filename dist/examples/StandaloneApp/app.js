import {createApplication} from '../../core/web-runtime.js';

const host = document.querySelector('#application');
const status = document.querySelector('#runtime-status');
const output = document.querySelector('#model-output');
const activity = document.querySelector('#activity-output');
const disposeButton = document.querySelector('#dispose-app');
const remountButton = document.querySelector('#remount-app');

const initialData = {
  Project: {Title: 'Website relaunch', Owner: 'Alex Morgan'},
  Tasks: [
    {Id: 'research', Title: 'Gather customer insights', Done: true},
    {Id: 'design', Title: 'Review the new visual direction', Done: true},
    {Id: 'prototype', Title: 'Share the interactive prototype', Done: false},
    {Id: 'launch', Title: 'Prepare the launch announcement', Done: false}
  ],
  NewTask: '', Progress: 50, ProgressLabel: '50%',
  TaskSummary: '2 of 4 complete', Status: 'In progress',
  Message: 'Changes stay in this browser session.',
  Accent: '#4D63E8', Quiet: false
};

let app;
let source;
let savedData = structuredClone(initialData);
let unsubscribe;
let nextTask = 1;
let activePlayer;

function themeFor(accent) {
  const softAccent = accent === '#4D63E8' ? '#EEF1F8' : '#EAF5F0';
  return `<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="SoftAccent" Color="${softAccent}" /></ResourceDictionary>`;
}

function log(message) {
  const row = document.createElement('li');
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString([], {hour12: false});
  const text = document.createElement('span');
  text.textContent = message;
  row.append(time, text);
  activity.prepend(row);
  while (activity.children.length > 40) activity.lastElementChild.remove();
}

function showState(state, message) {
  status.dataset.state = state;
  status.textContent = message;
  host.setAttribute('aria-busy', 'false');
  disposeButton.disabled = state !== 'running';
}

function refreshSummary() {
  if (!app) return;
  app.state.batch(data => {
    const complete = data.Tasks.filter(task => task.Done).length;
    data.Progress = data.Tasks.length ? Math.round(complete / data.Tasks.length * 100) : 0;
    data.ProgressLabel = data.Progress + '%';
    data.TaskSummary = `${complete} of ${data.Tasks.length} complete`;
    data.Status = data.Tasks.length && complete === data.Tasks.length ? 'Ready to ship' : 'In progress';
  });
  output.textContent = JSON.stringify(app.data, null, 2);
}

/** A control toolkit can supply its own DOM renderer and property metadata. */
const launchboardToolkit = {
  name: 'Launchboard controls',
  setup(application) {
    return application.registry.registerControl({
      type: 'launch:StatusBadge', category: 'Launchboard',
      properties: [{name: 'Label', type: 'string'}],
      render({properties}) {
        const badge = document.createElement('span');
        badge.className = 'launch-status';
        badge.textContent = properties.Label || 'In progress';
        badge.setAttribute('role', 'status');
        return badge;
      }
    });
  }
};

function mount() {
  dispose(false);
  app = createApplication({
    source,
    data: savedData,
    resources: {Accent: savedData.Accent},
    theme: themeFor(savedData.Accent),
    plugins: [launchboardToolkit],
    commands: {
      AddTask: {
        canExecute: () => !!app?.data.NewTask.trim(),
        execute() {
          const title = app.data.NewTask.trim();
          if (!title) return;
          app.state.batch(data => {
            data.Tasks.push({Id: `task-${nextTask++}`, Title: title, Done: false});
            data.NewTask = '';
            data.Message = `Added “${title}” to the checklist.`;
          });
          log(`AddTask · ${title}`);
        }
      },
      RemoveTask(id) {
        const task = app.data.Tasks.find(item => item.Id === id);
        if (!task) return;
        app.state.batch(data => {
          data.Tasks = data.Tasks.filter(item => item.Id !== id);
          data.Message = `Removed “${task.Title}” from the checklist.`;
        });
        log(`RemoveTask · ${task.Title}`);
      },
      SwitchTheme() {
        const accent = app.data.Accent === '#4D63E8' ? '#178572' : '#4D63E8';
        app.data.Accent = accent;
        app.setResource('Accent', accent);
        app.setTheme(themeFor(accent));
        log(`Shared Accent resource and theme → ${accent}`);
      },
      Celebrate() {
        activePlayer?.dispose();
        activePlayer = app.playStoryboard('Celebrate');
        log('Storyboard · Celebrate');
      },
      ToggleState() {
        app.data.Quiet = !app.data.Quiet;
        const state = app.data.Quiet ? 'Quiet' : 'Normal';
        app.goToState('CardStates', state, {transitions: true});
        log(`Visual state · ${state}`);
      }
    }
  });
  app.addEventListener('rendered', () => {
    for (const name of ['TaskList']) {
      const control = app.findName(name);
      if (control) control.dataset.runtimeName = name;
    }
  });
  app.mount(host);
  app.setResource('Accent', app.data.Accent);
  unsubscribe = app.state.subscribe(({paths}) => {
    if (paths.some(path => path === 'Tasks' || path.startsWith('Tasks.'))) refreshSummary();
    output.textContent = JSON.stringify(app.data, null, 2);
    const authored = paths.filter(path => !['Progress', 'ProgressLabel', 'TaskSummary', 'Status'].includes(path));
    if (authored.length) log('Data changed · ' + authored.join(', '));
  });
  refreshSummary();
  // Expose the host for the example's integration tests and browser exploration.
  window.launchboard = {get application() { return app; }, mount, dispose, get source() { return source; }};
  showState('running', 'Runtime connected');
  log('Mounted MainView.xaml · standalone runtime');
}

function dispose(showMessage = true) {
  if (app) {
    savedData = app.state.snapshot();
    unsubscribe?.();
    unsubscribe = undefined;
    activePlayer?.dispose();
    activePlayer = undefined;
    app.dispose();
    app = undefined;
  }
  if (showMessage) {
    const message = document.createElement('p');
    message.className = 'disposed-message';
    message.textContent = 'Application disposed. Remount to resume your session.';
    host.replaceChildren(message);
    showState('disposed', 'Runtime disposed');
    log('Disposed application · subscriptions and clocks released');
  }
}

function showError(error) {
  showState('error', 'Runtime error');
  const message = document.createElement('p');
  message.className = 'disposed-message';
  message.textContent = error.message;
  host.replaceChildren(message);
  log('Error · ' + error.message);
  console.error(error);
}

disposeButton.addEventListener('click', () => dispose());
remountButton.addEventListener('click', () => {try {mount();} catch (error) {showError(error);}});
window.addEventListener('pagehide', () => dispose(false));

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const candidate of tabs) {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    document.getElementById(candidate.getAttribute('aria-controls')).hidden = !selected;
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next]);
    tabs[next].focus();
  });
}

try {
  const response = await fetch(new URL('./MainView.xaml', import.meta.url));
  if (!response.ok) throw new Error(`Unable to load MainView.xaml: HTTP ${response.status}.`);
  source = await response.text();
  document.querySelector('#source-output').textContent = source;
  mount();
} catch (error) { showError(error); }
