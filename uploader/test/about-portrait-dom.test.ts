import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate as settle } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { ui } from '../../site/src/i18n/ui.js';
import { neutralIdentity, type Identity, type IdentityLocale } from '../../site/src/lib/site-identity.js';
import { editorDocument } from './editor-dom-harness.js';

const imageOrigin = 'https://img.example';
const photo = { src: imageOrigin + '/photos/simon', width: 480, height: 720, format: 'jpeg' as const };
const item = { ...photo, key: 'photos/simon', status: 'ready', alt: { de: 'Simon am See', en: 'Simon at the lake' } };
const savedPortrait = { ...photo, alt: 'Before', focus: { x: 35, y: 60 } };
const copy = Object.fromEntries(Object.entries(ui.en).filter(([key]) => key.startsWith('editor.chrome.'))
  .map(([key, value]) => [key.slice('editor.chrome.'.length), value]));
type Put = { identity: Identity; revision: number };
const initial = (): Put => ({ identity: { ...neutralIdentity(), aboutGear: { de: 'Camera' }, aboutPortrait: { en: savedPortrait } }, revision: 7 });
const conflict = () => Response.json({ code: 'identity_conflict' }, { status: 409 });

async function editor(options: { initial?: Put; locales?: IdentityLocale[]; put?: (sent: Put) => Promise<Response> | Response;
  get?: () => Response; confirm?: (question: { body: string }) => Promise<boolean> | boolean } = {}) {
  const { document, scripts } = editorDocument(readFileSync('public/about.html', 'utf8'));
  let current = options.initial ?? initial();
  const locales = options.locales ?? ['de', 'en'];
  const puts: Put[] = [];
  const urls: string[] = [];
  const manuscriptEdit = vi.fn();
  document.querySelector('main')!.addEventListener('input', manuscriptEdit);
  document.querySelector('main')!.addEventListener('change', manuscriptEdit);
  const events = new EventTarget();
  const context: Record<string, unknown> = { document, EditorCopy: { en: copy }, EditorGalleryImageOrigin: imageOrigin,
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout, addEventListener: events.addEventListener.bind(events),
    matchMedia: () => ({ matches: false }), AdminConfirm: { ask: options.confirm },
    fetch: async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url === '/media/folders') return Response.json([]);
      if (url.startsWith('/media?')) return Response.json({ items: [item], total: 1 });
      if (url !== '/settings/identity') throw new Error('Unexpected request: ' + url);
      if (init?.method !== 'PUT') return options.get?.() ?? Response.json({ ...current, locales });
      const sent: Put = JSON.parse(String(init.body));
      puts.push(sent);
      const response = options.put ? await options.put(sent) : sent.revision !== current.revision ? conflict()
        : Response.json({ revision: current.revision + 1 });
      if (response.ok) current = { identity: sent.identity, revision: (await response.clone().json()).revision };
      return response;
    } };
  context.window = context;
  vm.createContext(context);
  // Load the field controllers and the real single-select picker in page order.
  for (const { src } of scripts) if (src && /\/(admin-ui|media-api|picker-selection|media-picker|posts-filter|tabs|about-equipment|about-portrait)\.js$/.test(src)) {
    vm.runInContext(readFileSync(src.replace('/admin/', 'public/'), 'utf8'), context);
  }
  vm.runInContext("Tabs.wire(document.querySelector('[role=tablist]'))", context);
  context.locales = locales;
  await vm.runInContext('AboutIdentity.init({ locales })', context);
  const el = (id: string) => document.getElementById(id)!;
  const click = async (id: string) => { el(id).click(); await settle(); };
  const type = (id: string, value: string) => { el(id).value = value; el(id).fire('input'); };
  const open = async () => { await click('dePortraitChoose'); return document.querySelector('dialog.media-picker')!; };
  const pick = async () => {
    const picker = await open();
    picker.querySelector('[role=option]')!.click();
    picker.querySelectorAll('button').find((b) => b.textContent === 'Use this photo')!.click();
  };
  const dirty = () => !events.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  return { document, el, type, click, puts, urls, open, pick, dirty, manuscriptEdit };
}

