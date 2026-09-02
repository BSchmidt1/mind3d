import { describe, expect, test } from 'vitest';
import {
  createViewpoint,
  createTour,
  stepTour,
  type Tour,
  type TourStop,
  type Vec3
} from '../src/renderer/src/core/viewpoint';

const pos: Vec3 = { x: 1, y: 2, z: 3 };
const tgt: Vec3 = { x: 4, y: 5, z: 6 };

describe('createViewpoint', () => {
  test('sets a uuid + fields', () => {
    const vp = createViewpoint('front', pos, tgt);
    expect(typeof vp.id).toBe('string');
    expect(vp.id.length).toBeGreaterThan(0);
    expect(vp.name).toBe('front');
    expect(vp.position).toEqual(pos);
    expect(vp.target).toEqual(tgt);
  });

  test('two viewpoints get distinct ids', () => {
    expect(createViewpoint('a', pos, tgt).id).not.toBe(createViewpoint('b', pos, tgt).id);
  });

  test('copies the vectors (mutating input later does not change the viewpoint)', () => {
    const p = { x: 1, y: 1, z: 1 };
    const t = { x: 2, y: 2, z: 2 };
    const vp = createViewpoint('vp', p, t);
    p.x = 99;
    t.z = 99;
    expect(vp.position).toEqual({ x: 1, y: 1, z: 1 });
    expect(vp.target).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe('createTour', () => {
  test('sets a uuid + name + stops', () => {
    const tour = createTour('walk', [
      { kind: 'viewpoint', ref: 'v1' },
      { kind: 'node', ref: 'n1' }
    ]);
    expect(typeof tour.id).toBe('string');
    expect(tour.name).toBe('walk');
    expect(tour.stops).toEqual([
      { kind: 'viewpoint', ref: 'v1' },
      { kind: 'node', ref: 'n1' }
    ]);
  });

  test('copies the stops array (later push to the source does not change the tour)', () => {
    const stops: TourStop[] = [{ kind: 'viewpoint', ref: 'v1' }];
    const tour = createTour('walk', stops);
    stops.push({ kind: 'node', ref: 'n2' });
    expect(tour.stops).toHaveLength(1);
  });
});

describe('stepTour', () => {
  const tour: Tour = {
    id: 't',
    name: 'three',
    stops: [
      { kind: 'viewpoint', ref: 'a' },
      { kind: 'viewpoint', ref: 'b' },
      { kind: 'viewpoint', ref: 'c' }
    ]
  };

  test('moves within range', () => {
    expect(stepTour(tour, 0, 1)).toBe(1);
    expect(stepTour(tour, 2, -1)).toBe(1);
    expect(stepTour(tour, 1, 1)).toBe(2);
  });

  test('clamps at the low end', () => {
    expect(stepTour(tour, 0, -1)).toBe(0);
  });

  test('clamps at the high end', () => {
    expect(stepTour(tour, 2, 1)).toBe(2);
  });

  test('empty tour throws', () => {
    expect(() => stepTour({ id: 't', name: 'empty', stops: [] }, 0, 1)).toThrow(/empty tour/);
  });
});
