/** Real browser application checks: no designer UI or application globals required. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, dirname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
let playwright;
try { playwright = await import('playwright'); }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs')).href);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>Standalone runtime tests</title><main id="host"></main>'); return; }
    const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.writeHead(200, {'Content-Type': 'text/javascript'}).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright.chromium.launch({headless: true, args: ['--disable-dev-shm-usage']});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const report = await page.evaluate(async () => {
    const {createApplication} = await import('/core/web-runtime.js');
    const check = (value, message) => { if (!value) throw new Error(message); };
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    const host = document.querySelector('#host');
    let loads = 0, unloads = 0, mounts = 0, cleanups = 0, saves = 0;
    const source = `<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:demo="urn:demo" Width="400">
      <StackPanel.Resources><Storyboard x:Key="Fade"><DoubleAnimation Storyboard.TargetName="Heading" Storyboard.TargetProperty="Opacity" From="1" To="0" Duration="0:0:1"/></Storyboard></StackPanel.Resources>
      <TextBlock x:Name="Heading" Text="{Binding title}" Foreground="{DynamicResource Accent}" Loaded="OnLoaded" Unloaded="OnUnloaded"/>
      <TextBox x:Name="Name" Text="{Binding person.name, UpdateSourceTrigger=PropertyChanged}"/>
      <TextBlock x:Name="Greeting" Text="{Binding person.name, Converter={StaticResource Upper}}"/>
      <CheckBox x:Name="Enabled" Content="Enable save" IsChecked="{Binding enabled}"/>
      <Button x:Name="Save" Content="Save" Command="Save" CommandParameter="{Binding person.name}"/>
      <StackPanel DataContext="{Binding person}"><TextBox x:Name="Nested" Text="{Binding name}"/></StackPanel>
      <ItemsControl x:Name="Rows" ItemsSource="{Binding rows}"><ItemsControl.ItemTemplate><DataTemplate><TextBlock Text="{Binding title}"/></DataTemplate></ItemsControl.ItemTemplate></ItemsControl>
      <demo:Badge x:Name="Badge" Text="{Binding person.name}"/>
    </StackPanel>`;
    const app = createApplication({source, data: {title: 'Runtime app', person: {name: 'Ada'}, enabled: true, rows: [{title: 'First'}]}, resources: {Accent: '#123456'}, converters: {Upper: value => value.toUpperCase()}, events: {OnLoaded: () => loads++, OnUnloaded: () => unloads++}, commands: {Save: {execute(parameter, {data}) { saves++; data.title = 'Saved ' + parameter; }, canExecute(parameter, {data}) { return data.enabled; }}}, plugins: [{setup(application) {
      return application.registry.registerControl({type: 'demo:Badge', category: 'Demo', render({properties}) { const span = document.createElement('span'); span.textContent = properties.Text; return span; }, mount({element, data}) { mounts++; element.dataset.mounted = data.person?.name || ''; return () => cleanups++; }});
    }}]});
    app.mount(host);
    check(!host.querySelector('.studio'), 'No designer chrome is mounted');
    check(app.findName('Heading').textContent === 'Runtime app', 'Initial one-way binding');
    check(app.findName('Heading').style.color === 'rgb(18, 52, 86)', 'Application resource used');
    check(app.findName('Greeting').textContent === 'ADA', 'Registered converter');
    check(app.findName('Badge').textContent === 'Ada' && mounts === 1, 'Custom control render and mount');
    check(loads === 1, 'Loaded once on initial mount');
    app.data.person.name = 'Grace'; app.data.rows.push({title: 'Second'}); await flush();
    check(app.findName('Name').value === 'Grace', 'Observable state updates input');
    check(app.findName('Rows').textContent.includes('Second'), 'Observable collection re-renders template');
    check(loads === 1 && mounts === 2 && cleanups === 1, 'Lifecycle preserves Loaded on data refresh and disposes old DOM');
    const input = app.findName('Name'); input.focus(); input.value = 'Linus'; input.setSelectionRange(2, 2); input.dispatchEvent(new Event('input', {bubbles: true})); await flush();
    check(app.data.person.name === 'Linus', 'TwoWay updates state');
    check(app.findName('Greeting').textContent === 'LINUS', 'TwoWay updates sibling converter binding');
    check(document.activeElement === app.findName('Name') && app.findName('Name').selectionStart === 2, 'Focus and caret retained after binding render');
    const nested = app.findName('Nested'); nested.value = 'Nested edit'; nested.dispatchEvent(new Event('change', {bubbles: true})); await flush();
    check(app.data.person.name === 'Nested edit', 'Inherited DataContext supports TwoWay');
    app.findName('Save').click(); await flush();
    check(saves === 1 && app.data.title === 'Saved Nested edit', 'Registered command and parameter');
    const enabled = app.findName('Enabled').querySelector('input'); enabled.checked = false; enabled.dispatchEvent(new Event('change', {bubbles: true})); await flush();
    check(app.data.enabled === false && app.findName('Save').disabled, 'canExecute updates command target disabled');
    app.findName('Save').click(); check(saves === 1, 'Disabled command does not execute');
    app.setResource('Accent', '#ff0000'); await flush();
    check(app.findName('Heading').style.color === 'rgb(255, 0, 0)', 'Dynamic resource change applied');
    app.setValue('Heading', 'FontSize', '24'); await flush();
    check(app.findName('Heading').style.fontSize === '24px', 'Typed property override rendered');
    app.clearValue('Heading', 'FontSize'); await flush();
    check(app.findName('Heading').style.fontSize === '', 'ClearValue restores authored property');
    const player = app.playStoryboard('Fade', {autoplay: false}); player.seek(.5);
    check(Number(app.findName('Heading').style.opacity) === .5, 'Shared storyboard sampling applied to DOM');
    player.dispose();
    check(app.findName('Heading').style.opacity !== '0.5', 'Disposing last player restores baseline');
    const valid = app.document, visual = app.findName('Heading');
    check(!app.updateSource('<StackPanel>').valid && app.document === valid && app.findName('Heading') === visual, 'Invalid source keeps last valid document and DOM');
    app.registry.registerControl({type: 'Broken', category: 'Test', render() { throw new Error('Renderer failed'); }});
    check(!app.updateSource('<Broken/>').valid && app.document === valid && app.findName('Heading') === visual, 'Renderer failure keeps last valid AST and DOM');
    await flush();
    app.unmount(); check(unloads === 1, 'Unloaded on unmount');
    app.mount(host); check(loads === 2, 'Loaded fires on remount');
    app.dispose();
    check(unloads === 2 && cleanups === mounts && host.children.length === 0, 'Dispose releases controls, DOM and lifecycle');
    const count = mounts; app.data.person.name = 'After disposal'; await flush();
    check(mounts === count, 'Disposed state subscriptions do not render');
    let clicked = 0;
    const metadataApp = createApplication({source: `<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:demo="urn:demo" FontSize="22" Foreground="red">
      <StackPanel.Resources><SolidColorBrush x:Key="Accent" Color="green"/></StackPanel.Resources>
      <TextBlock x:Name="Forward" Text="{Binding Text, ElementName=Later}" Opacity="{Binding opacity}"/>
      <TextBlock x:Name="Later" Text="{Binding title}"/>
      <TextBlock x:Name="Local" Text="Local" Foreground="{StaticResource Accent}"/>
      <Button x:Name="OnlyEvent" Content="Event" Click="Clicked"/>
      <demo:Counter x:Name="DefaultCounter"/>
      <demo:Counter x:Name="BoundCounter" Level="{Binding level}"/>
    </StackPanel>`, data: {title: 'Forward works', opacity: '0', level: '8'}, resources: {Accent: 'blue'}, events: {Clicked: () => clicked++}, plugins: [application => {
      application.propertyRegistry.register('demo:Counter', 'Level', {type: 'number', defaultValue: 3});
      return application.registry.registerControl({type: 'demo:Counter', category: 'Tests', render({properties}) { const output = document.createElement('output'); output.value = typeof properties.Level + ':' + properties.Level; return output; }});
    }]});
    metadataApp.mount(host);
    check(metadataApp.findName('Forward').textContent === 'Forward works', 'Forward ElementName resolves target binding');
    check(metadataApp.findName('Forward').style.opacity === '0', 'Typed zero opacity remains visible in effective CSS');
    check(metadataApp.getValue('Later', 'FontSize') === 22 && metadataApp.findName('Later').style.fontSize === '22px', 'Inherited metadata reaches renderer and getValue');
    check(metadataApp.findName('DefaultCounter').value === 'number:3' && metadataApp.findName('BoundCounter').value === 'number:8', 'Namespaced property metadata coerces defaults and bindings');
    check(metadataApp.findName('Local').style.color === 'green', 'Local resource takes precedence over application dictionary');
    metadataApp.findName('OnlyEvent').click(); check(clicked === 1, 'Event-only registered handler executes');
    metadataApp.data.title = 'Updated forward'; await flush();
    check(metadataApp.findName('Forward').textContent === 'Updated forward', 'Forward reference remains live');
    check(!metadataApp.diagnostics.some(value => value.severity === 'error'), 'Valid metadata application has no errors');
    metadataApp.dispose();
    return {liveBindings: true, twoWay: true, nestedDataContext: true, collectionTemplates: true, commands: true, converters: true, resources: true, typedProperties: true, customControls: true, lifecycle: true, animations: true, invalidSourceRetention: true, renderFailureRetention: true, focusRetention: true, forwardElementName: true, metadataDefaultsAndInheritance: true, eventOnlyHandler: true, scopedResources: true};
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
  console.log('Standalone XAML runtime browser checks passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
