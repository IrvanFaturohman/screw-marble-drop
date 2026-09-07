# Tuning

Every knob lives in the flat `TUNING` object in `src/config/GameConfig.ts`.
Press `` ` `` in game for the live panel; `1`/`2`/`4` set `GAME_SPEED` directly.

Gameplay code reads `TUNING` **every frame**, never caches it — a slider takes effect on
the next tick, including mid-pour.

Run `npm run validate` after changing anything structural. Several knobs below are
load-bearing for assertions (batch/capacity ratio, guide angles, flight reliability,
solvability) and the validator names the one you broke.

World units: **1 unit = 10 screen px** on the 390×844 reference, board = 39 × 84.4.

## SCREWS + STICKS — the upper puzzle

| Knob | Default | Effect |
|---|---|---|
| `UNSCREW_DURATION` | 420 | ms for the head to back out. The anticipation beat before the structure reacts. |
| `UNSCREW_TURNS` | 3.2 | Rotations while backing out. |
| `UNSCREW_LIFT` | 2.6 | How far the head comes forward before it drops clear of the marble path. |
| `PLATE_PARTIAL_MS` | 420 | A stick swinging to its partial pose after losing one of two supports. **`partialDeg` is a magnitude** — gravity picks the direction from the torque about the surviving screw, so the side of the pivot the mass sits on is the side that drops. This is the beat that says "the structure moved but nothing spilled" — too fast and the player misses the distinction that makes a screw a support rather than a button. |
| `PLATE_RELEASE_MS` | 620 | A stick leaving the board once its last support is gone. Magazines that release `@detached` start pouring at 30% of this, so the stick visibly opens BEFORE the batch appears. |
| `PLATE_FALL_GRAVITY` | -52 | Downward acceleration for a stick that falls away. |

**The board itself is not a knob.** Planks are authored by their two endpoints in
`src/config/LevelConfig.ts` — the picture first — and screws go at the crossings.
Which screws hold which plank is derived from geometry, never listed. Move an
endpoint and re-run `npm run joints`: it reports every crossing left bare, which
is the one rule you cannot eyeball. Two accidental overlaps in the first draft of
this board were found that way.

`PLANK_W` (3.8) is the width of every plank. Raise it and the uprights stop
reading as planks; the validator fails anything under aspect 2.8.

## BATCH RELEASE

| Knob | Default | Effect |
|---|---|---|
| `BATCH_RELEASE_INTERVAL` | 22 | ms between marbles leaving a pocket. 9 x 22ms ~ 200ms, so a batch reads as a *pour*. Above ~60 it becomes a trickle and the mass release stops being the point. |
| `BATCH_RELEASE_SPREAD` | 4.6 | Sideways scatter on release. The per-container launch in `GameModel.spawnMarble` multiplies this differently for a hopper, a tray, a cup and a wedge — that is what makes five pocket types feel different with one control scheme. |
| `DEFAULT_BATCH_SIZE` | 9 | Only a fallback; every magazine in `LATTICE` authors its own count (6, 9 or 12). |

## MARBLE PHYSICS

| Knob | Default | Effect |
|---|---|---|
| `MARBLE_RADIUS` | 1.05 | 21px at phone size. Every bead must fit inside its stick with this radius — the validator checks each one. |
| `MARBLE_GRAVITY` | -62 | units/s². With the defaults a batch fully drains in ~1.8s. |
| `MARBLE_RESTITUTION` | 0.38 | Bounce. Above ~0.6 the cascade turns into pinball and takes too long to settle. |
| `MARBLE_FRICTION` | 0.22 | **Also sets the critical guide angle**: a marble rests on any slope shallower than `atan(friction)` = 12°. Raise this and you must re-steepen the guides. |
| `MARBLE_LINEAR_DAMPING` | 0.12 | Air drag. Keeps the pile from jittering. |
| `MARBLE_MAX_SPEED` | 78 | Clamp. A tunnelled marble is a lost marble. |
| `MARBLE_MASS` | 1.0 | Only matters marble-to-marble. |

## CONTAINMENT — why nothing can get stuck

| Knob | Default | Effect |
|---|---|---|
| `FUNNEL_ASSIST_STRENGTH` | 46 | Peak steering toward the throat. At 0 marbles still cannot escape (the cheeks and walls hold them) but flights get long and wander. |
| `SLAB_ASSIST_STRENGTH` | 34 | Pull toward the front fall plane. This is what keeps a batch from landing on the sticks below it — turn it down and the board starts catching its own marbles. |
| `ANTI_REST_MS` | 260 | A falling marble that has barely moved for this long gets shoved. |
| `ANTI_REST_IMPULSE` | 11 | How hard. |
| `MARBLE_RESCUE_MS` | 3200 | Last-resort teleport to the belt. **It should never fire** — `npm run validate` asserts zero uses. If it starts firing, something above is wrong. |

## CONVEYOR — the pressure system

| Knob | Default | Effect |
|---|---|---|
| `CONVEYOR_CAPACITY` | 24 | The difficulty dial. Read it against `DEFAULT_BATCH_SIZE`: 9/24 means you can carry two wrong batches and no more. Below 20 the level stops being solvable; above 30 nothing is a decision. |
| `CONVEYOR_SPEED` | 13.5 | Arc units/s. Loop is 82.8 units, so a lap is ~6s at base. |
| `CONVEYOR_RUSH_MULT` | 2.2 | Speed multiplier for a marble whose colour has an open receiver. Set it to 1 and a receiver reveal stops reading as a flush. |
| `CONVEYOR_MIN_GAP` | 2.6 | Minimum arc gap. 24 × 2.6 = 75% of the loop, so a full belt is visibly full. Below ~2.2 marbles overlap; above ~3.4 capacity will not fit. |
| `CONVEYOR_INTAKE_MS` | 200 | Ease from the capture point onto the belt. |

## SORTING — the tik-tik-tik

| Knob | Default | Effect |
|---|---|---|
| `AUTO_SORT_INTERVAL` | 95 | ms between marbles leaving the belt. **This is the rhythm of mass sorting.** At 95 a full box is three snaps in a third of a second. Above ~200 nine matching marbles stop feeling like a payoff and start feeling like a queue. |
| `EXIT_GATE_HALF` | 6.0 | Arc half-width of the collection gate. Wider = marbles leave sooner after a reveal; narrower = more visible laps. |
| `SORT_FLIGHT_DURATION` | 260 | ms from belt to socket. |
| `RECEIVER_CAPACITY` | 3 | Sockets per box. Changing it breaks the colour balance; the validator will say so. |
| `RECEIVER_COMPLETE_DELAY` | 170 | Pause on 3/3 before the box leaves — the beat that lets the completion land. |
| `RECEIVER_SWAP_DURATION` | 260 | Box exit + next box rising. The model advances the column after `DELAY + SWAP`, so the belt re-check happens exactly when the player sees the new colour. |

## FEEL

| Knob | Default | Effect |
|---|---|---|
| `GAME_SPEED` | 1 | Whole-simulation multiplier. Set to 0 to freeze (useful for inspecting a cascade). |
| `cameraShakeIntensity` | 1 | Scales the only shake in the game — the failure state. A pour never shakes. |
| `particleMultiplier` | 1 | 0 disables particles. Worth doing once: the loop should still feel good, because the juice is supposed to be nine marbles pouring. |
| `juiceEnabled` | true | Master A/B switch. |
| `audioVolume` | 0.5 | Master gain. |
| `hapticEnabled` | true | `navigator.vibrate`; no-op where unsupported. |

## Where the difficulty actually lives

Not in these numbers. It is in `src/config/LevelConfig.ts`:

- **`blocksAtPartial` / `blocksUntilGone`** — which plate covers which screw, and
  whether swinging is enough to clear it or the plate has to leave entirely. This
  is the whole upper puzzle. `@partial` makes a reveal cheap (one screw);
  `@gone` makes it cost two.
- **`releaseAt`** — `'partial'` spills the moment a plate swings, so the FIRST of
  two screws pays for it; `'detached'` costs both. Flipping one pocket from
  `detached` to `partial` moves an entire batch earlier in the level.
- **`supports.length`** — a one-screw stick is a trapdoor, a two-screw stick is a
  decision. Six of ten here take two.
- **`receiverStacks`** — the order colours become available. Moving GREEN one box
  later is a bigger difficulty change than any knob above.
- **Which magazine sits on which stick.** Nine green on `diagA`, released at
  `partial`, with no green receiver open, is the level's entire opening tension.
- **Magazine colours.** A stick is painted its beads' colour, so no two
  overlapping sticks within 2.5 depth units may share one. That is a
  graph-colouring problem — run `npm run tune -- --colours` rather than guessing.
  It also proves how strict you can be: at a 3.0 gap this weave has no valid
  colouring at all.

Changing a pocket colour also changes WHEN each colour becomes available, which
invalidates the receiver stacks. Re-run `npm run tune` (it searches orderings for
a target difficulty band, default peak 14-17) and paste the result back.

`tune` shortlists with a fast count model, then **plays every shortlisted stack
through the real Rapier simulation** and only proposes ones that actually win.
Do not skip that: the count model treats the belt as an unordered multiset, but
the real belt is a circulating queue and a receiver only takes from the exit
gate. Stacks the model likes can deadlock with a full belt and three receivers
all waiting on a colour that has not arrived — 63 of the last 240 did.

After any of those, run `npm run validate`. It re-derives the occlusion graph,
re-checks that every named blocker geometrically covers its screw and that no
screw is still buried when it goes legal, and the solver reports the new
difficulty floor — or tells you the level is now unwinnable.
