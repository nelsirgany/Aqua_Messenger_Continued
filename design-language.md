# Aqua Messenger Design Language

Product: **Aqua Messenger**, a retrofit sensor that reports when a fire hydrant is opened, struck, or failing.
Buyer: NYC DEP (owns the hydrants and the budget). Secondary reader: FDNY.
Surfaces: the existing marketing site, and a new operations console at `/console`.

The marketing site is decent and stays. This document governs the console, and pulls the site toward it over time.

> **Battery has since been removed from the product.** The device health queue no longer shows a battery reading or state — see section 7 and 8 below, which still describe it.

---

## 1. The brief in one line

Municipal infrastructure software. It should look like something DEP already owns, printed on a plan sheet, not like a startup dashboard.

## 2. Palette

Fixed by the brief. Five values, no others.

| Token | Hex | Use |
|---|---|---|
| `--navy` | `#0B1F3A` | Primary. Headers, display type, map base, inverted panels. |
| `--blue` | `#4A6E93` | Desaturated. Water state, active elements, chart fills. |
| `--grey` | `#8A939C` | Labels, units, rules, unmonitored assets. |
| `--white` | `#FFFFFF` | Page background, panel surfaces. |
| `--black` | `#05080C` | Body type, and critical-state fills. |

Two supporting tints derived from the above, allowed because they are the same hues:

| `--mist` | `#EEF1F4` | Panel background, table zebra, disabled map pins. |
| `--rule` | `#D5DBE1` | Hairlines. |

**There is no alert color.** This is the constraint that shapes the whole console, and it is a better system than red would have been. Severity is encoded by **inversion and weight**, never by hue:

- **Normal**: white panel, black type, `--rule` border.
- **Warning**: white panel, `--navy` 2px left edge, label in `--navy` uppercase.
- **Critical**: fully inverted. `--black` fill, white type, no border.

A critical fault is the only black rectangle on the screen. It reads from across a room, it survives a projector with bad color, and it works for a colorblind reviewer. Say that out loud if a judge asks about the palette, because "we encode severity structurally rather than by color" is a real accessibility argument.

## 3. Type

- **Display: Barlow Condensed 700**, uppercase, `0.03em`. Section heads, hydrant IDs, tab labels. Reads as engineering drawing lettering.
- **Body: Public Sans 400 / 600.** This is the US Web Design System typeface, used across federal government sites. Choosing it for a product sold to a city agency is not decoration, it is signalling that this belongs in that world.
- **Data: Roboto Mono 500**, `tabular-nums` mandatory. Every voltage, duration, gallon figure, coordinate, and timestamp.

```
display-xl  clamp(2.25rem, 5vw, 3.75rem)  Barlow Condensed 700
display-l   1.5rem                        Barlow Condensed 700
eyebrow     0.6875rem uppercase 0.14em    Barlow Condensed 700, --grey
body        0.9375rem / 1.5               Public Sans 400
label       0.75rem uppercase 0.06em      Public Sans 600, --grey
data-xl     2.5rem                        Roboto Mono 500
data        1rem                          Roboto Mono 500
data-sm     0.8125rem                     Roboto Mono 500
```

## 4. Geometry

- Border radius `0`. This is a plan sheet, not a card UI. The marketing site can keep its radius; the console has none.
- Hairlines `1px solid var(--rule)`. No shadows anywhere.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Console layout is full-bleed with a 16px gutter. Map left, detail panel right, 60/40 on desktop, stacked on mobile with the map at 40vh.

## 5. Signature element: the barrel glyph

A small vertical section drawing of a dry-barrel hydrant, inline SVG, roughly 24 by 56px. Bonnet, upper barrel, ground line, lower barrel, main valve below the frost line.

- Outline in `--navy`, 1.5px.
- The barrel interior fills `--blue` from the bottom when the float switch reads wet.
- Dry is the empty outline. That is the resting state for every healthy hydrant.
- Tilt fault rotates the entire glyph by the measured angle. A hydrant struck by a truck is drawn leaning.
- Critical fault inverts: glyph in white on `--black`.

This is the one memorable thing in the product, and it teaches the physics in a single mark. A dry-barrel hydrant is empty until it is opened, so a filled glyph means water is flowing right now. Nobody needs a legend.

Fill transition 300ms ease-out. Honor `prefers-reduced-motion`. Nothing else on the console animates.

## 6. The map

Real NYC hydrants from NYC Open Data, dataset `6pui-xhxz`, sampled to one neighborhood rather than loaded citywide.

- Base map in `--navy` at low luminance, or a plain light base with `--mist` landmass. Pick one and never mix.
- **Unmonitored hydrants**: 3px `--grey` dots. There will be hundreds. That grey field is the argument for the product.
- **Monitored, normal**: 8px `--navy` ring, white center.
- **Monitored, flowing**: 8px filled `--blue`, with a single expanding ring pulse.
- **Monitored, critical fault**: 8px filled `--black`.
- **Pilot proposed**: `--grey` ring, dashed, 8px. These are placed at hydrants drawn from the city's own 311 open-hydrant complaint records, and the console says so in a caption. Site selection justified by municipal data is a stronger claim than any feature.

## 7. The two roles

A toggle top right, display face, labelled `DEP / FDNY`. Same database, different question asked of it.

**DEP, the default.** Asset and maintenance view. Map, open-hydrant events with duration and estimated loss, device health queue sorted by severity, battery and tilt status. This is the buyer.

**FDNY.** One question per hydrant: **in service or out of service**, plus when it was last verified. Big display type, minimal chrome, a search box for a hydrant ID. An officer does not want a dashboard, they want a yes or no.

## 8. Copy rules

- Estimated water loss is always labelled **estimated**, with the assumption visible: `47 min open · est. 47,000 gal @ 1,000 gpm nominal`. There is no flow sensor on this device. Never print a gallon figure that implies measurement.
- Open events are `unclassified` until a person tags them `authorized` or `illegal`. The console never calls an event illegal on its own. The system cannot distinguish an FDNY connection from a kid with a wrench, and pretending otherwise is the fastest way to lose a technical reviewer.
- Hydrants have DEP unit IDs. Aqua Messenger devices have their own IDs, and the console always shows the pairing. A government buyer needs to reconcile against their existing asset register.
- Battery is reported as pack voltage plus a state, never as a percentage. See `schema.md` for why.

## 9. Accessibility floor

Severity already survives greyscale by construction. Add: visible 2px `--navy` focus outlines, 4.5:1 minimum contrast, keyboard-reachable map pins in severity order, and a text list of every fault beneath the map so the console is usable without the map rendering at all.
