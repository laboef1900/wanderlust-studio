// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { initMapTeaserPills } from './map-teaser-pills';

const SVG = 'http://www.w3.org/2000/svg';

function mount(): { pins: SVGAElement[]; pills: Element[] } {
  const chart = document.createElementNS(SVG, 'svg');
  const pins = [0, 1].map((i) => {
    const pin = document.createElementNS(SVG, 'a');
    pin.setAttribute('class', 'chart-pin');
    pin.setAttribute('href', `/trip-${i}/`);
    pin.dataset.pin = String(i);
    chart.append(pin);
    return pin;
  });
  const pills = [0, 1].map((i) => {
    const pill = document.createElementNS(SVG, 'a');
    pill.setAttribute('class', 'chart-pin-pill-link');
    pill.dataset.pin = String(i);
    chart.append(pill);
    return pill;
  });
  document.body.replaceChildren(chart);
  initMapTeaserPills(chart);
  return { pins, pills };
}

const active = (pills: Element[]) => pills.map((pill) => pill.classList.contains('is-active'));

describe('initMapTeaserPills', () => {
  let pins: SVGAElement[];
  let pills: Element[];
  beforeEach(() => ({ pins, pills } = mount()));

  it('opens only the hovered pin\'s pill and closes it when the pointer leaves', () => {
    pins[1]!.dispatchEvent(new PointerEvent('pointerenter'));
    expect(active(pills)).toEqual([false, true]);
    pins[1]!.dispatchEvent(new PointerEvent('pointerleave'));
    expect(active(pills)).toEqual([false, false]);
  });

  it('keeps a keyboard-focused pin\'s pill open when a pointer passes over and leaves it', () => {
    pins[0]!.dispatchEvent(new FocusEvent('focus'));
    pins[0]!.dispatchEvent(new PointerEvent('pointerenter'));
    pins[0]!.dispatchEvent(new PointerEvent('pointerleave'));
    expect(active(pills)).toEqual([true, false]);
    pins[0]!.dispatchEvent(new FocusEvent('blur'));
    expect(active(pills)).toEqual([false, false]);
  });
});
