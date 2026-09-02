// Camera viewpoints + tours (F9). Pure data models + helpers, saved WITH the
// map file (v2 optional section, like snapshots). A Viewpoint is a named camera
// pose (position + look-at target); a Tour is an ordered list of stops, each
// either a saved viewpoint or a graph node. Neither is command-tracked — they
// are map metadata held on the MapSession and serialized with the file.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Viewpoint {
  id: string;
  name: string;
  position: Vec3;
  target: Vec3;
}

export interface TourStop {
  kind: 'viewpoint' | 'node';
  ref: string; // a Viewpoint id (kind 'viewpoint') or a node id (kind 'node')
}

export interface Tour {
  id: string;
  name: string;
  stops: TourStop[];
}

// Capture a named camera pose. Copies the vectors so a later mutation of the
// caller's objects (View3D reuses THREE.Vector3 instances) cannot reach back in.
export function createViewpoint(name: string, position: Vec3, target: Vec3): Viewpoint {
  return {
    id: crypto.randomUUID(),
    name,
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z }
  };
}

// Build a tour from an ordered stop list. Copies the array + each stop so the
// caller's array is independent of the stored tour.
export function createTour(name: string, stops: TourStop[]): Tour {
  return {
    id: crypto.randomUUID(),
    name,
    stops: stops.map((s) => ({ kind: s.kind, ref: s.ref }))
  };
}

// Advance/retreat a tour index by one, clamped to [0, stops.length-1]. Throws on
// an empty tour (there is no valid index to return).
export function stepTour(tour: Tour, index: number, dir: 1 | -1): number {
  if (tour.stops.length === 0) throw new Error(`empty tour "${tour.name}"`);
  const next = index + dir;
  if (next < 0) return 0;
  const last = tour.stops.length - 1;
  if (next > last) return last;
  return next;
}
