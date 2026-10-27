# Production assets

Built in code with Remotion and the Webvoltz motion kit (3D through Three.js and React Three Fiber). No stock footage or licensed assets. Rendered at 1080p30.

## Product UI (about half the film)

Recreated from the shipped source, not invented: the same layout, copy, columns and status colours. Screens from the client's own product are rebuilt rather than recorded, because the real dashboard carries the client's brand and real customer data.

| Screen | Source of truth |
| --- | --- |
| Practice software "New patient" form | Stand-in for a clinic's own software (the extension works on top of it) |
| "Send a review request?" prompt with consent line, countdown, Yes and Skip | The browser extension's confirmation popup |
| Review Requests page: stat tiles, filters, table, status chips, hint tooltip | The dashboard's review-requests table and status chips |
| GoHighLevel workflow (tag trigger → SMS → webhook → wait → reminder) | The custom values and tags the backend provisions; the workflow itself lives in GHL |
| Phone with the first text and the reminder | The default SMS copy the backend provisions |

## 2D motion graphics (about a third)

- The architecture diagram: Front desk → API → PostgreSQL → Worker → GoHighLevel → Webhooks → Backend state, built node by node.
- The webhook diagram: events, endpoint checks, campaign state, the ignored duplicate.
- Opening notes, scene labels, the closing summary and the end card.

## 3D (about a fifth, in two places)

| Shot | Why 3D |
| --- | --- |
| Opening desk shot that dives into the laptop | Sets a real place before the product appears |
| Job rail with two workers: claim, lock, timeout, retry | Two workers reaching for the same job is clearest in space |

## Audio

- Narration: synthetic male voice (`cb-michael`), rendered first; the visuals are timed to its words.
- Music: a light lo-fi bed, ducked under the voice.
- Sound effects: clicks on Save and Yes, a soft chime when the tag is added, a glass tick on the timeout, light whooshes between scenes, a low impact on the logo.
- Normalised to −14 LUFS, −1 dBTP.