const mutations = ['Gear', 'GearSave', 'GearReload', 'PortraitAlt', 'PortraitChoose', 'PortraitRemove', 'PortraitSave', 'PortraitReload'];
describe('About profile portrait', () => {
  it('picks a ready library item, prefills only empty alt, and saves or clears only the selected locale', async () => {
    const h = await editor();
    expect(h.el('dePortraitEmpty').hidden).toBe(false);
    await h.pick();
    expect(h.urls.find((url) => url.startsWith('/media?'))).toContain('status=ready');
    expect(h.document.activeElement).toBe(h.el('dePortraitChoose'));
    expect(h.el('dePortraitAlt').value).toBe('Simon am See');
    expect(h.el('dePortraitPreview').getAttribute('alt')).toBe('');
    expect(h.el('dePortraitPreview')).toHaveProperty('src', photo.src + '-480.jpeg');
    expect(h.dirty()).toBe(true);
    h.type('dePortraitAlt', '  Cafe\u0301 am See  ');
    await h.pick();
    expect(h.el('dePortraitAlt').value).toBe('  Cafe\u0301 am See  ');
    expect(h.puts).toHaveLength(0);
    await h.click('dePortraitSave');
    expect(h.puts[0]).toEqual({ revision: 7, identity: { ...initial().identity,
      aboutPortrait: { en: savedPortrait, de: { ...photo, alt: 'Café am See' } } } });
    expect(h.el('dePortraitAlt').value).toBe('Café am See');
    expect(h.el('dePortraitStatus').textContent).toBe(copy.aboutPortraitSaved);
    expect(h.dirty()).toBe(false);
    await h.click('dePortraitRemove');
    expect(h.el('dePortraitAlt').value).toBe('');
    expect(h.el('dePortraitEmpty').hidden).toBe(false);
    expect(h.document.activeElement).toBe(h.el('dePortraitChoose'));
    expect(h.puts).toHaveLength(1);
    await h.click('dePortraitSave');
    expect(h.puts[1]).toEqual({ ...initial(), revision: 8 });
    expect(h.el('dePortraitStatus').textContent).toBe(copy.aboutPortraitCleared);
    expect(h.manuscriptEdit).not.toHaveBeenCalled();
  });

  it('returns focus to the chooser on Cancel and Escape without marking a draft', async () => {
    const h = await editor();
    (await h.open()).querySelectorAll('button').find((b) => b.textContent === 'Cancel')!.click();
    expect(h.document.activeElement).toBe(h.el('dePortraitChoose'));
    (await h.open()).fire('keydown', { key: 'Escape' });
    expect(h.document.querySelector('dialog')).toBeNull();
    expect(h.document.activeElement).toBe(h.el('dePortraitChoose'));
    expect(h.dirty()).toBe(false);
  });

  it('retains invalid alt, counts normalized code points and does not send an invalid portrait', async () => {
    const h = await editor({ locales: ['de'] });
    await h.pick();
    const boundary = 'e\u0301'.repeat(299) + '📷';
    for (const [value, message] of [['  ', copy.aboutPortraitRequired], ['Left\u202eright', copy.aboutPortraitPlain],
      [boundary + 'x', copy.aboutPortraitTooLong!.replace('{over}', '1').replace('{max}', '300')]] as const) {
      h.type('dePortraitAlt', value);
      await h.click('dePortraitSave');
      expect(h.puts).toHaveLength(0);
      expect(h.el('dePortraitAlt').value).toBe(value);
      expect(h.el('dePortraitError').textContent).toBe(message);
      expect(h.el('dePortraitAlt').getAttribute('aria-invalid')).toBe('true');
      expect(h.document.activeElement).toBe(h.el('dePortraitAlt'));
    }
    expect(h.el('dePortraitCount').textContent).toBe('301 of 300 characters, 1 too many');
    h.type('dePortraitAlt', boundary);
    await h.click('dePortraitSave');
    expect(h.puts[0]!.identity.aboutPortrait).toEqual({ de: { ...photo, alt: boundary.normalize('NFC') } });
    expect(h.el('enPortraitSection').hidden).toBe(true);
  });

  it('locks every locale during a pending save, refuses overlap, then uses the acknowledged revision', async () => {
    const first = Promise.withResolvers<Response>();
    const h = await editor({ put: (sent) => sent.revision === 7 ? first.promise : Response.json({ revision: sent.revision + 1 }) });
    await h.pick();
    h.type('deGear', '  Notebook  ');
    h.el('deGearSave').click();
    for (const l of ['de', 'en']) for (const id of mutations) expect(h.el(l + id).disabled, l + id).toBe(true);
    h.el('dePortraitSave').fire('click'); h.el('dePortraitReload').fire('click'); h.el('dePortraitChoose').fire('click');
    expect(h.document.querySelector('dialog')).toBeNull();
    expect(h.urls.filter((url) => url === '/settings/identity')).toHaveLength(2);
    first.resolve(Response.json({ revision: 8 }));
    await settle();
    expect(h.el('dePortraitAlt').value).toBe(item.alt.de);
    expect(h.el('dePortraitStatus').textContent).toBe(copy.aboutPortraitUnsaved);
    h.type('deGear', 'Another gear draft');
    await h.click('dePortraitSave');
    expect(h.puts[1]).toMatchObject({ revision: 8, identity: { aboutGear: { de: 'Notebook' }, aboutPortrait: { de: { alt: item.alt.de } } } });
    expect(h.el('deGear').value).toBe('Another gear draft');
    await h.click('deGearSave');
    expect(h.puts[2]).toMatchObject({ revision: 9, identity: { aboutPortrait: { de: { alt: item.alt.de } } } });
  });

  it('preserves both drafts on conflict, cancelled reload and failed GET; confirms the exact dirty scopes', async () => {
    let question = Promise.withResolvers<boolean>();
    const ask = vi.fn(() => question.promise);
    let get = Response.json({ ...initial(), locales: ['de', 'en'] });
    const h = await editor({ put: conflict, get: () => get.clone(), confirm: ask });
    await h.pick();
    h.el('tabbtn-en').click(); h.type('enGear', 'My English equipment'); h.el('tabbtn-de').click();
    await h.click('dePortraitSave');
    expect(h.el('dePortraitError').textContent).toBe(copy.aboutPortraitConflict);
    expect(h.document.activeElement).toBe(h.el('dePortraitReload'));
    h.el('deGearReload').click();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('Equipment (EN), Portrait (DE)') }));
    for (const l of ['de', 'en']) for (const id of mutations) expect(h.el(l + id).disabled).toBe(true);
    h.el('dePortraitReload').fire('click');
    expect(ask).toHaveBeenCalledTimes(1);
    question.resolve(false); await settle();
    expect(h.urls.filter((url) => url === '/settings/identity')).toHaveLength(2);
    expect(h.el('dePortraitAlt').value).toBe(item.alt.de);
    expect(h.el('enGear').value).toBe('My English equipment');
    get = Response.json({}, { status: 503 });
    question = Promise.withResolvers<boolean>();
    h.el('dePortraitReload').click(); question.resolve(true); await settle();
    expect(h.el('deGearError').textContent).toBe(copy.aboutGearLoadFailed);
    expect(h.el('dePortraitError').textContent).toBe(copy.aboutPortraitLoadFailed);
    expect(h.el('dePortraitReload').hidden).toBe(false);
    expect(h.el('dePortraitAlt').value).toBe(item.alt.de);
    expect(h.el('enGear').value).toBe('My English equipment');
    const fresh = { ...initial().identity, aboutGear: { en: 'Saved elsewhere' } };
    get = Response.json({ revision: 8, identity: fresh, locales: ['de', 'en'] });
    await h.click('dePortraitReload');
    expect(h.el('dePortraitEmpty').hidden).toBe(false);
    expect(h.el('dePortraitAlt').value).toBe('');
    expect(h.el('enGear').value).toBe('Saved elsewhere');
    expect(h.dirty()).toBe(false);
    expect(h.puts).toHaveLength(1);
  });

  it('uses the original equipment confirmation from portrait Reload when only equipment is dirty', async () => {
    const ask = vi.fn(() => false);
    const h = await editor({ put: conflict, confirm: ask });
    h.type('deGear', 'Retained');
    await h.click('deGearSave'); await h.click('dePortraitReload');
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ body: copy.aboutGearReloadConfirm }));
    expect(h.el('deGear').value).toBe('Retained');
  });

  it('keeps a refused or unconfirmed portrait and does not advance its revision', async () => {
    const put = vi.fn().mockResolvedValueOnce(Response.json({ code: 'invalid_identity', field: 'aboutPortrait.de' }, { status: 400 }))
      .mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ revision: 8 }));
    const h = await editor({ put });
    await h.pick();
    for (const message of [copy.aboutPortraitHostRefused, copy.aboutPortraitFailed, copy.aboutPortraitFailed]) {
      await h.click('dePortraitSave');
      expect(h.el('dePortraitError').textContent).toBe(message);
      expect(h.el('dePortraitAlt').value).toBe(item.alt.de);
      expect(h.dirty()).toBe(true);
    }
    await h.click('dePortraitSave');
    expect(h.puts.map((p) => p.revision)).toEqual([7, 7, 7, 7]);
    expect(h.dirty()).toBe(false);
  });

  it('disables both editors on 403 without losing input or disabling the page manuscript', async () => {
    const h = await editor({ put: () => Response.json({}, { status: 403 }) });
    await h.pick(); await h.click('dePortraitSave');
    expect(h.el('dePortraitError').textContent).toBe(copy.aboutPortraitForbidden);
    expect(h.document.activeElement).toBe(h.el('dePortraitError'));
    expect(h.el('dePortraitAlt').value).toBe(item.alt.de);
    for (const l of ['de', 'en']) for (const id of mutations) expect(h.el(l + id).disabled).toBe(true);
    expect(h.el('deTitle').disabled).toBe(false);
  });
});
