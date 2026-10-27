# Narration script: product demo

The complete voice-over as performed (83 s). Times come from the rendered voice track.

### 1 · The problem

**0:00.8** Every happy customer is a chance for a new review.  
**0:04.0** But asking at the right time, without spamming anyone, across many clinics and one CRM, is hard to do by hand.  

### 2 · The front desk

**0:11.6** So we built it into the front desk. When staff save a new customer, a small prompt asks to send a review request.  
**0:18.9** One click on Yes, and the request is queued.  

### 3 · The dashboard

**0:22.6** In the dashboard, the team sees every request: pending during a two hour grace period, then sent, failed, or cancelled.  

### 4 · How it works

**0:31.0** Here's how it works. The API stores the request in Postgres, which doubles as the job queue.  
**0:37.7** A background worker picks it up, and checks the send window, opt-outs and frequency limits.  
**0:43.1** Only then does it update the contact in GoHighLevel, and add one tag that starts the texting workflow.  

### 5 · The job queue

**0:49.4** Workers claim jobs with SKIP LOCKED, so no job is ever taken twice.  
**0:54.4** If GoHighLevel times out, the job is kept, and retried with backoff.  

### 6 · GoHighLevel

**0:59.7** Inside GoHighLevel, the client's own workflow sends the first text, and a reminder two days later.  

### 7 · Closing the loop

**1:05.9** Every reply, link click, or opt-out comes back by webhook, and updates the campaign exactly once.  

### End

**1:13.1** One approval. Every rule enforced. Every outcome tracked.  
**1:17.5** Webvoltz. Engineering reliable business automation.  
