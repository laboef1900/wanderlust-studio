import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ui } from '../../site/src/i18n/ui.js';
import { EditorEvent, editorDocument, type EditorElement } from './editor-dom-harness.js';

const copy = Object.fromEntries(Object.entries(ui.en)
  .filter(([key]) => key.startsWith('editor.chrome.'))
  .map(([key, value]) => [key.slice('editor.chrome.'.length), value]));

const catalog = {
  locale: 'de', alternateLocale: 'en',
  targets: [
    { id: 'page:about', kind: 'about', title: 'About', path: '/uber-mich/', alternatePath: '/en/about-me/' },
    { id: 'page:contact', kind: 'page', title: 'Kontakt', path: '/kontakt/', alternatePath: null },
  ],
  links: [{ from: '/uber-mich/', to: '/en/about-me/' }],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface LinkDialog {
  open(options: { current?: string; locale: string }): Promise<string | null>;
  map(locale: string): Promise<{ from: string; to: string }[]>;
  markdown(cm: unknown, locale: string, notice?: (message: string) => void): Promise<void>;
  wireMarkdown(cm: unknown, locale: string, notice?: (message: string) => void): void;
}
interface LinkDialogFactory {
  create(options: { copy: Record<string, string>; onUnauthed: () => void }): LinkDialog;
  escapeDestination(value: string): string;
  destinationError(value: string): string;
  isEscapedDestination(value: string): boolean;
}

function setup(fetcher?: (url: string, init: RequestInit) => Promise<Response>) {
  const dom = editorDocument('<!doctype html><html><body></body></html>');
  const requests: string[] = [];
  const notices: string[] = [];
  const ctx: Record<string, unknown> = {
    document: dom.document,
    location: { origin: 'https://admin.test' },
    URL,
    console,
    RichTextEditor: { safeLink: (value: string) => /^(?:https?:\/\/|\/|mailto:|tel:|#)/.test(value) && !/\s/.test(value) },
    AdminConfirm: { prompt: async () => null },
    fetch: async (url: string, init: RequestInit) => {
      requests.push(String(url));
      return fetcher ? fetcher(String(url), init) : response(catalog);
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync('public/link-dialog.js', 'utf8'), ctx);
  // The script assigns the factory to window; the vm context is that window.
  const factory = ctx.InternalLinkDialog as LinkDialogFactory;
  const api = factory.create({ copy, onUnauthed: () => { ctx.unauthed = true; } });
  const dialog = () => dom.document.getElementById('internalLinkDialog')!;
  const input = () => dialog().querySelector('#internalLinkText') as EditorElement;
  const select = () => dialog().querySelector('#internalLinkTarget') as EditorElement;
  async function finish(value: string, closeValue = 'ok') {
    input().value = value;
    dialog().returnValue = closeValue;
    dialog().close();
    dom.flushDialogEvents();
  }
  return { dom, ctx, factory, api, requests, notices, dialog, input, select, finish };
}

async function ready(h: { api: LinkDialog }) {
  await h.api.map('de');
  await Promise.resolve();
}
async function untilOpen(h: { dom: { document: { getElementById(id: string): { open?: boolean } | null } } }) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (h.dom.document.getElementById('internalLinkDialog')?.open) return;
    await Promise.resolve();
  }
  throw new Error('dialog did not open');
}

describe('internal link dialog', () => {
  it('loads the catalog, pre-selects the matching page and applies a target path', async () => {
    const h = setup();
    const pending = h.api.open({ current: '/kontakt/', locale: 'de' });
    await ready(h);
    expect(h.dialog().open).toBe(true);
    expect(h.dialog().getAttribute('aria-labelledby')).toBe('internalLinkTitle');
    expect(h.dialog().getAttribute('aria-describedby')).toBe('internalLinkBody');
    expect(h.select().disabled).toBe(false);
    expect(h.select().value).toBe('/kontakt/');
    expect(h.input().value).toBe('/kontakt/');
    await h.finish('/uber-mich/');
    await expect(pending).resolves.toBe('/uber-mich/');
    expect(h.requests).toEqual(['/internal-links?locale=de']);
  });

  it('applies an empty address and reports a failed catalog without blocking free entry', async () => {
    const empty = setup();
    const emptyPending = empty.api.open({ current: '/uber-mich/', locale: 'de' });
    await ready(empty);
    await empty.finish('');
    await expect(emptyPending).resolves.toBe('');

    const failed = setup(async (url) => (url.startsWith('/internal-links?') ? response({ error: 'down' }, 500) : response(catalog)));
    const failedPending = failed.api.open({ current: '', locale: 'de' });
    await failed.api.map('de').catch(() => undefined);
    await Promise.resolve();
    expect(failed.dialog().querySelector('#internalLinkStatus')!.textContent).toBe(copy.linkTargetsFailed);
    await failed.finish('https://e.test/');
    await expect(failedPending).resolves.toBe('https://e.test/');
  });

  it('returns the server map unchanged and exposes safe destination helpers', async () => {
    const h = setup();
    await expect(h.api.map('de')).resolves.toEqual(catalog.links);
    expect(h.factory.escapeDestination('/my page')).toBe('/my%20page');
    expect(h.factory.escapeDestination('/a)b')).toBe('/a\\)b');
    expect(h.factory.escapeDestination('/a|b')).toBe('/a\\|b');
    expect(h.factory.destinationError('a\nb')).toBe('destination-control');
    expect(h.factory.isEscapedDestination('/a%20b')).toBe(true);
    expect(h.factory.isEscapedDestination('/a b')).toBe(false);
    expect(h.factory.isEscapedDestination('/a\\)b')).toBe(true);
  });

  it('retargets only a link destination and inserts a server-labelled text link', async () => {
    const h = setup(async (url, init) => {
      if (url !== '/internal-links/analyze') return response(catalog);
      const { bodyMarkdown } = JSON.parse(String(init.body)) as { bodyMarkdown: string };
      return response(bodyMarkdown.startsWith('[x](/a/)')
        ? { kind: 'link', link: {
            start: 0, end: 9, labelStart: 1, labelEnd: 2,
            destinationStart: 4, destinationEnd: 6, url: '/a/', removalSafe: true,
          } }
        : { kind: 'text', label: 'Wort' });
    });
    const target: { text: string; replacement: { value: string; from: number; to: number } | null } = {
      text: '[x](/a/)', replacement: null,
    };
    const cm = {
      getValue: () => target.text,
      listSelections: () => [{ anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 2 } }],
      indexFromPos: (position: { ch: number }) => position.ch,
      posFromIndex: (index: number) => ({ line: 0, ch: index }),
      replaceRange(value: string, from: { ch: number }, to: { ch: number }) {
        target.replacement = { value, from: from.ch, to: to.ch };
        target.text = target.text.slice(0, from.ch) + value + target.text.slice(to.ch);
      },
    };
    const linkPending = h.api.markdown(cm, 'de', (message) => h.notices.push(message));
    await ready(h);
    await untilOpen(h);
    await h.finish('/neu/');
    await linkPending;
    expect(target.replacement).toEqual({ value: '/neu/', from: 4, to: 6 });

    target.text = 'Hallo Welt';
    cm.listSelections = () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } }];
    const insertPending = h.api.markdown(cm, 'de', (message) => h.notices.push(message));
    await ready(h);
    await untilOpen(h);
    await h.finish('https://e.test/?q=x]');
    await insertPending;
    expect(target.replacement).toEqual({ value: '[Wort](https://e.test/?q=x])', from: 0, to: 5 });
  });

  it('refuses without a selection and never edits', async () => {
    const h = setup();
    const cm = {
      getValue: () => 'text',
      listSelections: () => [{ anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } }],
      indexFromPos: (position: { ch: number }) => position.ch,
      posFromIndex: (index: number) => ({ line: 0, ch: index }),
      replaceRange() { throw new Error('must not edit'); },
    };
    await h.api.markdown(cm, 'de', (message) => h.notices.push(message));
    expect(h.notices).toEqual([copy.linkSelectText]);
    expect(h.requests).toEqual([]);
    expect(h.dom.document.getElementById('internalLinkDialog')).toBeNull();
  });

  it('wires exactly one Markdown shortcut binding', () => {
    const h = setup();
    const maps: Record<string, unknown>[] = [];
    const cm = { addKeyMap(map: Record<string, unknown>) { maps.push(map); } };
    h.api.wireMarkdown(cm, 'de', () => {});
    expect(maps).toHaveLength(1);
    expect(maps[0]!['Cmd-K']).toBeTypeOf('function');
    expect(maps[0]!['Ctrl-K']).toBeTypeOf('function');

    const fallback: { listeners: ((event: EditorEvent) => void)[] } = { listeners: [] };
    const fallbackCm = { getInputField: () => ({ addEventListener: (_type: string, listener: (event: EditorEvent) => void) => fallback.listeners.push(listener) }) };
    h.api.wireMarkdown(fallbackCm, 'de', () => {});
    expect(fallback.listeners).toHaveLength(1);
  });
});
