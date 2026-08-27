# VALUE Brokerage Onboarding

This guide describes how to onboard a new Exclusive Buyer Agency brokerage into VALUE.

## 1. Confirm Fit

Before implementation, confirm that the brokerage:

- represents buyers under its own applicable licenses and agreements
- understands VALUE is decision support, not a substitute for brokerage judgment
- agrees that the buyer remains the chooser
- is willing to identify and disclose material conflicts
- will not use VALUE data as a hidden persuasion or closing-probability system

VALUE can support different lawful compensation models, but the brokerage must disclose its actual model clearly and configure the system accordingly.

## 2. Complete Brokerage Configuration

Copy:

`config/brokerage.example.json`

to:

`config/brokerage.json`

Replace every `REPLACE_` value.

Key identity fields include:

- public brokerage name
- legal brokerage name
- broker of record
- state/license information where required
- service area
- contact details
- brokerage founding/experience data
- brand colors/logo
- current compensation structure
- conflict policies
- admin identity
- buyer-portal domain

## 3. Validate Public Attribution

The standard public pattern is:

> **VALUE**  
> Human-centered homebuying decision support.  
> Brought to you by **[BROKERAGE]**, serving homebuyers for **[YEARS] years**.

The brokerage's years-of-service statement must be factually supportable.

Do not imply that VALUE itself has operated for the brokerage's full history unless that is actually true.

## 4. Map the Local Buyer Journey

VALUE supplies a core journey architecture, but state law, brokerage practice, financing customs, title/escrow practice, inspection norms, and local transaction sequencing differ.

The onboarding broker should review every stage and classify it as:

- universal VALUE stage
- local adaptation
- state-specific legal/compliance step
- brokerage-specific workflow

Do not remove a legally or operationally necessary step merely to make implementations look identical across brokerages.

## 5. Configure the Buyer Experience

Each individual buyer should receive their own identity and their own opportunity to answer consequential questions.

For multi-buyer households:

- preserve individual values and concerns
- preserve individual post-showing reflections
- share common property facts, showings, dates, and transaction state
- surface areas of alignment and difference without diagnosing either buyer
- define clearly which answers are private, shared with HBE/EBA staff, or shared with co-buyers

## 6. Configure VALUE Decision Aids

At minimum, decision aids should be available:

- after major journey stages
- after showings
- before an offer
- during negotiation when terms materially change
- after inspections/due diligence
- after appraisal/value information
- before final commitment

Each decision aid should examine:

- Values
- Alternatives
- Learning
- Uncertainty
- Evidence

The aid should preserve what changed rather than merely produce a score.

## 7. Build the Brokerage Conflict Register

Review common conflicts including:

- seller/listing-side relationships
- compensation structure
- price-based compensation
- closing-contingent compensation
- seller/builder incentives
- referral compensation
- affiliated providers
- time pressure
- agent performance incentives
- AI/software recommendations
- buyer psychological/decision data

For each conflict document:

1. what the conflict is
2. whether it can be eliminated
3. how it is reduced or neutralized
4. how it is disclosed
5. how informed choice is preserved
6. when the brokerage would decline or withdraw

Do not copy another brokerage's Conflict Register without validating that the practices described are true for the adopting brokerage.

## 8. Configure Compensation Transparently

VALUE does not prescribe one permanent compensation model.

The brokerage should document:

- agreed buyer-broker compensation
- possible sources of payment
- seller/listing-broker compensation handling
- builder incentives
- rebates/credits if offered and lawful
- retainers or phased fees if used
- termination consequences

If the brokerage participates in the VALUE compensation-learning program, internal time and economics may be compared across alternative models while the buyer's signed compensation remains unchanged during that engagement.

## 9. Configure Internal Time Tracking

Track enough to understand actual professional workload without creating unusable billing bureaucracy.

Recommended categories:

- strategy / consultation
- buyer profile / values clarification
- research / market analysis
- communication
- showing preparation / scheduling
- showing travel
- showing time
- post-showing VALUE review
- offer analysis
- negotiation
- due diligence / inspection
- appraisal / value analysis
- financing coordination
- closing / final decision
- administration / compliance

Time tracking is internal unless the brokerage explicitly chooses otherwise.

## 10. Security and Privacy Review

Before live buyers:

- verify admin authentication
- verify buyer isolation between cases
- verify individual identity inside multi-buyer cases
- define visibility for personal reflections
- protect sensitive documents with stronger authentication
- verify logging does not expose buyer answers
- define retention/archive behavior
- test recovery/backup processes

## 11. Fair Housing and Local Legal Review

Every brokerage must review its implementation for:

- federal Fair Housing requirements
- state protected classes
- local protected classes
- state brokerage/agency law
- advertising requirements
- compensation requirements
- record-retention obligations
- privacy/data requirements

VALUE should structure objective decision support, not demographic steering or neighborhood desirability judgments.

## 12. Train the Human Team

A brokerage should not deploy VALUE merely by turning on software.

Agents and staff must understand:

- why VALUE exists
- how to ask questions without steering
- how to distinguish facts from observations
- how to preserve uncertainty
- how to treat a wise walk-away as a successful outcome
- how to use decision profiles to communicate better, not persuade harder

## 13. Train/Configure the EBA Intelligence

See `INTELLIGENCE_INTERFACE.md`.

The intelligence must inherit the same constraints as the human practice:

- buyer interests before transaction momentum
- uncertainty surfaced, not hidden
- evidence sourced when practical
- no hidden persuasion scoring
- no protected-class inference/steering
- final consequential judgment remains human/buyer controlled

## 14. Pilot Before Full Adoption

Use several real buyer cases.

Measure:

- hours by stage
- showing trips and travel
- number of homes viewed
- decision-aid completion
- buyer corrections to profiles
- wise walk-aways/pauses
- unanswered questions at commitment
- brokerage economics
- agent/broker support workload

Then adjust the local implementation from evidence.

## 15. Go-Live Standard

Before launch, the responsible broker should be able to answer yes to:

> Would we still design this workflow, collect this information, make this recommendation, and compensate this work this way if the wisest outcome for the buyer were not to purchase a home through us?

If the answer is no, the implementation is not finished.
