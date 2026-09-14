/**
 * Altium schematic geometry, in integer scaled units.
 *
 * Every coordinate and size a record carries is read here, so the net extractor,
 * the bus code and the harness code place objects identically.
 */

export type Point = [number, number];

/** Scaled units per schematic unit; `_Frac` fields count hundred-thousandths. */
export const COORDINATE_SCALE = 100000;

/** How far apart two points may be and still touch: 0.5 units. Imported designs meet up to 0.315 apart. */
export const TOUCH_TOLERANCE = COORDINATE_SCALE / 2;

/** Units per `DistanceFromTop` step along a sheet symbol or harness connector edge. */
const ENTRY_PITCH = 10;

/** Denominator of `DistanceFromTop_Frac1`. */
const ENTRY_FRACTION_SCALE = 1_000_000;

type Fields = Readonly<Record<string, unknown>>;

export const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A field under its written key or its upper-case form, which older files use. */
export const field = (record: Fields, key: string): unknown =>
  record[key] ?? record[key.toUpperCase()];

/** A coordinate or size `key` plus its `key_Frac`, in scaled units. */
export const scaledField = (record: Fields, key: string): number =>
  Math.round(
    toNumber(field(record, key)) * COORDINATE_SCALE + toNumber(field(record, `${key}_Frac`))
  );

/** A record's `Location`, or another point such as `Corner`. */
export const scaledPoint = (record: Fields, key = "Location"): Point => [
  scaledField(record, `${key}.X`),
  scaledField(record, `${key}.Y`),
];

/** A polyline's vertices, `X1,Y1` to `Xn,Yn`. */
export const polylinePoints = (record: Fields): Point[] =>
  Object.keys(record)
    .map((key) => key.match(/^X(\d+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => parseInt(match[1], 10))
    .sort((a, b) => a - b)
    .map((index) => [scaledField(record, `X${index}`), scaledField(record, `Y${index}`)]);

/** How far along its edge an entry sits, from `DistanceFromTop` and `DistanceFromTop_Frac1`. */
export const entryOffset = (entry: Fields): number =>
  Math.round(
    (toNumber(field(entry, "DistanceFromTop")) +
      toNumber(field(entry, "DistanceFromTop_Frac1")) / ENTRY_FRACTION_SCALE) *
      ENTRY_PITCH *
      COORDINATE_SCALE
  );

/**
 * A point on an edge of a box drawn down and right from its `Location`: `side` 0 left,
 * 1 right, 2 top, 3 bottom; `offset` runs down a vertical edge and right along a
 * horizontal one.
 */
export const edgePoint = (box: Fields, side: string, offset: number): Point => {
  const [x, y] = scaledPoint(box);
  switch (side) {
    case "1":
      return [x + scaledField(box, "XSize"), y - offset];
    case "2":
      return [x + offset, y];
    case "3":
      return [x + offset, y - scaledField(box, "YSize")];
    default:
      return [x, y - offset];
  }
};

/** Where a sheet entry sits on its sheet symbol, on the edge its `Side` names. */
export const sheetEntryPoint = (symbol: Fields, entry: Fields): Point =>
  edgePoint(symbol, String(field(entry, "Side") ?? "0"), entryOffset(entry));

/** A port's two ends: a bar `Width` long, rightward, or upward for `Style` 4 and above. */
export const portEnds = (port: Fields): [Point, Point] => {
  const [x, y] = scaledPoint(port);
  const width = scaledField(port, "Width");
  return [[x, y], toNumber(field(port, "Style")) >= 4 ? [x, y + width] : [x + width, y]];
};

export const pointsTouch = (a: Readonly<Point>, b: Readonly<Point>): boolean =>
  Math.abs(a[0] - b[0]) <= TOUCH_TOLERANCE && Math.abs(a[1] - b[1]) <= TOUCH_TOLERANCE;

/** Whether a point lies within TOUCH_TOLERANCE of a segment. */
export const pointOnSegment = (
  point: Readonly<Point>,
  [start, end]: readonly [Readonly<Point>, Readonly<Point>]
): boolean => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return pointsTouch(point, start);
  const cross = dx * (point[1] - start[1]) - dy * (point[0] - start[0]);
  if (cross * cross > TOUCH_TOLERANCE * TOUCH_TOLERANCE * lengthSquared) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - TOUCH_TOLERANCE &&
    point[0] <= Math.max(start[0], end[0]) + TOUCH_TOLERANCE &&
    point[1] >= Math.min(start[1], end[1]) - TOUCH_TOLERANCE &&
    point[1] <= Math.max(start[1], end[1]) + TOUCH_TOLERANCE
  );
};
