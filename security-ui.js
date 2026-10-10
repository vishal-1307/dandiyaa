(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JmuSecurityUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\u0000-\u001f]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function bindActions(container, actions) {
    container.addEventListener('click', function (event) {
      const button = event.target.closest('[data-action]');
      if (!button || !container.contains(button)) return;
      const handler = Object.hasOwn(actions,button.dataset.action) ? actions[button.dataset.action] : null;
      if (typeof handler === 'function') handler(button.dataset.passId, button);
    });
  }
  function textElement(document, tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text ?? '');
    if (className) element.className = className;
    return element;
  }
  return { csvCell, bindActions, textElement };
});
