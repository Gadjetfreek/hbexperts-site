# Forge Build Spec — Hire HBE Checkpoint

## Product intent

`Hire HBE` remains **one checkpoint on the Buyer Roadmap**. Do not turn the agreement sections into roadmap stops.

Clicking `Hire HBE` should open a guided experience *inside that checkpoint*. The buyer is walked through the agency agreement in plain language, one idea at a time, and arrives at the actual agreement/signature step only after the important concepts have been explained.

Primary design test: a buyer with roughly a fifth-grade reading level should be able to understand the practical meaning of each screen without needing to decode the legal document.

The plain-language experience is explanatory. The signed Agency Agreement remains the controlling document.

## Structure first

Before implementation, preserve these boundaries:

1. Roadmap layer — only the `Hire HBE` checkpoint and its state: locked / available / active / complete.
2. Checkpoint experience layer — guided explanations, buyer questions, readiness, agreement review, signature handoff.
3. Agreement data layer — buyer-specific agreement inputs and outputs.
4. Journey-state layer — events that affect BuyerUI and HBEUI after completion.
5. Document/signature layer — authoritative agreement and eventual e-signature provider. Keep this replaceable; do not hard-wire the experience to a temporary signature solution.

Do not put legal agreement copy directly into roadmap configuration or `dashboard.js`.

## Entry behavior

When shared journey state says the consultation is complete and representation is available:

- `Consultation` renders complete.
- `Hire HBE` becomes the current, clickable checkpoint.
- Clicking it opens the guided Hire HBE experience.
- Buyer can leave and return without losing their place.
- Future roadmap stops remain visible but locked.

Suggested entry language:

**Ready to decide whether you want HBE officially on your side?**

Before you sign anything, we will walk through what this agreement means, what we promise you, what you promise us, and how HBE gets paid. Stop us anywhere you have a question.

Actions: `Start` and `Not yet`.

## Guided screens

### 1. What hiring HBE means

Buyer-facing idea:

**If you hire HBE, we become your buyer agent.**

We work for you in the home purchase. We help look for homes and builders, protect your interests, and negotiate terms you are comfortable with.

Why it matters: the agreement gives HBE the exclusive right to locate property/builders and negotiate for the buyer, and HBE agrees to act solely for the buyer's interests.

Optional control: `See the agreement language`.

### 2. What HBE promises you

Plain language:

**Our job is to be on your side.**

- We use our experience to help find a home that fits your wants and needs.
- We act for your interests in the transaction.
- We negotiate terms you are comfortable accepting.

Do not turn this into marketing copy. It should reflect the agreement.

### 3. What you promise HBE

Plain language:

**If we work together, we need to work as a team.**

- You agree to work through HBE for the purchase of a home while the agreement is active.
- That includes listed homes, homes sold directly by owners, and builders/new construction.
- If you find a FSBO or builder, contact HBE before contacting them so we can protect your representation.
- Keep HBE informed about information that affects your ability to buy.

Also explain the preapproval commitment: the agreement says the buyer is ready/willing/able at signing or will provide a valid preapproval within 10 days.

### 4. How HBE gets paid

Plain language first; show exact agreement figures clearly.

Current agreement terms:

- $750 retainer at execution, unless waived because of a prior relationship.
- $3,750 minimum base fee.
- New and existing construction: 3% of purchase price.
- FSBO: 4% of purchase price.
- HBE asks that earned compensation be paid from seller funds at closing when possible.
- Who pays the fee does not change who HBE represents; HBE remains the buyer's fiduciary.

Required behavior: values should come from agreement/config data, not duplicated constants across UI code, so future agreement revisions can be changed in one place.

### 5. Shared Savings Promise

Use **Shared Savings Promise** as the buyer-facing name for the clause currently titled Dollar/Dime Program.

Plain-language concept:

**When HBE creates meaningful negotiated savings for you, we share in a small part of the savings we created.**

Explain the current agreement mechanics accurately:

- The program applies after at least $7,500 has been negotiated off the agreement-defined List Price.
- HBE's additional compensation is 10% of the negotiated buyer savings.
- Agreement-defined List Price is the current price when buyer and broker physically view the property for the first time.
- If the buyer chooses, in their best interest, to pay more than that List Price, HBE rebates to the buyer any additional commission earned above that List Price.

Do not simplify the math into wording that changes the legal meaning. Provide `See the agreement language` and, later, a simple example calculator only if it can be made accurate.

### 6. Extra money belongs to the buyer

Plain language:

**If someone offers HBE extra money because of your purchase, that extra benefit comes back to you.**

Explain that builder, listing broker, or seller inducements/bonuses above HBE's stated fees are refunded/rebated/returned to the buyer at closing.

### 7. Our guarantee

Plain language:

**We put a promise behind our work.**

Current agreement:

- HBE guarantees buyer savings of at least $7,500 off the agreement-defined List Price or refunds the buyer's retainer at closing.
- If the buyer believes HBE is not performing according to its promises/standards during the agreement term, the buyer may cancel through a mutual release of claims.

Do not oversell beyond the document language.

### 8. Permissions and important protections

Keep this concise and expandable.

