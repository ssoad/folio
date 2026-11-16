// Shape recognition for ink: a stroke drawn and then held still at its end
// becomes the clean shape it looks like (as in notes apps) — a straight
// line, an ellipse or circle, a triangle, a rectangle (squared up when its
// sides are nearly level) or a polygon. Anything else stays as drawn.
//
// Points are flat x, y pairs in any one unit (the caller passes page
// pixels, so shapes aren't skewed by the page's aspect ratio).

type Point = { x: number; y: number };

const toPoints = (flat: number[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push({ x: flat[i], y: flat[i + 1] });
  }
  return out;
};
const toFlat = (points: Point[]) => points.flatMap((p) => [p.x, p.y]);

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const pathLength = (points: Point[]) =>
  points.reduce((sum, p, i) => (i ? sum + distance(points[i - 1], p) : 0), 0);

// Ramer–Douglas–Peucker: the corners of a hand-drawn polygon
const simplify = (points: Point[], epsilon: number): Point[] => {
  if (points.length < 3) return points;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
};

// Evenly spaced points along straight edges, for drawing and erasing
const alongEdges = (corners: Point[], closed: boolean, step: number) => {
  const out: Point[] = [];
  const edges = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const n = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let k = 0; k < n; k++) {
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        y: a.y + ((b.y - a.y) * k) / n,
      });
    }
  }
  out.push(closed ? corners[0] : corners[corners.length - 1]);
  return out;
};

const ellipsePoints = (cx: number, cy: number, rx: number, ry: number) => {
  const n = Math.max(24, Math.ceil((Math.PI * (rx + ry)) / 4));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
};

export type ShapeName =
  "line" | "circle" | "ellipse" | "triangle" | "rectangle" | "polygon";

export const recognizeShape = (
  flat: number[]
): { shape: ShapeName; points: number[] } | null => {
  const points = toPoints(flat);
  if (points.length < 4) return null;
  const length = pathLength(points);
  if (length < 24) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  const step = Math.max(2, diagonal / 60);

  // A line: every point close to the line from start to end
  const straightness = Math.max(
    ...points.map((p) => segmentDistance(p, start, end))
  );
  if (
    distance(start, end) > length * 0.8 &&
    straightness < Math.max(4, distance(start, end) * 0.06)
  ) {
    // Nearly level or upright lines snap to it
    let to = end;
    const angle = Math.abs(Math.atan2(end.y - start.y, end.x - start.x));
    if (angle < 0.09 || Math.abs(angle - Math.PI) < 0.09)
      to = { x: end.x, y: start.y };
    else if (Math.abs(angle - Math.PI / 2) < 0.09)
      to = { x: start.x, y: end.y };
    return {
      shape: "line",
      points: toFlat(alongEdges([start, to], false, step)),
    };
  }

  // Closed shapes end near where they started
  if (distance(start, end) > Math.max(diagonal * 0.25, 12)) return null;

  // Polygons first: an ellipse can't have sharp corners
  const corners = simplify(points, diagonal * 0.07);
  // The closing point duplicates the first
  if (
    corners.length > 2 &&
    distance(corners[0], corners[corners.length - 1]) < diagonal * 0.2
  ) {
    corners.pop();
  }
  // Each corner must turn sharply, or the "polygon" is a rounded curve
  const isSharp = (i: number) => {
    const a = corners[(i - 1 + corners.length) % corners.length];
    const b = corners[i];
    const c = corners[(i + 1) % corners.length];
    const v1 = Math.atan2(a.y - b.y, a.x - b.x);
    const v2 = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(v1 - v2);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return turn < 2.4; // under ~137°
  };
  const polygonError =
    corners.length >= 3
      ? points.reduce((sum, p) => {
          let best = Infinity;
          for (let i = 0; i < corners.length; i++) {
            best = Math.min(
              best,
              segmentDistance(p, corners[i], corners[(i + 1) % corners.length])
            );
          }
          return sum + best;
        }, 0) /
        points.length /
        diagonal
      : Infinity;

  // Ellipse fitted to the bounding box
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const ellipseError =
    rx > 2 && ry > 2
      ? points.reduce((sum, p) => {
          const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
          return sum + Math.abs(r - 1);
        }, 0) / points.length
      : Infinity;

  const isPolygon =
    corners.length >= 3 &&
    corners.length <= 8 &&
    corners.every((_, i) => isSharp(i)) &&
    polygonError < 0.035;

  if (isPolygon && (polygonError < ellipseError * 0.6 || ellipseError > 0.1)) {
    if (corners.length === 4) {
      // Nearly level sides: a squared-up rectangle
      const level = corners.every((c, i) => {
        const n = corners[(i + 1) % 4];
        const a = Math.abs(Math.atan2(n.y - c.y, n.x - c.x)) % (Math.PI / 2);
        return a < 0.2 || a > Math.PI / 2 - 0.2;
      });
      if (level) {
        const box = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ];
        return {
          shape: "rectangle",
          points: toFlat(alongEdges(box, true, step)),
        };
      }
    }
    return {
      shape:
        corners.length === 3
          ? "triangle"
          : corners.length === 4
            ? "rectangle"
            : "polygon",
      points: toFlat(alongEdges(corners, true, step)),
    };
  }
  if (ellipseError < 0.13) {
    // Nearly round: a circle
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) {
      const r = (rx + ry) / 2;
      return { shape: "circle", points: toFlat(ellipsePoints(cx, cy, r, r)) };
    }
    return { shape: "ellipse", points: toFlat(ellipsePoints(cx, cy, rx, ry)) };
  }
  return null;
};
