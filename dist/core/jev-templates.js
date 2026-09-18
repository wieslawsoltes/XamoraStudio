/** Deterministic starter generation. Jev chooses a recipe; it does not emit this markup. */
import { escapeXML } from './xaml.js';
export const JEV_RECIPES = Object.freeze({
  blank: 'Empty responsive layout for further authoring',
  login: 'Sign-in form with email, password and submit button',
  contact: 'Contact form with name, email, message and submit button',
  dashboard: 'Dashboard with heading, three metrics and recent activity',
  settings: 'Settings page with profile fields and preferences',
  card: 'A content card with a heading, description and action',
  list: 'A searchable list with a heading and list items',
});
export const JEV_PALETTES = Object.freeze({
  neutral: ['#F5F6F8', '#FFFFFF', '#202633', '#4255CC'],
  dark: ['#161A23', '#222837', '#EEF1FA', '#7FA7FF'],
  blue: ['#EEF5FF', '#FFFFFF', '#192A46', '#2563EB'],
  green: ['#EFF8F2', '#FFFFFF', '#193D2A', '#16834B'],
  violet: ['#F6F1FF', '#FFFFFF', '#302149', '#7952CC'],
});
export function jevTemplate({
  recipe = 'blank',
  framework = 'WPF',
  palette = 'neutral',
  title = '',
} = {}) {
  if (
    !Object.hasOwn(JEV_RECIPES, recipe) ||
    !Object.hasOwn(JEV_PALETTES, palette) ||
    !['HTML', 'WPF', 'Avalonia', 'WinUI'].includes(framework)
  )
    throw Error('Unsupported starter recipe, palette or framework.');
  const [bg, panel, text, accent] = JEV_PALETTES[palette];
  const heading = escapeXML(
    title ||
      {
        login: 'Welcome back',
        contact: 'Get in touch',
        dashboard: 'Overview',
        settings: 'Settings',
        card: 'A new idea',
        list: 'Your collection',
        blank: 'New design',
      }[recipe],
  );
  if (framework === 'HTML') {
    const field = (name, type = 'text') =>
      `<label>${name}<input type="${type}" placeholder="${name}" /></label>`;
    const button = (text) => `<button type="button">${text}</button>`;
    const content = {
      blank: '<section aria-label="Content"></section>',
      login: `${field('Email', 'email')}${field('Password', 'password')}${button('Sign in')}`,
      contact: `${field('Name')}${field('Email', 'email')}<label>Message<textarea rows="5"></textarea></label>${button('Send message')}`,
      dashboard:
        '<div class="metrics"><article><small>Projects</small><h2>24</h2></article><article><small>Completed</small><h2>18</h2></article><article><small>In progress</small><h2>6</h2></article></div><h2>Recent activity</h2><ul><li>New project created</li><li>Design review completed</li></ul>',
      settings: `${field('Display name')}${field('Email', 'email')}<label><input type="checkbox" checked /> Enable notifications</label>${button('Save preferences')}`,
      card: `<p>Describe your idea and invite people to take the next step.</p>${button('Get started')}`,
      list: '<label>Search<input type="search" placeholder="Search items" /></label><ul><li>First item</li><li>Second item</li><li>Third item</li></ul>',
    }[recipe];
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title><style>\n*{box-sizing:border-box}body{margin:0;padding:clamp(20px,5vw,64px);background:${bg};color:${text};font:16px/1.5 system-ui,sans-serif}main{max-width:960px;margin:auto}section,article,form{background:${panel};padding:24px;border-radius:16px}h1{font-size:clamp(28px,4vw,42px)}label{display:grid;gap:8px;margin:16px 0}input,textarea,button{font:inherit;padding:12px;border:1px solid #8892a455;border-radius:8px}input,textarea{background:${panel};color:${text};width:100%}input[type=checkbox]{width:auto}button{background:${accent};color:white;cursor:pointer;min-height:44px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid ${accent};outline-offset:3px}\n</style></head><body><main><h1>${heading}</h1><section>${content}</section></main></body></html>`;
  }
  const namespace =
    framework === 'Avalonia'
      ? 'https://github.com/avaloniaui'
      : 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
  const label = (t) => `<TextBlock Text="${t}" Margin="0,12,0,6" Foreground="${text}"/>`;
  const field = (t, password = false) =>
    `${label(t)}<${password && framework !== 'Avalonia' ? 'PasswordBox' : 'TextBox'}${password && framework === 'Avalonia' ? ' PasswordChar="●"' : ''} MinHeight="40"/>`;
  const button = (t) =>
    `<Button Content="${t}" MinHeight="44" Margin="0,20,0,0" Padding="20,10" Background="${accent}" Foreground="White"/>`;
  const content = {
    blank: '<Grid MinHeight="200"/>',
    login: `${field('Email')}${field('Password', true)}${button('Sign in')}`,
    contact: `${field('Name')}${field('Email')}${label('Message')}<TextBox AcceptsReturn="True" Height="120"/>${button('Send message')}`,
    dashboard: `<StackPanel Orientation="Horizontal"><Border Padding="20" Margin="0,0,16,0" Background="${bg}"><StackPanel>${label('Projects')}<TextBlock Text="24" FontSize="32"/></StackPanel></Border><Border Padding="20" Background="${bg}"><StackPanel>${label('Completed')}<TextBlock Text="18" FontSize="32"/></StackPanel></Border></StackPanel>${label('Recent activity')}<ListBox><ListBoxItem Content="New project created"/><ListBoxItem Content="Design review completed"/></ListBox>`,
    settings: `${field('Display name')}${field('Email')}<CheckBox Content="Enable notifications" IsChecked="True" Margin="0,16,0,0"/>${button('Save preferences')}`,
    card: `<TextBlock Text="Describe your idea and invite people to take the next step." TextWrapping="Wrap"/>${button('Get started')}`,
    list: `${field('Search')}<ListBox Margin="0,16,0,0"><ListBoxItem Content="First item"/><ListBoxItem Content="Second item"/><ListBoxItem Content="Third item"/></ListBox>`,
  }[recipe];
  return `<UserControl xmlns="${namespace}" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="960" Height="640" Background="${bg}">\n  <ScrollViewer><StackPanel Margin="32"><TextBlock Text="${heading.startsWith('{') ? '{}' : ''}${heading}" FontSize="32" FontWeight="Bold" Foreground="${text}" Margin="0,0,0,24"/><Border Background="${panel}" CornerRadius="16" Padding="24"><StackPanel>${content}</StackPanel></Border></StackPanel></ScrollViewer>\n</UserControl>`;
}
