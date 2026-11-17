import { describe, expect, it } from 'vitest';
import { editorDocument, type EditorElement } from './editor-dom-harness.js';

// Text nodes as strings, elements as { TAG: children }: a split text run and a
// joined one differ, which textContent alone would hide.
type Shape = string | { [tag: string]: Shape[] };
const shape = (node: EditorElement): Shape[] => node.childNodes.map((child) => child.tagName === '#TEXT' ? child.textContent : { [child.tagName]: shape(child) });
const parse = (markup: string) => editorDocument('<body>' + markup + '</body>');
const tree = (markup: string) => shape(parse(markup).document.body!);

describe('harness markup parser: comments and scripts', () => {
  it('leaves no node for a comment and keeps the text run around it whole', () => {
    expect(tree('a<!-- x -->b')).toEqual(['ab']);
    expect(tree('<p>a<!-- <i>x</i> -->b</p>')).toEqual([{ P: ['ab'] }]);
  });

  it('decodes the joined run once, so an entity split by a comment still decodes', () => {
    expect(tree('&am<!-- -->p;')).toEqual(['&']);
    expect(tree('&am<script>x</script>p;')).toEqual(['&']);
  });

  it('leaves no node for a terminated script and keeps the text run around it whole', () => {
    const doc = parse('a<script>var x = "<b>";</script>b');
    expect(shape(doc.document.body!)).toEqual(['ab']);
    expect(doc.document.querySelector('script')).toBeNull();
    expect(doc.document.querySelector('b')).toBeNull();
  });

  it('skips script tags in any ASCII case and with attributes', () => {
    const doc = parse('x<SCRIPT type="module">1</SCRIPT>y<ScRiPt src=\'/a.js\'>2</sCRIPT>z');
    expect(shape(doc.document.body!)).toEqual(['xyz']);
    expect(doc.scripts).toEqual([{ src: null, text: '1' }, { src: '/a.js', text: '2' }]);
  });

  it('ends a script only at an exact end tag: </script > does not end it', () => {
    expect(tree('<div><script>a</script >b</div>')).toEqual([{ DIV: [{ SCRIPT: ['a'] }, 'b'] }]);
    expect(parse('<div><script>a</script >b</div>').scripts).toEqual([]);
    expect(tree('<script>a</script >b</script>c')).toEqual(['c']);
  });

  it('lists scripts in document order with decoded src and raw text', () => {
    const { scripts } = parse([
      '<script src="/a.js?x=1&amp;y=2"></script>',
      '<p>between</p>',
      '<script>if (a < b && "</p>") { f("&amp;"); }</script>',
      '<script src=/c.js defer>c</script>',
      '<script data-src="/nope.js">d</script>',
    ].join(''));
    expect(scripts).toEqual([
      { src: '/a.js?x=1&y=2', text: '' },
      { src: null, text: 'if (a < b && "</p>") { f("&amp;"); }' },
      { src: '/c.js', text: 'c' },
      { src: null, text: 'd' },
    ]);
  });

  it('keeps today\'s result for a comment that starts as <!-->', () => {
    expect(tree('<!-->a-->b')).toEqual(['b']);
  });

  it('keeps today\'s result for an unterminated comment: it is dropped up to the next >', () => {
    expect(tree('a<!-- b<i>c</i>d')).toEqual(['a', 'c', 'd']);
  });

  it('keeps today\'s result for an unterminated script: it stays an element and what follows stays visible', () => {
    const doc = parse('<script>a<b>c</b>d');
    expect(shape(doc.document.body!)).toEqual([{ SCRIPT: ['a', { B: ['c'] }, 'd'] }]);
    expect(doc.scripts).toEqual([]);
  });
});

describe('harness markup parser: what ends a text run', () => {
  it('splits text at an end tag, a <! token and a dropped <', () => {
    expect(tree('a<!x>b')).toEqual(['a', 'b']);
    expect(tree('a</i>b')).toEqual(['a', 'b']);
    expect(tree('a<>b')).toEqual(['a', '>b']);
  });
});

describe('harness markup parser: markup is never joined or eaten across removed pieces', () => {
  it('keeps the markup after a script whose content holds a comment opener', () => {
    expect(tree('<script>a<!--</script>b-->c')).toEqual(['b-->c']);
  });

  it('never joins the pieces around a script into a script tag', () => {
    const doc = parse('<scr<script></script>ipt>x');
    expect(doc.document.querySelector('script')).toBeNull();
    expect(doc.document.querySelector('scr')).not.toBeNull();
  });

  it('never joins the pieces around a comment into a new comment', () => {
    expect(tree('<!<!-- -->-- -->x')).toEqual(['-- -->x']);
  });

  it('never joins the pieces around a comment into a tag', () => {
    const doc = parse('a<<!-- -->b>c');
    expect(doc.document.querySelector('b')).toBeNull();
    expect(shape(doc.document.body!)).toEqual(['a', 'b>c']);
  });

  it('treats <script-x> as an ordinary element, not a script', () => {
    expect(tree('<script-x>a</script>b')).toEqual([{ 'SCRIPT-X': ['a', 'b'] }]);
  });

  it('keeps a comment delimiter inside a tag token', () => {
    const doc = parse('<a title="<!-- x -->">t</a>');
    expect(doc.document.body!.textContent).toBe('">t');
    expect(doc.document.querySelector('a')!.getAttribute('title')).toContain('<!--');
  });

  it('keeps a terminated script inside a tag token', () => {
    const doc = parse('<a title="<script>x</script>">t</a>');
    expect(doc.document.body!.textContent).toBe('x">t');
    expect(doc.document.querySelector('a')!.getAttribute('title')).toContain('<script');
  });
});

describe('harness markup parser: innerHTML', () => {
  it('parses assigned markup the same way and replaces the old children', () => {
    const host = parse('<div>old</div>').document.createElement('div');
    host.innerHTML = 'old';
    host.innerHTML = 'a<!-- x -->b<script>x</script>c<p>d</p>';
    expect(shape(host)).toEqual(['abc', { P: ['d'] }]);
    expect(host.querySelector('script')).toBeNull();
  });

  it('splits and decodes like a page load', () => {
    const host = parse('').document.createElement('div');
    host.innerHTML = '&am<!-- -->p;<!x>b';
    expect(shape(host)).toEqual(['&', 'b']);
  });
});