Explain that the agreement gives HBE permission to talk with relevant third parties such as Realtors, mortgage companies, and title companies about the buyer's ability to perform.

Provide an `Important legal terms` expandable area for provisions that should remain visible but do not deserve a full teaching screen, including modification requirements, hold-harmless language, other-client representation policy, Fair Housing statement, sex-offender/SORN/Megan's Law disclosures, additional provisions, and entire-agreement language.

The buyer must still be able to view the full authoritative agreement before signing.

### 9. Review your agreement

Render a buyer-specific summary using structured values, including when applicable:

- buyer legal name(s)
- estimated purchase-price range
- agreement start date
- agreement end date
- retainer due or waived
- compensation terms
- Shared Savings Promise selection/initialing status if applicable
- preapproval status / deadline
- additional provisions
- contact/address information needed by the agreement

This is a review screen, not a substitute for the document.

Action: `View full Agency Agreement`.

### 10. Questions before signing

Do not use a legal-comprehension quiz.

Ask:

**Before we sign, is there anything in this agreement you want us to explain again?**

Actions:

- `I have a question`
- `I understand and I'm ready to review the agreement`

`I have a question` opens a note/chat request tied specifically to the Hire HBE checkpoint. Preserve the question in buyer state for HBEUI follow-up.

### 11. Sign

The final screen presents/hands off to the authoritative agreement for signatures.

Do not implement fake signatures as though they are legally operative. Keep a signature adapter/interface so an approved e-sign provider can be connected later.

Required completion event: only an authenticated, valid agreement-completed event should eventually mark representation complete in production. During prototype mode, label simulated completion clearly as an exercise.

## Journey events

Use stable journey events, not direct DOM-to-DOM coupling.

Suggested events/state:

- `representation.available`
- `representation.experienceStarted`
- `representation.questionRaised`
- `representation.readyToSign`
- `representation.signed`

When `representation.signed` occurs:

### BuyerUI
- `Hire HBE` becomes complete.
- `Build Your Home Search` becomes the next available checkpoint.
- Buyer sees warm confirmation that HBE is officially representing them.

Suggested copy:

**We're officially on your side.**

Your HBE representation is in place. Next, we will turn what we have learned about you into a home search we can keep improving together.

### HBEUI
Create/advance obligations rather than merely changing a sales status:

- confirm executed agreement is stored and buyer has a copy
- confirm retainer status
- confirm preapproval / set 10-day follow-up if needed
- capture agreement dates and compensation configuration
- create/build buyer search criteria from discovery + consultation
- prepare/connect MLS portal
- display any buyer questions or additional provisions requiring follow-up

## Data contract

Do not store buyer-specific agreement facts in shared UI source files.

Recommended representation object:

```js
representation: {
  status: 'locked|available|in_progress|ready_to_sign|signed',
  agreementVersion: '...',
  startedAt: null,
  signedAt: null,
  startDate: null,
  endDate: null,
  priceRangeMax: null,
  retainer: { amount: 750, status: 'due|waived|paid', waiverReason: null },
  compensation: {
    minimumBaseFee: 3750,
    constructionPercent: 3,
    fsboPercent: 4,
    sharedSavings: {
      buyerFacingName: 'Shared Savings Promise',
      threshold: 7500,
      sharePercent: 10
    }
  },
  preapproval: { status: 'confirmed|due|not_required', dueAt: null },
  additionalProvisions: [],
  questions: [],
  document: { provider: null, envelopeId: null, executedCopyUrl: null }
}
```

These figures reflect the current uploaded HBE Agency Agreement. Architecture must allow an agreement version to carry different values later without rewriting BuyerUI.

## Copy/style rules

- fifth-grade readability target
- one idea per screen
- short paragraphs
- explain unfamiliar terms immediately
- avoid `fiduciary`, `exclusive retention`, `inducement`, etc. in primary copy; show them only when explaining actual agreement language
- never hide a cost or buyer obligation to make the screen feel friendlier
- do not alter the agreement's legal meaning through simplification
- `Why this matters to you` may be used where it genuinely helps
- every explanatory screen may offer `See the agreement language`
- buyer can go Back / Continue and resume later
- no dark patterns or forced urgency

## Preview acceptance test

Use Donald Kelley exercise profile.

1. HBEUI consultation completion unlocks `Hire HBE` in Donald BuyerUI.
2. Clicking `Hire HBE` opens this experience; it does not create new roadmap checkpoints.
3. Donald can move forward/back through every explanatory screen.
4. Progress survives refresh.
5. Full agreement is accessible before signature.
6. `I have a question` records a checkpoint-specific question and makes it visible to the HBE side.
7. Agreement values render from structured/config data.
8. Prototype signature completion is clearly labeled as an exercise unless/until a real e-sign integration exists.
9. Completion marks `Hire HBE` complete and unlocks `Build Your Home Search` in shared journey state.
10. HBEUI changes to the next obligations listed above.
11. Preview links remain inside the exact preview build; no root-relative jump to production.
12. Production remains unchanged until preview approval.

## Source-of-truth reminder

The uploaded HBE Exclusive Buyer's Agency Agreement is the authority for legal terms and current figures. The guided experience explains it; it does not replace, amend, or override it.