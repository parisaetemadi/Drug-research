#!/usr/bin/env python3
"""Turn a Natural Earth country outline set into the two SVG paths the map
section draws: one faint path for every landmass, and one path per country
that hosts a company so it can be tinted.

Run: python3 tools/build-world.py <world.geojson> > data/world.json
The source is Natural Earth 1:110m, public domain. Regenerating is only
needed if the country list changes.
"""
import json, sys

SRC = sys.argv[1]
# Equirectangular. Antarctica and the far north are cropped: no company is
# there and the projection stretches both beyond recognition.
LON0, LON1 = -168.0, 180.0
LAT0, LAT1 = -56.0, 78.0
W = 1000.0
H = W * (LAT1 - LAT0) / (LON1 - LON0)

# Countries drawn in colour, keyed by the name this page uses.
HIGHLIGHT = {
    "United States": "USA",
    "Switzerland": "Switzerland",
    "Germany": "Germany",
    "France": "France",
    "United Kingdom": "England",   # this set carries Great Britain as "England"
    "Ireland": "Ireland",
    "Netherlands": "Netherlands",
    "Italy": "Italy",
    "Denmark": "Denmark",
    "China": "China",
    "Japan": "Japan",
    "South Korea": "South Korea",
    "India": "India",
    "Israel": "Israel",
}
DROP = {"Antarctica", "Greenland", "French Southern and Antarctic Lands"}


def project(lon, lat):
    x = (lon - LON0) / (LON1 - LON0) * W
    y = (LAT1 - lat) / (LAT1 - LAT0) * H
    return x, y


def simplify(pts, tol):
    """Douglas-Peucker, iterative so a long coastline cannot blow the stack."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        worst, at = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / den
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > worst:
                worst, at = d, k
        if worst > tol * tol:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(pts, keep) if k]


def rings(geom):
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"][0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def path_for(geom, tol, min_area):
    out = []
    for ring in rings(geom):
        pts = [project(lon, lat) for lon, lat in ring
               if LAT0 - 6 <= lat <= LAT1 + 6]
        if len(pts) < 4:
            continue
        pts = simplify(pts, tol)
        if len(pts) < 4 or area(pts) < min_area:
            continue
        out.append("M" + "L".join("%.1f %.1f" % p for p in pts) + "Z")
    return "".join(out)


src = json.load(open(SRC))
byname = {f["properties"]["name"]: f["geometry"] for f in src["features"]}

land = []
for name, geom in byname.items():
    if name in DROP:
        continue
    p = path_for(geom, 1.1, 3.0)
    if p:
        land.append(p)

hi = {}
for label, key in HIGHLIGHT.items():
    if key not in byname:
        sys.exit("missing country in source: %s" % key)
    hi[label] = path_for(byname[key], 0.8, 1.5)

json.dump({
    "note": "Country outlines simplified from Natural Earth 1:110m (public domain), "
            "projected equirectangular into a %d x %d box. Rebuild with tools/build-world.py."
            % (W, round(H)),
    "width": round(W), "height": round(H),
    "lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1,
    "land": "".join(land),
    "countries": hi,
}, sys.stdout, ensure_ascii=False)
