// Header and footer shared by every page.
import { SITE_NAME, DISCLAIMER, CONTACT } from './config.js';
import { esc } from './lib.js';

export function mountChrome(active) {
  const link = (id, href, text, cls = '') =>
    `<a href="${href}" class="${cls}"${active === id ? ' aria-current="page"' : ''}>${text}</a>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="skip" href="#app">Skip to content</a>
    <div class="wrap bar">
      <a class="brand" href="index.html">${esc(SITE_NAME)}</a>
      <nav aria-label="Main">
        ${link('set', 'index.html', 'Single Set Results')}
        ${link('history', 'history.html', 'All Sets Overview')}
        ${link('compare', 'compare.html', 'Compare Results')}
        ${link('submit', 'submit.html', 'Report your pulls', 'cta')}
      </nav>
    </div>`;
  document.body.prepend(header);
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="wrap"><p>${esc(DISCLAIMER)}</p><p>${esc(CONTACT)}</p></div>`;
  document.body.append(footer);
}
