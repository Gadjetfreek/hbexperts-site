# HBE Time Tracker + Multi-Buyer App Architecture

Status: Canonical product requirement

## 1. HBE Time Tracker

Purpose: establish real workload data from consultation through closing without turning the first measurement period into a billing meter.

### Principles

- Keep it loose enough that agents will actually use it.
- Track actual professional effort, including travel.
- Do not connect time entries to client billing during the initial measurement period.
- Associate time with a buyer household, individual professional, journey stage, and optionally a showing/property.
- Prefer quick capture over six-minute legal-style billing increments.

### Quick Entry

HBEUI should provide:

- Start / Stop timer
- +15 min
- +30 min
- +1 hour
- manual entry
- recent-client shortcut

### Categories

- Strategy / consultation
- Buyer profile / values clarification
- Research / market analysis
- Communication
- Showing preparation / scheduling
- Showing travel
- Showing time
- Post-showing decision aid / review
- Offer analysis
- Offer writing / negotiation
- Due diligence / inspection
- Appraisal / value analysis
- Financing coordination
- Closing / final decision
- Administration / compliance
- Other

### Showing Trip Shortcut

A showing workflow should support:

1. Start trip
2. Arrive in market area
3. Property 1 / Property 2 / etc.
4. Leave market area
5. End trip

This allows travel and in-property time to be measured separately with minimal taps.

### Reporting

HBEUI should show per client:

- total professional hours
- travel hours
- showing hours
- research hours
- communication hours
- decision-support hours
- transaction/admin hours
- total showing trips
- total homes viewed
- days/months active
- hours by journey stage

Aggregate reporting should show medians and ranges across clients.

### Initial Measurement Period

Collect at least 10-20 completed or substantially completed buyer engagements before using the tracker as the primary basis for changing compensation.

The first purpose is truth, not billing.

---

## 2. Multi-Buyer Household Architecture

A buyer engagement is not one person record.

Data model should separate:

- Household / Buyer Case
- Buyer Person A
- Buyer Person B (and additional buyers where necessary)

Each person receives their own login and individual identity.

### Shared Case

The household shares:

- journey stage
- showings
- property facts
- HBE observations
- comparables
- transaction dates
- shared tasks
- shared decision record where appropriate

### Individual Layer

Each person separately owns:

- Buyer Experience answers
- decision profile
- post-showing reflections
- values clarification
- uncertainty / concerns
- private notes if offered
- individual decision state

The system must not average away meaningful disagreement.

### Correlation Layer

After both buyers submit a reflection, the system may present:

- areas of alignment
- areas of difference
- values that appear shared
- values whose relative importance differs
- questions worth discussing together

The correlation layer should describe differences, not diagnose the people.

### Visibility Rules

Every individual response should have an explicit visibility policy:

- Private to buyer + HBE
- Share with co-buyer after submission
- Shared household answer

Where feasible, each person should answer consequential reflection questions before seeing the other person's answer to reduce anchoring and social pressure.

---

## 3. Buyer-Facing Mobile App

Build V1 as an installable Progressive Web App (PWA), not a native App Store application.

Reasons:

- one secure codebase
- immediate updates
- installable to iPhone/Android home screen
- browser-based login
- lower maintenance
- can later be wrapped or rebuilt as native if real usage justifies it

### Main Navigation

The buyer app should center on:

1. Journey
2. Showings
3. Decision Record

Additional items:

- Messages / notes from HBE
- Tasks / upcoming dates
- Profile / account

### Dashboard Behavior

Two buyers in the same household should see nearly identical dashboards because they are looking at the same home-buying journey.

Differences should appear only where the information genuinely belongs to the individual.

Useful UI pattern:

- **My View** — my answers, reflections, values, unresolved concerns
- **Our Shared View** — household journey, properties, shared facts, aligned decisions and explicitly shared information

HBEUI sees the shared case plus each buyer's permitted individual layer.

### Identity

Each buyer must authenticate separately.

Do not use one household credential for multiple people if the system stores individual reflections.

The household relationship is established through a case membership record, not through shared credentials.

---

## 4. Proposed Future Data Model

### buyer_cases

- id
- created_at
- updated_at
- stage
- completed_stages
- status

### buyer_people

- id
- case_id
- first_name
- last_name
- email
- phone
- role
- status

### person_profiles

- id
- person_id
- created_at
- updated_at
- profile_json
- buyer_confirmed_at

### time_entries

- id
- case_id
- buyer_person_id nullable
- professional_identity
- showing_id nullable
- stage nullable
- category
- started_at nullable
- ended_at nullable
- minutes
- note nullable
- created_at

Time entries are HBE-private by default.

---

## 5. Ethics Guardrails

- Time tracking is not a productivity surveillance score.
- Do not infer service quality from low or high hours alone.
- Individual buyer answers must not be silently shared with a co-buyer.
- Do not use differences between buyers as persuasion leverage.
- Do not create purchase-probability or susceptibility scores.
- The correlation layer should help people understand each other and the decision, not push them toward agreement or closing.

## Success Definition

The app is successful if two people can participate as individuals while still experiencing one coherent shared home-buying journey.

The tracker is successful if HBE can finally answer, with real evidence, how much professional work different types of buyer engagements actually require.
