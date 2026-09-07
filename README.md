# Screw Marble Drop

### ▶ [Play it](https://irvanfaturohman.github.io/screw-marble-drop/) — best on a phone, portrait

Mobile-first hybrid-casual prototype. TypeScript + Vite + **Three.js + Rapier 3D**,
390×844 portrait, no backend, no asset files — every mesh, texture and sound is generated
procedurally at boot.

One verb: **tap a screw.** A screw at a crossing holds both planks it passes
through, so pulling it lets go of two things at once — and whatever they were
carrying pours onto a conveyor that only holds 24.

```bash
npm install
npm run dev        # http://localhost:5176
npm run build      # tsc --noEmit && vite build
npm run validate   # headless: 119 assertions, a solvability search, a play-through
npm run validate -- -v            # print the solved pull order
npm run inspect                   # the board layer by layer
npm run joints                    # every crossing, and what each screw holds
npm run tune                      # search receiver stacks for a target difficulty
npm run tune -- --colours         # solve the pocket-colour graph
```

---

## What changed, and why — four times

**First revision** replaced one-screw-one-marble with batch release: the screw
became a trigger that poured nine marbles at once.

**This revision** fixes what that left behind. The source was ten identical
chambers in a 5x2 grid, each with one big screw on its face. That is a marble
box with a screw sprite on it — normal Marble Sort wearing a costume. The screw
was a colour button.

So the whole upper half was rebuilt as a real screw structure. A screw is now a
STRUCTURAL SUPPORT and nothing else:

```
STICK    long thin bars laid over each other on ten depth layers, each pinned by
         1-2 screws. Lose one support and it swings about the survivor; lose the
         last and it leaves, in an authored way (fall / swing / slide).
SCREW    sits at a real joint — a stick's end, or a crossing where one stick
         pins another. It may be physically covered by a stick in FRONT of it.
MAGAZINE a row of marbles held IN a stick. It spills because the stick carrying
         it opened. Never because a button was pressed.
```

The proof that this is not a colour button, measured by simulation rather than
asserted: **8 of the 13 pulls in this level spill nothing at all.** They only
change the structure. Every plank needs two or more screws, so no single screw
owns a batch.

Everything below the board was kept: marble physics, funnel, shared
conveyor, capacity, receiver stacks, colour matching, win/fail, restart, camera,
mobile layout.

## The loop

```
SEE THE WHOLE BOARD  (every screw is tappable)
  -> TAP ONE -> it spins out toward you and fades where it was
  -> the stick it held loses a support
  -> SWINGS about its remaining screw, or LEAVES the board entirely
  -> one or more of: a screw underneath is uncovered
                     a rear layer becomes visible
                     a magazine is open and 6-12 MARBLES POUR
  -> they collide, spread, bounce off deflectors, funnel back together
  -> SHARED CONVEYOR (24) -> exposed receivers auto-collect, tik tik tik SNAP
  -> box closes -> next colour exposed -> belt re-checked
  -> marbles that were stuck suddenly drain
```

One verb. **Tap a screw.**

## The board — "LADDER"

**7 planks, 12 screws, 7 crossings, 36 marbles**, mounted on one wooden board
with spare holes drilled along the bottom.

**Fourth revision, and it is the one that fixed the reading.** Three rules came
straight out of how a real screw board looks, and all three are enforced:

**Every crossing is pinned.** Two planks may not simply lie across each other
with nothing holding the joint — on a real board the crossing IS where the screw
goes. This is also what keeps the plank count honest: the ten-plank weave crossed
itself **thirty-three times**, and thirty-three screws is not a puzzle, it is a
nail bomb. Seven planks cross seven times, and `npm run joints` prints any
crossing left bare.

**Nothing is buried.** The camera looks straight down, so every screw head is a
circle and every plank its true rectangle. Because a screw at a joint is driven
through the topmost plank there, it is always visible — there is no such thing
as a hidden screw, and every screw on the board is tappable.

**So the gate is physical.** A plank with no screws left still cannot move while
another plank lies across it. It goes `loose` — it lifts a little and breathes —
and drops the moment the one on top of it goes. That replaces the old
hidden-screw occlusion with a dependency you can simply *see*.

**And no plank may be sandwiched.** A plank tucked under one neighbour and lying
over another reads as if it bends: its two ends disagree about whether it is
above or below the board, and from a dead-on camera there is no cue to settle it.
Five of the seven planks did exactly that in the first pass. So the board is
**two layers and only two** — three cross-pieces lying flat, four pieces laid
across them — which makes every plank either above EVERYTHING it crosses or
below everything it crosses. Planks inside a layer never overlap, so their z only
breaks depth-sort ties and is invisible.

