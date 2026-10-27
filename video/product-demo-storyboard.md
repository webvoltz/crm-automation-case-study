# Storyboard: product walkthrough

1920 × 1080, 30 fps, 83 s. A software product demo: mostly product UI, flat diagrams for the architecture, and 3D in only two places, the opening desk shot and the worker claiming a job. Product screens are recreated from the shipped dashboard and extension (layout, copy, status colours); the client's logo and name are removed, and every customer is made up.

| Time | Scene | What's on screen | Mode |
| --- | --- | --- | --- |
| 0:00 – 0:11 | **1 · The problem** | A short push-in on a clinic front desk; the laptop shows the practice software. Four notes build on the left: the right moment, no spam or duplicates, many clinics and one CRM, hard to do by hand. The camera dives into the laptop screen. | 3D (brief) |
| 0:11 – 0:22 | **2 · The front desk** | The practice software's New patient form fills in; the cursor clicks Save. The real confirmation prompt slides in: "Send a review request?", the name, email and phone, the SMS consent line, and the "Auto-confirming as Yes in …" countdown. The view zooms onto it; the cursor clicks Yes and it turns into "Request queued". | Product UI |
| 0:22 – 0:31 | **3 · The dashboard** | Review Requests: the Sent, Pending, Failed and Cancelled tiles, and the request table with Customer, Source, Status, Confirmation, Due, Attempts and Sent. Maya's new row arrives as Pending, with the dashboard's own hint: "Confirmed and waiting for the 2-hour delay before being sent." Each status lights as it's named. | Product UI |
| 0:31 – 0:49 | **4 · How it works** | A flat diagram, built node by node with the narration: Front desk → API → PostgreSQL (job queue, state) → Worker → GoHighLevel. The worker's checks tick: send window, SMS opt-out, frequency limits. Then the `review_candidate` tag, and the return path: GoHighLevel → Webhooks → Backend state. | 2D diagram |
| 0:49 – 0:59 | **5 · The job queue** | A clean 3D rail of four jobs and two workers. Worker A claims the first job; worker B finds it locked and takes the next. The first job turns red on a GoHighLevel timeout, is kept and set back, then retried and sent. A one-line code card shows the `SKIP LOCKED` claim. | 3D (selective) |
| 0:59 – 1:05 | **6 · GoHighLevel** | The client's workflow: trigger on tag added, send SMS, a webhook back, wait, send the reminder. A phone receives the first text in the default copy, and the reminder "2 days later". | Product UI |
| 1:05 – 1:13 | **7 · Closing the loop** | A flat diagram: events leave GoHighLevel for the webhook endpoint, which verifies the secret, matches the campaign and checks the contact. The campaign moves active → awaiting_reminder → ended_link_click. A repeated event is ignored and logged. | 2D diagram |
| 1:13 – 1:23 | **End** | Five connected parts: front-desk capture, rule-checked dispatch, Postgres job queue, GoHighLevel workflow, webhook reconciliation. Then the Webvoltz lockup: "Engineering reliable business automation." | 2D |

Captions run throughout (hidden on the logo). A soft dark band sits under the captions on the light product screens so they stay readable. Every visual beat is timed to the word it belongs to.
