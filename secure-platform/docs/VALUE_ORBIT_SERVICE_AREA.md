# VALUE orbit → service-area visual (platform capability)

**MavericksATeam #67 · hbexperts-site prototype**  
North Star: What is best for the buyer?

## Goal

A calm Earth-from-orbit → brokerage region → approved service-area orientation layer that is **tenant configuration**, not a rewrite per brokerage.

## Smallest reusable seam (HBE Buyer Journey)

| Surface | Path | Why |
|---|---|---|
| Public Buyer Journey landing | Worker `GET /` (`ui-worker` explorer + outer middleware) | First orientation moment; CTAs already stable |
| Injection point | Decorative layer **behind** hero / above actions, `pointer-events: none` on the canvas | CTA works even if animation fails |
| Module | `secure-platform/src/value-orbit/` | Isolated; optional enhance on `/` only |

**Not** wired into Buyer Experience questionnaire, Buyer Portal, or HBEUI — keeps BuyerUI/HBEUI boundaries clean.

## Lightest viable stack (recommendation)

| Need | Choice | Why |
|---|---|---|
| Orbit background | CSS gradients + lightweight SVG globe (no WebGL) | Mobile-safe; no asset purchase; no cloud map SDK |
| Region resolve | CSS transform / opacity stages driven by config labels | “Zoom” metaphor without Cesium/Mapbox cost |
| Service area | SVG ellipse or simple polygon from config (approx) | No drive-time API; label as approximate |
| Reduced motion | `prefers-reduced-motion: reduce` → static end-frame | Required accessibility |
| Low power / fail | Static fallback card always in DOM; animation progressive | CTA never gated |
| Future upgrade (optional, needs approval) | MapLibre / Cesium only if Jeebs/Sebastian approve cloud/asset spend | Out of scope for v1 |

**Do not use for v1:** WebGL Earth libraries, paid imagery tiles, geolocation, analytics beacons.

## Config schema

See `src/value-orbit/schema.json` and tenant example `src/value-orbit/tenants/hbe.json`.

Core fields:

- `brokerage_id`, `display_name`
- `center` `{ lat, lng }`
- `service_area_mode`: `drive_time` | `counties` | `radius` | `custom_polygon`
- `service_area` (mode-specific value)
- `public_label`, `fallback_region`
- `approx_disclaimer` (required when mode implies imprecise geography)

**Component core never hard-codes Akron/Ohio** — only the HBE tenant JSON does.

## Tenant isolation + config ownership

| Concern | Approach |
|---|---|
| Isolation | One tenant JSON per brokerage; runtime loads **current host tenant only** (HBE = bundled `hbe.json` for prototype) |
| Ownership | Platform schema owned by VALUE/Forge; brokerage geography owned by brokerage ops / Jeebs approval |
| Leakage | No multi-tenant list in client HTML; no cross-brokerage coords in one page |
| Future | Worker binding / KV `TENANT_ID` → fetch config; still no shared client payload |

## Performance + fallback

1. **Static HTML fallback** always present (region label + approximate service area text).
2. **CSS animation** only if `matchMedia('(prefers-reduced-motion: no-preference)')`.
3. **No network** for globe imagery in v1 (pure CSS/SVG).
4. **CTA** (`Start My Buyer Experience`) remains normal document flow; visual is non-blocking.
5. Cap animation length (~6s) then settle on service-area frame.

## Fair Housing / anti-steering

- No demographic, school, crime, or “desirability” overlays
- No neighborhood ranking or heatmaps
- Geography = brokerage **approved service area** orientation only
- Approximate labels when not a legal/survey boundary

## Blockers needing Jeebs / Sebastian

1. Approval to use any **paid / cloud map** or third-party Earth imagery later
2. Canonical **approved HBE service-area** polygon/counties list (ops truth vs ~1hr approximation)
3. Multi-tenant `TENANT_ID` source of truth when a second brokerage exists
4. Whether orbit visual also appears on public Hugo homepage (out of this Worker prototype)

## Prototype status

HBE-first enhance on Worker `/` via `enhanceJourneyWithOrbit`. Reversible: remove one call + module. **No merge/deploy assumed by Forge.**
