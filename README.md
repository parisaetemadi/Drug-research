# The Medicine Market

A visual explainer of the drug industry: how a molecule gets from a screening
library to a pharmacy shelf, who owns each step, and where the supply is thin.

Nine sections, one chart each:

| | |
| --- | --- |
| **01 · The chain, end to end** | The nine layers, from tools and reagents up through biotech, big pharma and distribution |
| **02 · What each layer is worth** | A treemap of market value, scaled by how much of each company is actually a medicines business |
| **03 · The ten-year gauntlet** | Attrition and duration through Phase 1, 2, 3 and review |
| **04 · Where the supply is thin** | Single-country and single-supplier concentration for specific ingredients |
| **05 · Made everywhere, invented somewhere** | API manufacturing sites against the origin of new drug programmes |
| **06 · What one medicine costs** | US list prices, from $4 to $4.25 million, on a log scale |
| **07 · How long the monopoly lasts** | The patent clock against regulatory exclusivity, on one axis |
| **08 · What stops them charging anything** | Medicare's first negotiated prices, and how other countries do it |

Plain HTML, CSS and JavaScript. No framework, no build step, no chart library —
the treemap is a hand-written squarify and everything else is SVG drawn directly.

## Where the numbers come from

Everything in `data/` is either a curated figure with a named source, or fetched.

- **Curated** — `layers.json`, `companies.json`, `gauntlet.json`, `trials.json`,
  `chokepoints.json`, `geography.json`, `prices.json`, `exclusivity.json`,
  `pricing.json`. Each file carries a `sources` array, and those strings are what
  the page prints in its own footer. Editing a number means editing its source
  alongside it.
- **Approximate** — `marketcaps.json`. Market values here are rounded
  order-of-magnitude figures, not quotes, and the market-value section says so
  on the chart itself in a box you cannot miss. A treemap of provisional numbers
  looks exactly like a real one, so that caveat does not live in a footnote.

### Why there is no live market feed

Market capitalisation and the income statement come from Yahoo's `v7/quote` and
`v10/quoteSummary` endpoints. Yahoo answers both with **429 for GitHub's
runners** — every call, across five attempts with backoff and a freshly minted
session — so no scheduled job can produce them. The `v8/finance/chart` endpoint
is unaffected but returns only a price.

Cloudflare reaches Yahoo from addresses it will serve, so the private dashboard
that also renders this research gets live figures from a Pages function. That
function sits on a private origin behind an access policy and sends no CORS
headers, so this page cannot read it.

If you want live values here, the options are a keyed API (FMP, Finnhub) or a
public proxy of your own. Until then the numbers are honest about being
approximate.

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

The repository is a static site with no build step and no Actions, so any static
host serves it as-is. Two that need no configuration beyond pointing at this repo:

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
- The exclusivity timeline uses a typical 11 years from filing to approval. Real
  programmes range from about 10 to 13, and a fast-tracked drug can be quicker.
- The negotiated Medicare prices are real and in effect, but they apply only to
  Medicare, only to selected drugs, and only years after launch.
- Nothing here is investment advice or medical advice.