| layer | plank | holds | crosses |
|---|---|---|---|
| **over** | `diag` — the one diagonal | GREEN ×9 | topBar, midBar |
| **over** | `vLeft` | YELLOW ×3 | topBar, midBar |
| **over** | `vRight` | RED ×3 | midBar, lowBar |
| **over** | `vMid` | BLUE ×3 | lowBar |
| **under** | `topBar` | RED ×6 | *(pinned by diag, vLeft)* |
| **under** | `midBar` | BLUE ×6 | *(pinned by diag, vLeft, vRight)* |
| **under** | `lowBar` | YELLOW ×6 | *(pinned by vRight, vMid)* |

The three uprights deliberately cross **different pairs** of cross-pieces. When
two of them crossed the same pair, the four-colouring had no solution at all —
each cross-piece has to share its colour with the one upright that does *not*
cross it.

### A screw at a joint holds both planks

Which screws hold which plank is **derived from geometry**, never listed: a screw
passes through every plank it physically sits on. Seven of the twelve sit on a
crossing and therefore hold two planks at once, so one pull lets go of two things
— and that shared joint is most of the puzzle. The other five are each a plank's
own private screw, in the clear span between cross-pieces, so a plank comes off
because you decided to take it off rather than as a side effect.

The four `over` planks are reachable straight away; the three underneath wait
for whatever is lying on them. **7 of 12 pulls spill nothing at all** — they only
change the structure.

### Gravity decides which way a stick swings

A two-screw stick that loses one support hangs on the survivor, and the side of
the pivot its mass sits on is the side that drops: pull the LEFT screw and the
left end goes DOWN. That direction is derived at runtime from the torque about
the surviving pin (`-g * (cx - px)`), not authored — an authored sign meant the
same stick swung the same way whichever screw you pulled, so half the time it
swung *up*. `partialDeg` is now a magnitude only.

Correcting it changed the level: batches land in different places, so the whole
receiver ordering had to be re-solved.

### The tools do the geometry

`npm run joints` finds every crossing, says which are pinned and which are bare,
and prints what each screw actually ends up holding. It is the only reason the
crossing rule is keepable by hand — it caught two accidental overlaps in the
first draft of this board that no amount of squinting would have.

## The decision

Receivers open on **RED / YELLOW / BLUE**. There is no green destination on the
board at t=0 — and `diag`, the one plank that is free to come off first, is
holding **9 GREEN** in a wedge that spills the moment it drops onto its surviving
screw. That is 9 marbles of pure debt on a belt of 24, one tap away, and you
cannot avoid it: `diag` lies across both `topBar` and `midBar`, so nothing else
on the board can move until it goes.

So the two puzzles argue with each other. *Which support can I remove?* and
*can the belt take what that spills?* rarely have the same answer.

## Reading it

Every stick is **opaque and painted the colour of the beads it carries.**

The first pass made them pastel-neutral translucent acrylic, so stick colour
could never be confused with marble colour. That was wrong twice over: layers of
tinted glass average out to one purple wash where you cannot tell which piece is
in front, and it threw away the single most useful fact about a stick — *what
this screw will spill.* Nobody confuses a matte bar with a glossy sphere.

So: solid planks, colour = contents, beads sitting in a darker recessed channel
along the face. One glance answers "if I pull this, what lands on my belt?"

Four rules keep it legible, all enforced by `npm run validate`:

- **every piece reads as a stick, none as a slab** — minimum aspect 3:1. A plate
  wide enough to read as a marble box is the failure mode being designed out;
- every bead sits ON its stick. A row that runs off the end reads as loose
  marbles floating beside the board, and it is the one layout error that
  survives every other check, because the rules never touch the row's geometry;
- the stick is only slightly duller than the beads it holds — the separation
  comes from a hard dark edge, not from washing the hue out, and from a wide
  brightness swing with depth so two planks the colouring could not separate
  still differ in value;
- **no two overlapping planks within 1.5 depth units share a colour.** What
  actually merges is two planks whose visible areas ABUT with only a seam
  between them, and on a board this sparse that means adjacent layers. 1.5 is
  the strictest gap this board can be four-coloured at while keeping green the
  scarce trap: `npm run tune -- --colours` reports zero solutions at 2.0.

### Cut-ply thin

The depth layers are as little as 0.4 units apart, so the original 1.5-deep
slabs physically **intersected each other**. That interpenetration is what made
the stack read as mush rather than as planks laid over one another. They are
now 0.24 thick — cut-ply, near enough to 2D — and every crossing is clean.

### A stored bead is a flush pip, not a marble

Loaded marbles used to be full spheres sitting a whole radius proud of the
stick, visibly hanging over its edges: marbles that looked like they were
already falling out. A real board does not show its contents in relief, it shows
drilled seats. So a stored batch is a flat disc set into a routed channel, and
**the 3D marbles only exist once they are actually pouring** — which is also
what makes the pour read as an event.

