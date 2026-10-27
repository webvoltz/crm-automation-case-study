# Production assets: product film

Everything is built in code (Remotion with the Webvoltz motion kit; 3D through Three.js and React Three Fiber), so there are no stock assets to licence. Rendered on a GPU at 1080p30.

## 3D assets

| Asset | Used in | Built from |
| --- | --- | --- |
| Clinic desk set: desk, back wall with warm light slats, plant | Problem, solution | Rounded boxes, cylinder, spheres; ceramic and clay materials |
| Laptop with a live screen | Problem, solution | Kit `Laptop3D`, with a recreated dashboard UI on the screen |
| Floating record cards (6) | Problem | Dark glass panels with an amber or red edge light |
| Campaign cube | Solution → loop | Glass cube with a glowing core that turns green on pass and red on failure |
| Gate corridor (7 gates, 3 lanes) | Gatekeeping | Anodised posts and lintels with per-lane lights |
| API block, PostgreSQL rack, job rail, queued jobs | Under the hood | A tower with glowing edges; a rack of 60 lit rows; queued cubes |
| Worker drones (2), retry timer ring | Under the hood | Discs with ring lights; torus |
| Backend and GoHighLevel towers, two beams | Loop | Towers with glowing edges (amber and blue); emissive tubes |
| Webhook signals, duplicate shield | Loop | Glowing spheres; a translucent disc |
| Business map: 28 blocks, streets, 5 pins | Prospects | Boxes on a dark plane; glowing spheres |
| Prospect cards, pipeline columns (3) | Prospects | Dark glass cards; panels with a lit header |
| Stage floor and the through-line | Whole film | A long dark floor; an amber light strip that lights at the end |

Lighting: the Webvoltz studio (white key, amber rim and accent softbox), bloom, light depth of field, motion blur (4 samples), vignette.

## UI recreations (fictional data)

| UI | Scene |
| --- | --- |
| Review-requests list with an Approve button and cursor | Solution |
| GoHighLevel client workflow panel (tag added → Text 1 → wait → reminder) | Loop |
| Business Search selection with pipeline and stage picker | Prospects |

## Audio

- Narration: synthetic male voice (`cb-michael`), rendered first; every visual beat is timed to its words.
- Music: an ambient electronic drone, ducked under the voice.
- Sound effects: a click on Approve, quiet ticks at each gate, a chime when the checks pass, a glass tick on the retry, whooshes on scene moves, a low impact on the logo.
- The mix is normalised to −14 LUFS with a −1 dBTP true-peak ceiling.
