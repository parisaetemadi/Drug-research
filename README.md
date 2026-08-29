# The Medicine Market

A visual explainer of the drug industry: how a molecule gets from a screening
library to a pharmacy shelf, who owns each step, and where the supply is thin.

Six sections, one chart each:

| | |
| --- | --- |
| **01 · The chain, end to end** | The nine layers, from tools and reagents up through biotech, big pharma and distribution |
| **02 · What each layer is worth** | A treemap of market value, scaled by how much of each company is actually a medicines business |
| **03 · The ten-year gauntlet** | Attrition and duration through Phase 1, 2, 3 and review |
| **04 · Where the supply is thin** | Single-country and single-supplier concentration for specific ingredients |
| **05 · Made everywhere, invented somewhere** | API manufacturing sites against the origin of new drug programmes |
| **06 · What one medicine costs** | US list prices, from $4 to $4.25 million, on a log scale |

Plain HTML, CSS and JavaScript. No framework, no build step, no chart library —
the treemap is a hand-written squarify and everything else is SVG drawn directly.

## Where the numbers come from

Everything in `data/` is either a curated figure with a named source, or fetched.

- **Curated** — `layers.json`, `companies.json`, `gauntlet.json`, `chokepoints.json`,
  `geography.json`, `prices.json`. Each file carries a `sources` array, and those
  strings are what the page prints in its own footer. Editing a number means
  editing its source alongside it.
- **Fetched** — `marketcaps.json`, written by `scripts/fetch-marketcaps.mjs` and
  committed by the workflow in `.github/workflows/marketcaps.yml`. It runs on
  weekdays after the US close, and on any push that changes the company list.

The fetch script asks Yahoo Finance for market value, trailing revenue, net
income and margins for every ticker in `companies.json`, converts each into
dollars, and refuses to write the file if fewer than 60% of the companies priced
— a bad run leaves yesterday's numbers alone rather than half-emptying the chart.
Companies it could not price are listed in `missing` and left off the treemap,
and the page says how many.

Until that job has run for the first time, `marketcaps.json` is a placeholder and
the market-value section says so on the chart itself, in a box you cannot miss.
A treemap of made-up numbers looks exactly like a real one, so the caveat does
not live in a footnote.

### The `share` field

A conglomerate is not counted whole. `share` in `companies.json` is the fraction
of the company that is a medicines business: Johnson & Johnson at 0.65 because
MedTech is not one, Bayer at 0.45 because crop science is not either. Market
value and revenue are both multiplied by it, and the hover card says when a
company is being counted at less than 100%.

## Running it

Any static server — the page fetches its own data files, so `file://` will not work.

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Publishing

The repository is a static site with no build step, so any static host serves it
as-is. Two that need no configuration beyond pointing at this repo:

- **GitHub Pages** — Settings → Pages → Build and deployment → Source: *Deploy from
  a branch*, branch `main`, folder `/ (root)`.
- **Cloudflare Pages** — Create → Pages → Connect to Git → this repo. Framework
  preset *None*, build command empty, output directory `/`.

## Caveats worth keeping

- The line between *biotech* and *big pharma* is a judgement, not a legal category.
- Section 05's two columns come from different sources counting different things.
  They are placed side by side for contrast, not to be subtracted.
- Chokepoint shares are published estimates. Read them as ±5 points.
- List prices are not what anyone pays.
- Nothing here is investment advice or medical advice.