### A pulled screw leaves the way a plank does

It keeps spinning, lifts toward the camera and fades out **where it was**. It
used to fall the whole length of the frame instead — straight across the fall
space and onto the conveyor, where it sat looking like part of the machine. On a
dead-on camera that reads as debris, and it covers the one thing the player is
actually watching.

### The board, and the only holes on it

The planks are mounted on a wooden board. Without it they read as seven objects
floating in space; with it they read as one assembly.

It used to carry a decorative row of five drilled holes, copied from the
reference photos. They were the first thing anyone asked about — a neat row of
five on bare wood reads as a UI element, five slots for *something*, not as spare
carpentry. So the only holes on this board are real ones: **every screw leaves
the hole it came out of**, on each plank it passed through, uncovered as the
screw fades. A hole that appears only where a screw was needs no explaining.

## 3D

Fixed **orthographic** camera, looking **straight down**. It never orbits, follows, or
zooms. 3D here buys sphere physics, volume, material and shadow — not camera exploration.

The 15° tilt the earlier revisions used is gone. A screw puzzle is read dead-on:
every screw head has to be a circle and every plank its true rectangle, with the
over/under order coming from occlusion alone. Tilted, every head became an
ellipse, you could see the sides of things, and a flat board read as a diorama.

The conveyor oval lies in the **screen plane**. A horizontal track would collapse to a
line under this camera, and belt congestion — the entire pressure readout — would become
unreadable.

### Marble physics

Real Rapier rigid bodies: sphere colliders, gravity, restitution, friction, mass, marble-
to-marble collision, collision with the deflectors and funnel. **Peak measured: 18 bodies
live at 1.79 ms/frame**, and marbles stop being rigid bodies the moment the belt captures
them, so the scene never carries more than a batch or two.

The static scene is deliberately tiny — 2 funnel cheeks, 4 deflectors, 4 containment
walls. Nine spheres colliding with *each other* is where the spectacle comes from; a
plinko field would only make it less predictable, and the brief does not want one.

**Marbles pour FORWARD out of the opening stick** into a front slab (z ≈ +2.4) and fall
down the face of the board. That single decision is why a top-row batch never lands on the
planks below it, and why the physics scene stays this small.

### Nothing may get stuck

Physics is spectacle, never a skill check. Three layers guarantee it:

1. **Invisible guides** — below the rack every marble is steered toward the funnel throat
   and held in the front slab. Shared by both drivers, so it is one rule with one
   implementation.
2. **Anti-rest nudge** — a falling marble that has barely moved for 260ms gets shoved.
   Flat ledges are a physics reality; a marble parked on one is a broken game. (Both of
   these were real bugs: one batch balanced on a flat deflector, another wedged between a
   guide's end and the wall. The validator now asserts every guide is steeper than the
   friction angle and overlaps the side wall.)
3. **Rescue net** at 3.2s — which `npm run validate` asserts *never fires*.

## Failure and victory

A bad tap is never refused. The stick opens, the marbles pour, and if one reaches a
full belt you lose — `CONVEYOR FULL — a batch poured with nowhere left to put it`.
Pulling every screw the moment it lights up drowns the belt, exactly as it should.

Win when every magazine is empty, every marble is sorted, the belt is clear and all
24 boxes are packed — `LEVEL COMPLETE`. The board then comes apart and drops out of
frame. Both paths were played through in the browser against the real renderer and
Rapier: **16 taps, peak 18/24** for the win, and a full belt for the loss.

## Layout (390×844 → 39×84.4 world units)

| Band | % | Contents |
|---|---|---|
| top | 6% | HUD: marbles left, progress, boxes left, mute |
| 50% | | the board + **18.8 units of empty fall space** + funnel |
| 19% | | the shared conveyor loop, gauge inside it |
| 25% | | three receiver columns, queue visible beneath |

Desktop centres the phone frame on a warm table. No sidebar, no desktop chrome.

## Controls

Players tap screws. That is the entire input.

Developer keys: `R` restart · `1`/`2`/`4` sim speed · `S`/`D`/`P`/`G` structural
debug overlay (screw accessibility, blocking plates, plate support counts and
states, pocket contents) · `B` pull the first legal screw · `M` force-open a
pocket · `F` fill the belt · `C` clear it · `N` advance receivers · `U` mute ·
`` ` `` live tuning panel.

`window.__smd` is the test harness: `.tap(id)`, `.tapAt(x,y)`, `.open()`,
`.screws()`, `.plates()`, `.pockets()`, `.state()`, `.step(n)` (model **and**
render), `.sim(n)` (model only), `await .restart()`.
`step()` matters because browsers suspend `requestAnimationFrame` in a background tab —
and so does the compositor, so an external screenshot of a background tab only ever
shows the first paint. In dev the page can therefore hand a rendered frame straight to
disk instead:

```js
await fetch('/__frame/my-shot', { method: 'POST',
  body: document.querySelector('canvas').toDataURL('image/jpeg', 0.82) });
