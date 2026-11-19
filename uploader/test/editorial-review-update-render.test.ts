// #630 renderer-backed differential check: whatever `LLM.parseArticleUpdate`
// accepts is rendered through the site's real Markdown pipeline and body
// sanitizer, and must keep every heading and anchor (in order), every link
// destination, image and gallery block of the original draft, and emit no new
// active element. A finite corpus and a seeded randomized corpus are regression
// checks, not a proof; a renderer upgrade that adds a new link shape should fail here.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../site/src/lib/render-markdown.js';
import { galleryCode, sanitizedBodyTree, textOf } from '../../site/src/lib/gallery-identity.js';

const source = readFileSync(new URL('../public/llm.js', import.meta.url), 'utf8');
const browser: { LLM?: { parseArticleUpdate(content: unknown, original: string): { markdown: string } } } = {};
new Function('window', source)(browser);
const parseArticleUpdate = browser.LLM!.parseArticleUpdate;

type HastElement = Parameters<typeof galleryCode>[0];
type HastParent = ReturnType<typeof sanitizedBodyTree> | HastElement;

const ACTIVE = ['a', 'img', 'script', 'iframe', 'svg', 'math', 'object', 'embed'];
const RAW_ACTIVE = /<(?:a|img|script|iframe|svg|math|object|embed)[\s>/]/gi;

function elementsOf(parent: HastParent, out: HastElement[] = []): HastElement[] {
  for (const child of parent.children) {
    if (child.type !== 'element') continue;
    out.push(child);
    elementsOf(child, out);
  }
  return out;
}

interface Rendered {
  headings: string[];
  links: string[];
  images: string[];
  galleries: string[];
  active: Record<string, number>;
  raw: number;
}

async function rendered(markdown: string): Promise<Rendered> {
  const html = await renderMarkdown(markdown);
  const out: Rendered = { headings: [], links: [], images: [], galleries: [], active: {}, raw: (html.match(RAW_ACTIVE) ?? []).length };
  for (const element of elementsOf(sanitizedBodyTree(html))) {
    if (/^h[1-6]$/.test(element.tagName)) {
      out.headings.push(element.tagName + '#' + String(element.properties.id ?? '') + ' ' + textOf(element));
    }
    if (element.tagName === 'a') out.links.push(String(element.properties.href ?? ''));
    if (element.tagName === 'img') out.images.push(String(element.properties.src ?? '') + ' ' + String(element.properties.alt ?? ''));
    if (ACTIVE.includes(element.tagName)) out.active[element.tagName] = (out.active[element.tagName] ?? 0) + 1;
    const gallery = galleryCode(element);
    if (gallery) out.galleries.push(textOf(gallery));
  }
  return out;
}

/** Every original heading in order (new ones may be interleaved), and nothing else new. */
async function expectPreserved(original: string, updated: string, label: string): Promise<void> {
  const before = await rendered(original);
  const after = await rendered(updated);
  let next = 0;
  for (const heading of after.headings) {
    if (next < before.headings.length && heading === before.headings[next]) next++;
    else expect(heading.startsWith('h1'), label + ': new H1 ' + heading).toBe(false);
  }
  expect(next, label + ': headings').toBe(before.headings.length);
  expect(after.links, label + ': links').toEqual(before.links);
  expect(after.images, label + ': images').toEqual(before.images);
  expect(after.galleries, label + ': galleries').toEqual(before.galleries);
  expect(after.active, label + ': active elements').toEqual(before.active);
  expect(after.raw, label + ': raw active markup').toBe(before.raw);
}

function accepted(original: string, markdown: string): string | null {
  try {
    return parseArticleUpdate(JSON.stringify({ markdown }), original).markdown;
  } catch {
    return null;
  }
}

const ORIGINAL = [
  '## Getting there',
  '',
  'We took the [coastal bus](https://bus.example/route-7) from town, see [the map][map] or mail hut@alps.example.',
  '',
  '![The harbour at dawn](https://img.example/harbour.jpg)',
  '',
  '```gallery',
  'https://img.example/a.jpg',
  'https://img.example/b.jpg',
  '```',
  '',
  'The stage',
  '---------',
  '',
  '> A quote with <https://quote.example> inside.',
  '',
  '### Day two',
  '',
  'Fish &amp; chips by the pier.',
  '',
  '[map]: https://maps.example/alps',
].join('\n');

