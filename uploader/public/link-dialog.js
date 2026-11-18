/* The editor's one link dialog: a free address plus the site's live internal
 * pages. Markdown-mode analysis is server-owned so the browser never guesses
 * CommonMark; the server returns either a link's byte ranges or a safe label. */
window.InternalLinkDialog = (function () {
  'use strict';

  const KIND_LABEL = {
    home: 'linkKindHome', about: 'linkKindAbout', map: 'linkKindMap', regions: 'linkKindRegions',
    journeys: 'linkKindJourneys', region: 'linkKindRegion', page: 'linkKindPage',
    story: 'linkKindStory', journey: 'linkKindJourney',
  };

  function destinationError(value) {
    return /[\u0000-\u001f\u007f\u0080-\u009f]/.test(value) ? 'destination-control' : '';
  }

  function escapeDestination(value) {
    return value.replace(/&/g, '&amp;')
      .replace(/[\\()<>|]/g, '\\$&')
      .replace(/[\u0000-\u0020\u007f]/g, (character) => encodeURIComponent(character));
  }

  function isEscapedDestination(value) {
    if (value.startsWith('<')) return false;
    let depth = 0;
    let escaped = false;
    for (const character of value) {
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (/[\s\u0000-\u001f\u007f\u0080-\u009f|]/.test(character)) return false;
      if (character === '(') depth++;
      if (character === ')' && depth-- === 0) return false;
    }
    return !escaped && depth === 0;
  }

  function normalizePath(value) {
    let path = value;
    try {
      const url = new URL(value, location.origin);
      if (url.origin === location.origin) path = url.pathname;
    } catch (_) { /* keep the raw value */ }
    const cut = path.search(/[?#]/);
    return cut < 0 ? path : path.slice(0, cut);
  }

  function samePath(value, target) {
    const path = normalizePath(value);
    return path === target || path === target.replace(/\/$/, '') || `${path}/` === target;
  }

  function create(options) {
    const copy = options.copy;
    const onUnauthed = options.onUnauthed;
    const catalogs = new Map();
    const pending = new Map();
    let dialog = null;

    function load(locale) {
      if (catalogs.has(locale)) return Promise.resolve(catalogs.get(locale));
      if (pending.has(locale)) return pending.get(locale);
      const request = fetch('/internal-links?locale=' + encodeURIComponent(locale), { cache: 'no-store' })
        .then(async (response) => {
          if (response.status === 401) { onUnauthed?.(); throw new Error('unauthenticated'); }
          if (!response.ok) throw new Error('link targets failed');
          const catalog = await response.json();
          catalogs.set(locale, catalog);
          return catalog;
        })
        .finally(() => { if (!catalogs.has(locale)) pending.delete(locale); });
      pending.set(locale, request);
      return request;
    }

    function analyze(bodyMarkdown, from, to) {
      return fetch('/internal-links/analyze', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyMarkdown, from, to }),
      }).then(async (response) => {
        if (response.status === 401) { onUnauthed?.(); throw new Error('unauthenticated'); }
        if (!response.ok) throw new Error('link analysis failed');
        return response.json();
      });
    }

    function ensure() {
      if (dialog) return dialog;
      const element = document.createElement('dialog');
      if (!element || typeof element.showModal !== 'function') return null;
      element.id = 'internalLinkDialog';
      element.className = 'admin-modal';
      element.setAttribute('aria-labelledby', 'internalLinkTitle');
      element.setAttribute('aria-describedby', 'internalLinkBody');
      element.innerHTML =
        '<form method="dialog" id="internalLinkForm">' +
          '<h2 id="internalLinkTitle" class="card-heading"></h2>' +
          '<p id="internalLinkBody" class="help admin-modal__body"></p>' +
          '<label for="internalLinkTarget" id="internalLinkTargetLabel"></label>' +
          '<select id="internalLinkTarget"></select>' +
          '<label for="internalLinkText" id="internalLinkTextLabel"></label>' +
          '<input id="internalLinkText" type="text" autocomplete="off" aria-describedby="internalLinkError">' +
          '<p id="internalLinkError" class="field-error" hidden></p>' +
          '<p id="internalLinkStatus" class="help" role="status" aria-live="polite"></p>' +
          '<div class="admin-modal__foot">' +
            '<button type="submit" value="cancel" class="btn-secondary" id="internalLinkCancel"></button>' +
            '<button type="submit" value="ok" id="internalLinkApply"></button>' +
          '</div>' +
        '</form>';
      document.body.appendChild(element);
      dialog = element;
      return element;
    }

    function populate(element, catalog, current) {
      const select = element.querySelector('#internalLinkTarget');
      const status = element.querySelector('#internalLinkStatus');
      select.replaceChildren();
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = copy.linkTargetCustom;
      select.appendChild(custom);
      if (!catalog) {
        status.textContent = copy.linkTargetsFailed;
        return;
      }
      const groups = new Map();
      for (const target of catalog.targets || []) {
        const label = copy[KIND_LABEL[target.kind]] || target.kind;
        if (!groups.has(target.kind)) {
          const group = document.createElement('optgroup');
          group.label = label;
          groups.set(target.kind, group);
          select.appendChild(group);
        }
        const option = document.createElement('option');
        option.value = target.path;
        option.textContent = (target.title ? target.title + ' — ' : '') + target.path +
          (target.alternatePath ? '' : ' — ' + copy.linkNoTranslation);
        groups.get(target.kind).appendChild(option);
      }
      status.textContent = '';
      const match = [...select.querySelectorAll('option')].find((option) => option.value && samePath(current, option.value));
      if (match) select.value = match.value;
    }

    function fallbackPrompt(current, extraValidate) {
      const AdminConfirm = window.AdminConfirm;
      if (!AdminConfirm?.prompt) return Promise.resolve(null);
      return AdminConfirm.prompt({
        title: copy.linkDialogTitle, body: copy.linkDialogBody, label: copy.richLinkLabel,
        value: current, confirmLabel: copy.richLinkConfirm, required: false,
        validate: (text) => refusal(text, extraValidate) ? copy.richLinkInvalid : '',
      });
    }

    function refusal(value, extraValidate) {
      if (!value) return '';
      if (typeof window.RichTextEditor?.safeLink !== 'function' || !window.RichTextEditor.safeLink(value)) return copy.richLinkInvalid;
      if (destinationError(value)) return copy.richLinkInvalid;
      return extraValidate ? extraValidate(value) : '';
    }

    function open(details) {
      const current = details.current || '';
      const locale = details.locale;
      const extraValidate = details.extraValidate;
      const element = ensure();
      if (!element) return fallbackPrompt(current, extraValidate);

      const title = element.querySelector('#internalLinkTitle');
      const body = element.querySelector('#internalLinkBody');
      const targetLabel = element.querySelector('#internalLinkTargetLabel');
      const textLabel = element.querySelector('#internalLinkTextLabel');
      const input = element.querySelector('#internalLinkText');
      const error = element.querySelector('#internalLinkError');
      const status = element.querySelector('#internalLinkStatus');
      const select = element.querySelector('#internalLinkTarget');
      const ok = element.querySelector('#internalLinkApply');
      const cancel = element.querySelector('#internalLinkCancel');

      title.textContent = copy.linkDialogTitle;
      body.textContent = copy.linkDialogBody;
      targetLabel.textContent = copy.linkTargetLabel;
      textLabel.textContent = copy.richLinkLabel;
      ok.textContent = copy.richLinkConfirm;
      cancel.textContent = copy.linkCancel;
      input.value = current;
      error.hidden = true;
      error.textContent = '';
      status.textContent = copy.linkTargetLoading;
      select.replaceChildren();
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = copy.linkTargetCustom;
      select.appendChild(custom);
      select.disabled = true;

      function accept() {
        const message = refusal(input.value.trim(), extraValidate);
        error.textContent = message;
        error.hidden = !message;
        if (message) { input.setAttribute('aria-invalid', 'true'); input.focus(); return false; }
        input.removeAttribute('aria-invalid');
        return true;
      }
      select.addEventListener('change', () => {
        if (select.value) { input.value = select.value; input.focus(); }
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (!accept()) return;
        element.returnValue = 'ok';
        element.close();
      });
      select.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (!accept()) return;
        element.returnValue = 'ok';
        element.close();
      });
      const onOk = (event) => { if (!accept()) event.preventDefault(); };
      ok.addEventListener('click', onOk);

      load(locale).then((catalog) => {
        if (!element.open) return;
        select.disabled = false;
        populate(element, catalog, current);
      }).catch(() => {
        if (!element.open) return;
        status.textContent = copy.linkTargetsFailed;
      });

      return new Promise((resolve) => {
        function onClose() {
          element.removeEventListener('close', onClose);
          ok.removeEventListener('click', onOk);
          const value = element.returnValue === 'ok' && !refusal(input.value.trim(), extraValidate)
            ? input.value.trim() : null;
          resolve(value);
        }
        element.addEventListener('close', onClose);
        element.returnValue = '';
        element.showModal();
        input.focus();
        if (typeof input.select === 'function') input.select();
      });
    }

    function markdown(cm, locale, notice) {
      const ranges = typeof cm.listSelections === 'function' ? cm.listSelections() : [];
      if (!Array.isArray(ranges) || ranges.length !== 1) { notice?.(copy.linkSelectText); return Promise.resolve(); }
      const documentText = cm.getValue();
      const anchor = cm.indexFromPos(ranges[0].anchor);
      const head = cm.indexFromPos(ranges[0].head);
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      if (from === to) { notice?.(copy.linkSelectText); return Promise.resolve(); }
      return analyze(documentText, from, to).then(async (result) => {
        if (!result || typeof result.kind !== 'string') { notice?.(copy.linkEditInSource); return; }
        if (result.kind === 'link') {
          const link = result.link;
          if (!link) { notice?.(copy.linkEditInSource); return; }
          const value = await open({ current: link.url, locale });
          if (value === null || value === link.url) return;
          const destination = value === '' ? '' : escapeDestination(value);
          if (value !== '' && (refusal(value) || !isEscapedDestination(destination))) { notice?.(copy.linkEditInSource); return; }
          if (value === '') {
            if (!link.removalSafe) { notice?.(copy.linkEditInSource); return; }
            cm.replaceRange(documentText.slice(link.labelStart, link.labelEnd),
              cm.posFromIndex(link.start), cm.posFromIndex(link.end));
            return;
          }
          cm.replaceRange(destination, cm.posFromIndex(link.destinationStart), cm.posFromIndex(link.destinationEnd));
          return;
        }
        if (result.kind === 'text' && typeof result.label === 'string') {
          const value = await open({ current: '', locale });
          if (!value) return;
          const destination = escapeDestination(value);
          if (refusal(value) || !isEscapedDestination(destination)) { notice?.(copy.linkEditInSource); return; }
          cm.replaceRange('[' + result.label + '](' + destination + ')',
            cm.posFromIndex(from), cm.posFromIndex(to));
          return;
        }
        notice?.(copy.linkEditInSource);
      }).catch(() => { notice?.(copy.linkEditInSource); });
    }

    function wireMarkdown(cm, locale, notice) {
      const action = () => { void markdown(cm, locale, notice); };
      if (typeof cm.addKeyMap === 'function') {
        cm.addKeyMap({
          'Cmd-K': () => { action(); return true; },
          'Ctrl-K': () => { action(); return true; },
        });
        return;
      }
      const field = typeof cm.getInputField === 'function' ? cm.getInputField() : null;
      field?.addEventListener('keydown', (event) => {
        if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'k' || event.defaultPrevented) return;
        event.preventDefault();
        action();
      });
    }

    return {
      open,
      markdown,
      wireMarkdown,
      map: (locale) => load(locale).then((catalog) => catalog.links || []),
    };
  }

  return { create, escapeDestination, destinationError, isEscapedDestination };
})();
