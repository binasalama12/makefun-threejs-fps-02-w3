# Frostline Depot

A round-based tactical FPS that runs entirely in your browser, built on
three.js. Two invented crews fight over a snowed-in rail depot: the
**Frostwardens** (you, plus two bot wardens) attack, and the **Soot
Syndicate** (four bots) defends the fuel silo at the north end of the yard.

## How a round works

1. **Buy phase.** Spend your cash in the menu: five original guns, from the
   free Nixie P2 sidearm up to the Longnight marksman rifle, plus Frostpulse
   grenades that slow and half-blind anyone caught in the frost.
2. **Fight.** Rounds last 100 seconds. Win by wiping out the other crew —
   or sneak to the glowing ring at the silo, hold **E** standing still to
   plant the charge, then defend it for its 10-second fuse. The Syndicate
   will rush the silo and try to defuse, so a plant is the start of the
   fight, not the end of it.
3. **Scoreboard, then buy again.** Kills, wins and plants pay cash; losing
   still pays a little, never enough for the good guns every round.

## Accuracy is a decision

Every gun's spread blooms while you move, sprint or jump, and settles when
you stop — crouching tightens it further. Spraying on the run mostly feeds
the snowdrifts. Headshots pay out up to 3× damage, legs only 0.7×.

## Controls

| Keys | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (pointer lock) |
| Left click | Fire |
| R | Reload |
| 1–5 | Buy in the menu / switch gun in a round |
| 6 | Buy a Frostpulse grenade |
| Ctrl or C | Crouch |
| Shift | Sprint (worse spread) |
| Space | Jump |
| E (hold, at the silo) | Plant the charge |
| G | Throw Frostpulse grenade |
| Enter | Deploy from the buy menu |

## The depot

Two rail lanes with parked wagons run the length of the yard, an ice
warehouse anchors the west side, and crates, barrels and a plough blade
break up the middle. Snow falls the whole time; yard lamps keep the long
sightlines readable. All sound — shots, reloads, plant beeps, the
detonation — is synthesised live with WebAudio; the game ships no audio
files and makes no network requests.

## Running it

Serve the `game/` folder with any static file server and open
`index.html` in desktop Chrome, e.g.:

```
cd game && python3 -m http.server 8077
```

Then visit `http://localhost:8077/`. The handover program at the repo
root (`node main.ts`, with `MAKEFUN_OUTPUT_DIR` set locally) copies
`game/` and `screenshots/` to the output folder and writes the
`dossier.json` summary.
