# HBE Showings + Decision Aids Architecture

Status: Canonical product requirement

## North Star

What is best for the buyer?

Operational test:

Does this help the buyer choose more wisely?

## Core Principle

A showing is not merely an appointment or a property viewed.

Every showing is a decision-learning event.

The HBE system should preserve what the buyer noticed, what HBE noticed, what evidence was available, what remained uncertain, how the property compared with the buyer's stated values, and what the showing changed about the buyer's understanding.

Decision aids and values clarification should occur:

1. after every meaningful HBE journey stage; and
2. after every showing.

The purpose is not to create a score that tells the buyer what to choose. The purpose is to improve memory, comparison, values alignment, awareness of uncertainty, and the buyer's ability to make their own informed choice.

---

# Buyer Portal: Showings Section

The Buyer Portal should include a persistent **Showings** section.

The section displays every home HBE and the buyer have seen together as a visual card.

Each card should include:

- clickable thumbnail
- property address
- showing date
- current property status if known
- list price at time of showing
- simple buyer status: Learning / Still Considering / Ruled Out / Offer Candidate / Offered / Under Contract / Chosen
- optional short buyer summary

Cards should be sortable by:

- showing date
- current interest
- price
- location

Do not default to ranking homes by a hidden HBE or AI score.

---

# Showing Detail Page

Clicking a showing card opens a dedicated property decision page.

## Property Identity

- address
- primary thumbnail
- showing date/time
- list price at showing
- MLS/reference identifier where permitted
- status
- basic property data
- property source links where permitted

## Buyer Media

Buyer can add:

- photos
- captions/descriptions
- notes tied to a photo

HBE can add:

- photos
- captions/descriptions
- observations tied to a photo

Each image must record uploader and timestamp.

Photos should be zoomable.

Do not enable actual production uploads until storage, file-type restrictions, malware controls, access rules, retention, and privacy boundaries are tested.

## Property Data

Where lawfully available and appropriately licensed:

- bedrooms/bathrooms
- square footage
- lot size
- year built
- taxes
- HOA
- utilities where known
- property disclosures
- days on market
- price history
- prior sale history
- parcel/public-record information

Display source and date for material facts when practical.

## Comparables

HBE can attach a comparable-sales analysis including:

- comparable address
- sale date
- sale price
- list price if useful
- size
- material similarities/differences
- adjustments or explanatory notes
- source/date

Comparables are evidence, not an automatic value conclusion.

## HBE Observations

HBE observations should be separated from verified facts.

Suggested categories:

- Structure / foundation
- Roof / exterior
- Water / drainage
- Electrical
- Plumbing
- HVAC
- Windows / envelope
- Interior condition
- Layout / function
- Site / lot
- Maintenance / deferred maintenance
- Potential specialist follow-up
- Other

Every observation should support one of:

- observed fact
- question to investigate
- potential issue requiring verification

Avoid presenting a visual observation as a professional inspection conclusion.

Use language such as:

- "We noticed..."
- "Worth asking about..."
- "May warrant evaluation by..."

not:

- "This is defective" unless supported by an appropriately qualified source.

## What We Still Do Not Know

A dedicated uncertainty list:

- unanswered question
- why it matters
- how it could be resolved
- who owns the follow-up
- status

Unknowns should remain visible rather than being silently converted into assumptions.

---

# Post-Showing Decision Aid

After every showing, each buyer should have an opportunity to answer independently before seeing the other buyer's answers where feasible.

## Immediate Reflection

1. What did you notice first?
2. What surprised you positively?
3. What concerned you?
4. What felt different in person than it did online?
5. What would you want to know before considering this home seriously?

## Values Clarification

Compare the home against the buyer's current values/priorities:

- Which of your top priorities did this home serve well?
- Which priorities would you be trading away?
- Did this showing change the importance of any priority?
- Did you discover something you care about that was not previously in your profile?

The Buyer Decision Profile is a living hypothesis and may be updated based on what the buyer learns.

## Decision State

Buyer selects one:

- This home taught me something, but I am not considering it
- Keep it in consideration
- I want more information
- I could imagine making an offer, but I am not ready
- I want to evaluate an offer decision

Avoid Like/Dislike as the primary decision framework.

## Head / Heart Check

Optional two-axis reflection:

- How well does this home fit what we said matters?
- How strongly are you emotionally drawn to it?

Do not combine these into a persuasion or purchase-probability score.

## Compare With Alternatives

Buyer can compare the current home with previously viewed homes on their chosen priorities.

The system should surface tradeoffs without declaring a winner.

---

# HBE Post-Showing Reflection

HBE records separately:

- observed strengths
- observed concerns
- important unknowns
- potential specialists/research
- market/value context
- apparent fit with stated buyer values
- places where buyer excitement may be outrunning evidence
- places where the property may deserve more consideration than the buyer initially gave it

HBE should answer the Revenue-Neutral Recommendation Test when a showing becomes an offer candidate:

> If HBE earned exactly the same amount whether this buyer pursued this home, another home, waited, or walked away, what would we recommend doing next and why?

---

# Stage Decision Aids

A decision aid is created at the completion of every meaningful journey stage.

Minimum structure:

- stage
- what we learned
- what changed
- relevant buyer values
- evidence
- assumptions
- important unknowns
- alternatives
- meaningful tradeoffs
- HBE recommendation, if one is appropriate
- buyer decision / next action
- buyer corrections or comments
- timestamp

Decision aids should become part of the buyer's living decision record.

They must not be hidden persuasion tools.

---

# Data Model Requirements

Future implementation should include at least:

## showings

- id
- buyer_id
- created_at
- updated_at
- shown_at
- address
- city
- state
- postal_code
- mls_id nullable
- list_price_at_showing nullable
- property_status nullable
- thumbnail_url nullable
- buyer_state
- property_json

## showing_media

- id
- showing_id
- buyer_id
- created_at
- uploader_type (buyer/hbe)
- uploader_identity
- storage_key
- content_type
- caption
- visibility

## showing_observations

- id
- showing_id
- created_at
- author_identity
- category
- observation_type (observed/question/follow-up)
- body
- visibility
- status

## showing_comparables

- id
- showing_id
- created_at
- address
- sale_date
- sale_price
- source
- comparison_json

## decision_aids

- id
- buyer_id
- showing_id nullable
- stage nullable
- created_at
- updated_at
- aid_type (post_showing/stage/offer/inspection/appraisal/financing/final)
- buyer_inputs_json
- hbe_inputs_json
- evidence_json
- unknowns_json
- alternatives_json
- tradeoffs_json
- decision_json
- buyer_confirmed_at nullable

For multiple buyers, buyer inputs must preserve each individual's voice before a combined/shared view is created.

---

# UX Requirement

The portal should evolve from a linear transaction tracker into three connected views:

1. **Journey** — where are we in the process?
2. **Showings** — what have the homes taught us?
3. **Decision Record** — what have we learned about the decision and ourselves?

The HBE Portal sees the same shared state plus HBE-only analysis, tasks, risk observations, internal notes, and professional workflow.

---

# Ethics Guardrails

Never use showing behavior or decision-aid answers to infer or score:

- likelihood to close
- willingness to overpay
- urgency susceptibility
- objection resistance
- emotional vulnerability
- persuasion strategy

The system may identify inconsistencies between current behavior and previously stated values, but it should present those as questions for reflection, not as leverage to move a transaction forward.

---

# Success Definition

A showing is successful when it improves the buyer's understanding, even if the house is ruled out.

A stage is successful when the buyer is better equipped to choose the next step, even if the next step is pause, change direction, or stop.
