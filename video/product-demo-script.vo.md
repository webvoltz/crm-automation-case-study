---
voice: cb-michael
gap: 0.45
lead: 0.8
tail: 2.4
---
# problem
[narration] Every happy customer is a chance for a new @review review.
[narration] But asking at the right time, (pause 0.1) without spamming anyone, (pause 0.1) across many @clinics clinics and one @crm {CRM|C R M}, (pause 0.1) is hard to do by @hand hand.
# capture
[narration] So we built it into the front desk. When staff @save save a new customer, (pause 0.1) a small prompt @ask asks to send a review request.
[narration] One click on @yes Yes, (pause 0.1) and the request is queued.
# dashboard
[narration] In the dashboard, the team sees every request: @pending pending during a two hour grace period, (pause 0.1) then @sent sent, @failed failed, or @cancelled cancelled.
# arch
[narration] Here's how it works. The @api {API|A P I} stores the request in @pg Postgres, (pause 0.1) which doubles as the job @queue queue.
[narration] A background @worker worker picks it up, (pause 0.1) and checks the send @window window, @optouts opt-outs and @limits frequency limits.
[narration] Only then does it update the contact in @ghl {GoHighLevel|Go High Level}, (pause 0.1) and add one @tag tag that starts the texting workflow.
# claim
[narration] Workers claim jobs with @skip {SKIP LOCKED|skip locked}, (pause 0.1) so no job is ever taken @twice twice.
[narration] If {GoHighLevel|Go High Level} @timeout times out, (pause 0.1) the job is kept, (pause 0.1) and @retry retried with backoff.
# flow
[narration] Inside {GoHighLevel|Go High Level}, the client's own @workflow workflow sends the first @text1 text, (pause 0.1) and a @reminder reminder two days later.
# webhook
[narration] Every reply, (pause 0.1) link @click click, (pause 0.1) or opt-out comes back by @hook webhook, (pause 0.1) and updates the campaign exactly @once once.
# end
[narration] One approval. (pause 0.15) Every rule @enforced enforced. (pause 0.15) Every outcome @tracked tracked.
[narration] @brand {Webvoltz|Web volts}. (pause 0.3) Engineering reliable business automation.
