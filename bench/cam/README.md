# L2.6 eccentric disk cam with a flat translating follower

This is the cam rung: an eccentric disk cam rotating about +Y and a flat-faced follower translating along X. The follower face position is `R + e*cos(theta) + gap`; the family measures that lift from rendered bounds, the sampled cam/follower contact gap, and checks three pairwise mesh collisions at five angles.

It is a source-driven pose check, not a dynamic cam simulation.

## Task

`tasks/cam-follower-e4.json`:

- cam radius 10 mm, eccentricity 4 mm, follower gap 0.2 mm;
- frame, cam and follower selectors;
- angles 0/90/180/270/360°;
- position tolerance 0.15 mm;
- three evidence layers: `distinct-exported-parts` (3), `rigid-motion` and `contact-gap`.
- the declared contact gap is **0.18–0.22 mm** (the reference models 0.2 mm) and is measured at every sampled angle.

The scorer:

1. renders frame/cam/follower at each angle;
2. measures the follower face min X from the actual mesh;
3. compares it with `R + e*cos(theta) + gap`;
4. measures the sampled contact gap as the follower face minimum X minus the cam maximum X and requires **0.18–0.22 mm**;
5. checks cam/follower, cam/frame and follower/frame collisions;
6. confirms three distinct part hashes.

## Result

```
bun run bench:cam:check
SELF-CHECK OK: 1 reference(s) pass, 3 adversarial submission(s) rejected.
```

| Submission | Result |
|---|---|
| `reference` | **PASS 3/3**; 3 parts; max lift error **0.0000 mm**; **contact gap 0.200-0.200 mm**; all three pairs separated at all five angles |
| `adversarial-static` | FAIL 2/3; cam and follower ignore angle, max error 8.0000 mm; contact gap remains in band |
| `adversarial-eccentricity` | FAIL 2/3; eccentricity 0, max error 4.0000 mm; contact gap remains in band |
| `adversarial-gap-0.15` | FAIL 2/3; lift error 0.0500 mm stays inside the position tolerance, **only `contact-gap` FAILS (0.150 mm)** |
| `adversarial-collision` | FAIL 1/3; negative follower gap causes interference, 0.5000 mm position error and a -0.300 mm contact gap |

## Boundaries

- Five sampled angles only; no continuous contact, spring preload, friction, load, wear or physical function.
- The follower face is a flat plane; the cam is a circular eccentric disk. No roller, profile law, pressure angle or undercutting is modelled.
- The frame is a base plus two guide rails; no bearing, shaft or lubrication.
- In the hidden split as family `cam` (external dev copy `hidden-cam-dev`: 1 task / 1 case, 2/2 layers). Listed in `bench:all`, but the current 90-case gate snapshot predates this family.
