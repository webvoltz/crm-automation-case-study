# Narration script

The complete voice-over as performed (89 s). Times come from the rendered voice track. The synthetic voice reads "CRM" as letters and "Webvoltz" as "Web volts".

### 1 · The problem

**0:00.8** Turning a happy customer into a review should be simple.  
**0:04.3** But doing it reliably across multiple businesses, customer records, and messaging workflows is much harder.  

### 2 · The solution

**0:11.1** We built a CRM automation integration that turns one approval into a controlled, trackable workflow,  
**0:17.6** with the right checks before anything happens.  

### 3 · Gatekeeping

**0:20.4** Before a request can proceed, the backend checks timing, opt-outs, previous reviews, and frequency limits.  
**0:27.7** Critical conditions are checked again before the workflow is triggered.  

### 4 · Under the hood

**0:31.8** Behind the scenes, PostgreSQL stores the work and its state.  
**0:35.8** Background workers safely claim jobs, recover from temporary failures,  
**0:40.4** and resume processing without blindly repeating completed steps.  

### 5 · GoHighLevel loop

**0:44.6** Once the checks pass, the backend triggers the client's GoHighLevel workflow.  
**0:49.4** GoHighLevel handles the configured messaging,  
**0:52.5** while webhooks report what happens back to our system, so campaign state stays consistent.  

### 6 · Prospects to sales

**0:58.0** The same platform also connects business prospecting to sales.  
**1:02.0** Selected businesses move into the right pipeline, existing contacts are reused when the match is clear,  
**1:08.0** and uncertain matches are sent for human review.  

### 7 · The outcome

**1:11.1** The result is more than a CRM connection.  
**1:14.2** It's a system designed to automate routine work, enforce business rules, recover from failures,  
**1:20.4** and keep customer and sales workflows connected.  

### End card

**1:23.6** Webvoltz. Engineering reliable business automation.  