const BENIGN_ADDITIONS = [
  '\n\n## Practical details\n\nThe bus runs hourly from May to October. Parking is free; bring 10 EUR in cash.',
  '\n\nPractical notes\n---\n\n- Water at the hut\n- Toilets at the trailhead\n\n1. Start early\n2. Return by 5 pm',
  '\n\n#### Season\n\n**Best** from *June* to ~~August~~ September. Distance: 12.5 km, 800 m ascent, 5 > 3.',
  '\n\n| Day | Distance |\n|---|---|\n| 1 | 12 km |\n| 2 | 9 km |',
  '\n\nPrices: 3 € per person — kids free. Open 08:15–18:00, e.g. on Sundays too.',
];

describe('article update output against the real renderer', () => {
  it('accepts benign practical additions that keep every heading, link, image and gallery', async () => {
    for (const addition of BENIGN_ADDITIONS) {
      const kept = accepted(ORIGINAL, ORIGINAL + addition);
      expect(kept, addition.slice(0, 40)).toBe(ORIGINAL + addition);
      await expectPreserved(ORIGINAL, kept!, addition.slice(0, 40));
    }
    const inline = ORIGINAL.replace('from town,', 'from town (hourly, 4 EUR),');
    expect(accepted(ORIGINAL, inline)).toBe(inline);
    await expectPreserved(ORIGINAL, inline, 'inline');
  });

  it('is not vacuous: the refused rewrites do change what the renderer emits', async () => {
    for (const rewrite of [
      ORIGINAL + '\n\nSee www.evil.example.', ORIGINAL + '\n\nMail info@evil.example.', ORIGINAL + '\n\n<https://evil.example>',
      ORIGINAL + '\n\n![x](https://img.example/x.jpg)', ORIGINAL + '\n\n```gallery\nhttps://img.example/c.jpg\n```',
      ORIGINAL + '\n\nOpen the [map].', ORIGINAL.replace('route-7', 'route-8'), ORIGINAL + '\n\n# New title',
      ORIGINAL + '\n\nNew title\n===', ORIGINAL.replace('## Getting there', '## Arrival'), ORIGINAL + '\n\n> - ```gallery\n>   c.jpg\n>   ```',
      // Regressions found by the randomized corpus: a line run into a reference
      // definition, and a link line re-indented into an indented code block.
      ORIGINAL.replace('[map]: ', 'Note\n[map]: '), ORIGINAL.replace('We took', 'W\n\n\te took'),
    ]) {
      expect(accepted(ORIGINAL, rewrite), rewrite.slice(-40)).toBeNull();
      const before = await rendered(ORIGINAL);
      const after = await rendered(rewrite);
      expect(after, rewrite.slice(-40)).not.toEqual(before);
    }
  });

  it('a seeded randomized corpus of additions never changes protected rendered structure once accepted', async () => {
    // mulberry32: a fixed seed makes every CI run test the same bodies.
    let seed = 0x630a17e5;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const TOKENS = [
      '[', ']', '(', ')', '!', '<', '>', '&', '#', ';', '\\', '@', '.', ':', '/', '|', '`', '*', '_', '~', '"', '=', '^',
      'http', 'https', 'www', 'mailto', 'map', 'example', 'com', 'a', 'b', '42', 'lt', 'amp', 'gallery',
      ' ', ' ', ' ', '\n', '\n', '\n\n', '\t', '    ', '> ', '- ', '1. ', '* ', '```', '~~~', '---', '===', '# ', '## ',
      ' ', '＜', '［', '＠', 'é', '[^1]', '[map]', '](', '![',
    ];
    const lines = ORIGINAL.split('\n');
    const deadline = performance.now() + 20000;
    let cases = 0;
    let kept = 0;
    const failures: string[] = [];
    while (cases < 3000 && performance.now() < deadline) {
      cases++;
      let addition = '';
      const length = 1 + Math.floor(random() * 30);
      for (let i = 0; i < length; i++) addition += TOKENS[Math.floor(random() * TOKENS.length)];
      // Half whole new lines, half edits inside an existing line (how a model rewrites a paragraph).
      const midLine = random() < 0.5;
      const at = Math.floor(random() * ((midLine ? ORIGINAL.length : lines.length) + 1));
      const candidate = midLine
        ? ORIGINAL.slice(0, at) + addition + ORIGINAL.slice(at)
        : [...lines.slice(0, at), addition, ...lines.slice(at)].join('\n');
      const ok = accepted(ORIGINAL, candidate);
      if (ok === null) continue;
      kept++;
      try {
        await expectPreserved(ORIGINAL, ok, JSON.stringify(addition));
      } catch (error) {
        failures.push(JSON.stringify(addition) + ' @' + at + ' → ' + (error as Error).message.split('\n')[0]);
      }
    }
    expect(failures).toEqual([]);
    expect(cases).toBeGreaterThanOrEqual(300);
    expect(kept).toBeGreaterThanOrEqual(50);
  }, 60000);
});
