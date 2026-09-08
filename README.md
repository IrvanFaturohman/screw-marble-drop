# Screw Sand Flow

### ▶ [Play it](https://irvanfaturohman.github.io/screw-marble-drop/) — best on a phone, portrait

Mobile-first hybrid-casual prototype. TypeScript + Vite + **Three.js**, 390×844
portrait, no backend, no asset files — every mesh, texture and sound is generated
procedurally at boot.

One verb: **tap a screw.** A screw at a crossing holds both planks it passes
through, so pulling it lets go of two things at once — and the coloured sand
inside them starts pouring.

```bash
npm install
npm run dev            # http://localhost:5176
npm run build          # tsc --noEmit && vite build
npm run validate:all   # both boards: every rule, a solver, a full play-through
npm run validate -- --level 2   # just the second board
npm run joints                  # every crossing, and what each screw holds
npm run inspect                 # the board layer by layer
```

---

## The revision: marbles became sand

The old loop was **screw → gate → 9 marbles drop → receiver fills 0/3**. Nine
discrete objects is a countable amount, a countable amount wants a countable
readout, and the whole thing settles into ordinary Marble Sort.

The new loop is **screw → gate → sand pours → sand PILES UP → squeezes through a
throat → collects again above the neck → enters the channel → a matching jar
fills 0% to 100%**.

### The one inequality that makes a pile

Everything about the accumulation comes from three numbers being in this order,
and the validator refuses a build where they are not:

```
SOURCE_FLOW_RATE   46   what a reservoir pushes toward its own outlet
MAIN_THROAT_RATE   17   what that outlet actually passes      <-- the pinch
BUFFER_INPUT_RATE  38   what the shared neck passes
RECEIVER_DRAIN     26   what one jar pulls out of the channel
```

A reservoir pushes 46 units a second at a hole that passes 17. The other 29 have
nowhere to go, so they **stack** — and the mound the player watches grow is that
number, not an animation. Measured on level 1: `pkDiag` (300 units) peaks at a
**189-unit pile** and keeps draining for **11 seconds after its source runs dry**.
Set the two rates equal and the sand drains like water and the revision is
pointless, which is why it is an assertion and not a comment.

The last rate matters too. A jar that out-drains the neck means a mismatched
colour never backs up: opening every reservoir at once peaked the channel at
**13%**, which is not a decision. Below it, the same move is a real overflow.

### Three layers, and only the first one is real

```
VOLUME     reservoir.remaining, reservoir.pile, funnel[], segment.volume,
           receiver.fill        <- gameplay. Deterministic. What validate plays.
FLOW       min(available, rate * dt, destinationCapacity) between fixed nodes.
GRAINS     a recycled pool of instanced quads and a cone per mound.
```

A grain is a *view* of volume. Losing one loses nothing; the pool recycles the
oldest whenever a pour outruns it. That separation is why the tools can play a
whole level in Node and be right about the phone.

### There is no physics engine any more

Sand is a flow network, so Rapier went out with the marbles — **2 MB of WASM
removed**, and the bundle dropped from 765 KB gzipped to 166 KB. It also closed
the last modelling gap: the old validator had to try several of its solver's
answers because the count model and the real physics disagreed. Now the solver
*is* the simulation, and it is a greedy play with a few different openings.

### Percentages, not counts

One jar is 100 units, so `receiver.fill` **is** the percentage. The visible sand
column in the jar is the same number scaled to the jar's height, so the picture
and the label cannot drift apart, and the HUD eases the channel reading toward
the truth rather than jumping.

### What did not change

The board is still the woven screw puzzle from the previous revisions, with
every rule still enforced: every crossing pinned, no plank sandwiched, nothing
buried, supports derived from geometry. Sand replaced the payoff, not the puzzle.

## LEVEL 2 — "SCAFFOLD", the hard one

**8 planks, 15 screws, 10 crossings, 45 marbles.** Same three rules, same
machine checks. What changes is the pressure:

- **A quarter more stock through a buffer that did not grow.** 45 marbles, still
  a 24 belt.
- **The middle rail is last, and its colour is trapped with it.** All five pieces
  on the top layer cross `railMid`, so it is the last plank on the board — and
  because they all cross it, none of them may share its colour. That forces its
  nine BLUE to be the entire blue supply: three boxes that cannot be touched
  until the board is nearly bare.
- **Five planks are free at the first tap**, not four, and none of them is the
  one you want.

Level 1's best possible play peaks at 12/24 and its verified play-through at
18/24. Level 2 peaks at **21/24** in the model and **23/24** on real physics —
one marble of slack. A level allowed to run that tight has to say so: `LevelDef`
carries a `peakBudget`, and the validator holds each board to its own, rather
than quietly loosening the rule for everybody.

Finding it took the tuner three tries at the structure. 54 marbles with three
twelve-marble pours is not winnable at all — 116 model-approved receiver
orderings were played through the real physics and every one of them lost.

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

`npm run validate:all` bundles the *shipping* simulation with esbuild and plays
both boards in Node. There is no renderer and no physics engine, so what it runs
is exactly what the phone runs.

**146 assertions on level 1, 164 on level 2.** The load-bearing ones:

- **the flow rates form a pile** — source outruns its own outlet by 1.4x or more,
  the outlet is the tightest point in the chain, and a jar drains slower than the
  neck fills so a mismatched colour genuinely backs up
- **every reservoir actually piles before it drains**, measured per reservoir:
  open it, watch the mound, and require both a real peak and a tail after the
  source empties
- **sand does not teleport** — the first grain may not reach the channel inside
  250 ms of a gate opening
- **every crossing is pinned** and **no plank is sandwiched** (unchanged)
- a colour with no jar stays in the channel, is not quietly deleted, and starts
  draining on its own the moment a jar for it opens — with no further input
- **a bad decision is never refused**: fill the channel, pull anyway, watch it
  back up, and lose cleanly
- supply exactly equals demand per colour (300 units each = 3 jars each)
- a full greedy play-through on the real flow network: every reservoir emptied,
  every pile drained, the channel empty, every jar at 100%
- two identical play-throughs match exactly

Measured in-browser: **12 taps, 62 s, channel peaked at 58%, 1200 units drained,
all 12 jars at 100%** — matching the headless run exactly.

Draw calls went 172 → 136 along the way. Two findings worth keeping: one pane of
`transmission` glass on a jar makes Three re-render the whole scene into a
transmission target every frame (99 ms → 35 ms when removed), and the five meshes
that made up each screw are now one merged geometry with the colours in the
vertices.

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
scripts/validate.mjs         every rule + solver + play-through, per level
scripts/joints.mjs           every crossing, and what each screw holds
scripts/tune.mjs             receiver-stack + pocket-colour search
scripts/inspect.mjs          board layer by layer
vite.config.ts               dev-only frame grabber -> shots/
```

`GameModel` and everything under it never imports Three or Rapier. That is what lets the
validator play the real game headlessly instead of a stub that could drift from it — and
it is why swapping the entire renderer and physics engine in this revision did not put the
rules at risk.
