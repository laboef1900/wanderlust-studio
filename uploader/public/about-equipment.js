// The About profile editors share a single identity revision. The manuscript has
// its own draft and save path; neither a profile edit nor its acknowledgement
// may touch that draft (or another locale's pending profile input).
window.AboutIdentity = (function () {
  const locales = ['de', 'en'];
  const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const format = (text, values) => text.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  function measure(value) {
    const nfc = value.normalize('NFC');
    return { normalized: nfc.trim(), plain: !/\p{C}/u.test(nfc), count: [...nfc.trim()].length };
  }

  function equipment({ el, copy }) {
    const input = el('');
    el('Heading').textContent = copy.identityAboutGear;
    el('Settings').textContent = copy.aboutGearSettings;
    return {
      input, entry: input, max: 200,
      read: () => input.value,
      normalize: (value) => measure(value).normalized,
      write: (value) => { input.value = value ?? ''; },
      dirty: (saved) => input.value !== (saved ?? ''),
      lock: (locked) => { input.disabled = locked; },
    };
  }
  const fields = { Gear: equipment };

  function init(options) {
    const copy = EditorCopy[document.documentElement.lang === 'de' ? 'de' : 'en'];
    let loaded = null;
    let state = 'loading';
    let operation = null;
    let unloadGuarded = false;
    const panels = [];
    const shown = (p) => (loaded?.locales ?? options.locales).includes(p.locale);
    const saved = (p) => loaded?.identity[p.field][p.locale];
    const dirtyPanels = () => panels.filter((p) => loaded && shown(p) && p.dirty(saved(p)));

    for (const [kind, create] of Object.entries(fields)) {
      const field = 'about' + kind;
      for (const locale of locales) {
        const el = (suffix) => document.getElementById(locale + kind + suffix);
        const msg = (suffix) => copy[field + suffix];
        const p = create({ el, copy, locale, onUnauthed: options.onUnauthed, edited: () => edited(p) });
        Object.assign(p, { el, locale, field, msg });
        panels.push(p);
        el('Help').textContent = msg('Help');
        el('Label').textContent = format(msg('Label'), { code: locale.toUpperCase() });
        el('Save').textContent = msg('Save');
        el('Timing').textContent = msg('Timing');
        for (const type of ['input', 'change']) el('Section').addEventListener(type, (event) => event.stopPropagation());
        p.input.addEventListener('input', () => edited(p));
        el('Save').addEventListener('click', () => save(p));
        el('Reload').addEventListener('click', () => reload(p));
      }
    }

    function error(p, text, invalid = false) {
      p.el('Error').textContent = text;
      p.el('Error').hidden = !text;
      if (invalid) p.input.setAttribute('aria-invalid', 'true');
      else p.input.removeAttribute('aria-invalid');
    }
    function count(p) {
      const { count } = measure(p.input.value);
      p.el('Count').textContent = format(p.msg(count > p.max ? 'Over' : 'Count'), { count, max: p.max, over: count - p.max });
    }
    function problem(p) {
      const { count, plain } = measure(p.input.value);
      if (!plain) return p.msg('Plain');
      if (p.input.required && !count) return p.msg('Required');
      return count > p.max ? format(p.msg('TooLong'), { count, max: p.max, over: count - p.max }) : '';
    }
    function paint() {
      for (const p of panels) {
        p.el('Section').hidden = !shown(p);
        const locked = !!operation || !['ready', 'conflict'].includes(state);
        p.lock(locked);
        p.el('Save').disabled = locked || state === 'conflict';
        p.el('Reload').hidden = state !== 'conflict' && state !== 'unavailable';
        p.el('Reload').disabled = !!operation || state === 'forbidden';
        p.el('Reload').textContent = state === 'unavailable' ? copy.aboutGearRetry : p.msg('Reload');
      }
    }
    function edited(p) {
      if (state !== 'conflict') error(p, '');
      p.el('Status').textContent = p.dirty(saved(p)) ? p.msg('Unsaved') : '';
      count(p);
      paint();
      if (unloadGuarded) return;
      unloadGuarded = true;
      window.addEventListener('beforeunload', (event) => {
        if (!dirtyPanels().length) return;
        event.preventDefault();
        event.returnValue = '';
      });
    }
    function begin() {
      operation = Symbol();
      paint();
      return operation;
    }
    function finish(token, origin, target) {
      if (operation !== token) return;
      operation = null;
      paint();
      if (target) target.focus();
      else if (origin && (!document.activeElement || document.activeElement === document.body || document.activeElement === origin)) origin.focus();
    }
    function announceState(next, message) {
      state = next;
      for (const p of panels) {
        p.el('Status').textContent = '';
        error(p, p.msg(message));
      }
    }
    async function load(token) {
      state = 'loading';
      for (const p of panels) { p.el('Status').textContent = p.msg('Loading'); error(p, ''); }
      try {
        const response = await fetch('/settings/identity', { cache: 'no-store' });
        if (operation !== token) return;
        if (response.status === 401) { options.onUnauthed(); return; }
        if (response.status === 403) { announceState('forbidden', 'Forbidden'); return; }
        const data = response.ok ? await response.json() : null;
        if (operation !== token) return;
        if (!Number.isInteger(data?.revision) || data.revision < 1 || !Array.isArray(data.locales) || !data.locales.length
          || !data.locales.every((l) => locales.includes(l)) || !panels.every((p) => record(data.identity?.[p.field]))) {
          throw new Error('identity_unavailable');
        }
        loaded = data;
        state = 'ready';
        for (const p of panels) {
          p.el('Status').textContent = '';
          if (shown(p)) { p.write(saved(p)); count(p); }
        }
      } catch { if (operation === token) announceState('unavailable', 'LoadFailed'); }
    }

    function reloadQuestion() {
      const dirty = dirtyPanels();
      if (!dirty.length) return null;
      if (dirty.every((p) => p.field === 'aboutGear')) {
        return { title: copy.aboutGearReload, body: copy.aboutGearReloadConfirm, confirmLabel: copy.aboutGearReload };
      }
      const scopes = dirty.map((p) => `${p.el('Heading').textContent} (${p.locale.toUpperCase()})`);
      return { title: copy.aboutIdentityReloadConfirmTitle, body: format(copy.aboutIdentityReloadConfirmBody, { scopes: scopes.join(', ') }),
        confirmLabel: copy.aboutIdentityReloadConfirmAction };
    }
    async function reload(p) {
      if (operation || state === 'forbidden') return;
      const origin = document.activeElement;
      const token = begin();
      let target;
      try {
        const question = reloadQuestion();
        if (question && !await AdminConfirm.ask(question)) return;
        await load(token);
        if (p) target = state === 'ready' ? p.entry : state === 'forbidden' ? p.el('Error') : p.el('Reload');
      } finally { finish(token, p && origin, target); }
    }
    function payload(p, value) {
      const identity = { ...loaded.identity };
      for (const [key, map] of Object.entries(identity)) {
        if (record(map)) identity[key] = Object.fromEntries(Object.entries(map).filter(([l]) => loaded.locales.includes(l)));
      }
      if (value === undefined) delete identity[p.field][p.locale];
      else identity[p.field][p.locale] = value;
      return { revision: loaded.revision, identity };
    }
    async function save(p) {
      if (operation || state !== 'ready' || !shown(p)) return;
      const invalid = problem(p);
      if (invalid) { error(p, invalid, true); p.el('Status').textContent = ''; p.input.focus(); return; }
      const origin = document.activeElement;
      const token = begin();
      const value = p.read();
      let target;
      error(p, '');
      p.el('Status').textContent = p.msg('Saving');
      try {
        const response = await fetch('/settings/identity', {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(p, value)),
        });
        if (operation !== token) return;
        if (response.status === 401) { options.onUnauthed(); return; }
        const result = await response.json().catch(() => null);
        if (operation !== token) return;
        p.el('Status').textContent = '';
        if (response.status === 409 && result?.code === 'identity_conflict') {
          announceState('conflict', 'Conflict');
          target = p.el('Reload');
        } else if (response.status === 403) {
          announceState('forbidden', 'Forbidden');
          target = p.el('Error');
        } else if (response.status === 400 && result?.code === 'invalid_identity') {
          const field = typeof result.field === 'string' ? result.field : 'identity';
          const own = field === p.field + '.' + p.locale;
          const gearText = own && p.field === 'aboutGear';
          error(p, own ? (gearText ? p.msg('Plain') : p.msg('HostRefused')) : format(p.msg('OtherInvalid'), { field }), gearText);
          target = gearText ? p.input : p.el('Error');
        } else if (!response.ok || !Number.isInteger(result?.revision) || result.revision <= loaded.revision) {
          throw new Error('unconfirmed');
        } else {
          const stored = p.normalize ? p.normalize(value) : value;
          if (stored === undefined) delete loaded.identity[p.field][p.locale];
          else loaded.identity[p.field][p.locale] = stored;
          loaded.revision = result.revision;
          loaded.savedAt = result.savedAt;
          p.write(stored);
          count(p);
          p.el('Status').textContent = p.msg(stored ? 'Saved' : 'Cleared');
        }
      } catch {
        if (operation !== token) return;
        p.el('Status').textContent = '';
        error(p, p.msg('Failed'));
        target = p.el('Save');
      } finally { finish(token, origin, target); }
    }
    return reload();
  }
  return { init, measure, register(kind, create) { fields[kind] = create; } };
})();