// -> shots/my-shot.jpg
```

That is a dev-server plugin (`vite.config.ts`), and it is why the renderer sets
`preserveDrawingBuffer` in dev only.

## Verification

`npm run validate` bundles the *shipping* simulation with esbuild and runs it in
Node — same planks, same dependency graph, same conveyor, same receivers as the
browser, and for the play-through **the same Rapier physics**. `RapierDriver`
imports only Rapier and config, never Three, so it runs headless.

That last part is load-bearing. The belt is a circulating queue and a receiver
only takes from the exit gate, so which box closes first depends on the order
marbles physically land in — and the scripted stand-in orders them differently
from Rapier. A level tuned against the stand-in passed every check here and then
deadlocked in the browser with a full belt and three receivers all waiting on a
colour that had not arrived yet. `npm run tune` now plays every shortlisted
candidate through the real simulation before proposing it: in the last search,
**63 of 240 model-approved stacks lost for real.**

**119 assertions.** The load-bearing ones are the two that keep the picture and
the rules saying the same thing:

- **every crossing is pinned** — two planks may not lie across each other with
  no screw at the joint. Re-derived from the geometry, not from the level file
- **no plank is sandwiched** — every plank is above everything it crosses or
  below everything it crosses, so its two ends can never disagree
- **the board can actually come apart** — walk the trapped-plank dependency and
  prove every plank, screw and magazine is eventually reachable

Also asserted:

- every plank overlaps a neighbour; **every plank reads as a plank, none as a
  slab** (minimum aspect 2.8 — the old build's marble-box tray was 2.0)
- **which screws hold which plank is derived from geometry**, so a screw cannot
  be listed as holding a plank it does not physically sit on; 8 of 13 hold two
- **no magazine hangs on a single screw**, and every plank needs 2+
- **every bead physically fits inside the plank that holds it**
- a plank stripped of all its screws while pinned under another **stays exactly
  where it is and spills nothing of its own**, and is flagged `loose`
- no two screws closer than a tappable distance
- colour supply exactly equals receiver demand (R9 B9 Y9 G9 = 36 = 12 boxes)
- no GREEN receiver at t=0, and the green batch is on the one plank that must
  come off first — worth >=30% of the buffer
- **no two overlapping planks within 1.5 depth units share a colour**
- **a solvability search** over pull orders, and `npm run tune` plays every
  shortlisted receiver stack through the **real Rapier physics** before proposing
  it — the scripted stand-in reported a peak of 17 for a level that really peaks
  at 22
- a full play-through **on the real Rapier physics**: 36 marbles, every box
  closed, every plank dismantled
- every magazine drains in avg 1.2s with **zero** uses of the rescue net
- exposing a colour drains stuck marbles with zero input
- overflow loses cleanly; two identical play-throughs match exactly

Measured in-browser against the real renderer and Rapier: **12 taps, peak 18/24,
all 7 planks dismantled**, 36 marbles, then a clean restart — matching the
headless run exactly, since both now use the same driver.

## What is deliberately absent

Meta, progression, economy, IAP, rewarded video, save state, lives, timers. Core loop only.
Screen shake is near-zero by design — the juice is meant to be nine marbles pouring, not
particles.

## Files

```
src/config/GameConfig.ts     all tuning + layout + palette (world units)
src/config/LevelConfig.ts    the authored board: planks (by endpoint), screws, magazines
src/game/PlateShapes.ts      arc/disc/ring/wedge/bar geometry + containment
src/game/SourceModel.ts      plates, supports, occlusion, pockets        (no Three/Rapier)
src/game/SortingModel.ts     belt, receivers, auto-sort, chains          (no Three/Rapier)
src/game/GameModel.ts        marble lifecycle + the one causal chain     (no Three/Rapier)
src/game/MarbleDriver.ts     driver interface + headless driver + the shared assists
src/physics/RapierDriver.ts  real 3D rigid bodies
src/game/Game.ts             glue: model -> views -> feel
src/three/*.ts               renderer, board + planks, track, marbles, receivers, particles
scripts/validate.mjs         119 assertions + solver + play-through
scripts/joints.mjs           every crossing, and what each screw holds
scripts/tune.mjs             receiver-stack + pocket-colour search
scripts/inspect.mjs          board layer by layer
vite.config.ts               dev-only frame grabber -> shots/
```

`GameModel` and everything under it never imports Three or Rapier. That is what lets the
validator play the real game headlessly instead of a stub that could drift from it — and
it is why swapping the entire renderer and physics engine in this revision did not put the
rules at risk.
