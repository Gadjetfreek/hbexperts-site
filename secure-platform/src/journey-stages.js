/**
 * Canonical HomeBuyer journey: 17 stages total.
 * Stages 1–16 match live production (worker.js / ui-worker.js / hbe-worker.js)
 * through Get the Keys. Stage 17 is After the Keys.
 * Do not invent stages 18–21. Post-closing 30/90/365/anniversary/warranty
 * items live as checklist entries inside Stage 17.
 */
export const STAGE_COUNT = 17;

export const STAGES = [
  ['buyerExperience','Buyer Experience','Start with what matters to you',[
    'Share what is bringing you to the idea of buying a home.',
    'Tell us what you know, what you do not know, and what you are worried about.',
    'Give HBE a useful starting point without needing perfect answers.'
  ]],
  ['consultation','Consultation','Turn answers into understanding',[
    'Talk through your Buyer Experience with an HBE advisor.',
    'Clarify priorities, tradeoffs, timing, risks, and unanswered questions.',
    'Decide whether HBE feels like the right fit for you.'
  ]],
  ['representation','Hire HBE','Choose your representation deliberately',[
    'Understand who HBE represents and what fiduciary representation means.',
    'Review responsibilities and the written agency agreement.',
    'Choose whether to hire HBE without pressure. Compensation is negotiable and belongs in the written arrangement — it is not a public rate card, and seller-paid compensation is not automatic.'
  ]],
  ['search','Build Your Home Search','Turn priorities into a useful search',[
    'Translate your priorities into search criteria and tradeoffs.',
    'Connect your profile to the MLS search.',
    'Adjust the search as we learn what actually fits.'
  ]],
  ['market','Learn the Market','Understand what the market is really offering',[
    'See what your money buys in the current market.',
    'Compare location, condition, value, and alternatives.',
    'Refine expectations before chasing individual homes.'
  ]],
  ['possibilities','Discover Possibilities','Find homes worth learning from',[
    'Review homes that may fit your evolving profile.',
    'Notice useful possibilities you did not originally expect.',
    'Flag homes worth seeing without letting the search become noise.'
  ]],
  ['evaluation','Evaluate Homes','Learn from each property',[
    'Tour homes with an HBE advisor.',
    'Capture details, observations, photos, and questions worth remembering.',
    'Use each home to improve the next decision.'
  ]],
  ['offer','Ready to Offer?','Decide before negotiating',[
    'Separate excitement from decision quality.',
    'Identify what is still unknown and what could change the decision.',
    'Choose whether making an offer actually serves your goals.'
  ]],
  ['terms','Build the Offer','Construct price and terms deliberately',[
    'Choose price, timing, contingencies, and protections consciously.',
    'Understand what each term gives up or protects.',
    'Build an offer you can live with whether it wins or loses.'
  ]],
  ['negotiation','Negotiate Wisely','Protect leverage and your WHY',[
    'Evaluate counters, concessions, and seller responses.',
    'Keep alternatives and leverage visible.',
    'Choose when to proceed, counter, or walk away.'
  ]],
  ['diligence','Learn What We Did Not Know','Investigate before commitment hardens',[
    'Review disclosures, records, transaction details, and unanswered questions.',
    'Track new facts as they appear.',
    'Ask what each new fact changes about the decision.'
  ]],
  ['inspection','Inspection Decision','Put inspection findings in context',[
    'Separate routine maintenance from meaningful risk.',
    'Identify specialist or follow-up needs.',
    'Choose repairs, credits, acceptance, or exit when available.'
  ]],
  ['value','Value Check','Compare price with independent evidence',[
    'Review appraisal and other value evidence.',
    'Understand any value gap and its consequences.',
    'Choose the response that best protects you.'
  ]],
  ['loan','Final Financing','Finish financing without surprises',[
    'Track underwriting and lender conditions.',
    'Review final cash, payment, and financing expectations.',
    'Protect the transaction from avoidable financing problems.'
  ]],
  ['commitment','Final Decision','Ask whether this is still the right choice',[
    'Compare what you know now with what you knew when you started.',
    'Confirm remaining risks and obligations.',
    'Make sure the home still serves your WHY before final commitment.'
  ]],
  ['closing','Get the Keys','Complete the purchase and take possession',[
    'Verify final documents, funds, and logistics.',
    'Complete the final walk-through and closing.',
    'Get the keys and begin making the home yours.'
  ]],
  ['afterKeys','After the Keys','Stay with the household after possession',[
    'Settle in with a human still available for the first surprises.',
    'Use the first weeks and months to notice what the home is teaching you.',
    'Keep HBE as a resource for warranty, vendors, tax, insurance, and home-performance questions — without turning care into a sales follow-up.'
  ]]
];

function item(key, title, visibility, creates = null) {
  return { key, title, visibility, creates };
}

const buyerTask = (title, dueDays = 7, priority = 'high') => ({
  kind: 'buyer_task', title, dueDays, priority, visibility: 'shared'
});
const hbeTask = (title, dueDays = 3, priority = 'high') => ({
  kind: 'hbe_task', title, dueDays, priority, visibility: 'hbe'
});
const deadline = (title, dueDays, priority = 'critical') => ({
  kind: 'deadline', title, dueDays, priority, visibility: 'shared'
});

export const STAGE_CHECKLISTS = {
  buyerExperience: [
    item('submitted','Buyer Experience submitted','shared'),
    item('hbe_notified','HBE notified that a private record exists','hbe', hbeTask('Review the new Buyer Experience before the first conversation', 2)),
    item('access_created','Cross-device access created for this buyer','hbe')
  ],
  consultation: [
    item('held','Consultation held','shared'),
    item('priorities_named','Priorities and tradeoffs named in household language','shared', hbeTask('Write the first household-story synthesis from consultation notes', 2)),
    item('fit_discussed','Fit with HBE discussed without pressure to hire','shared')
  ],
  representation: [
    item('choice_recorded','Representation choice recorded for each buyer','shared', buyerTask('Each buyer records a representation choice from their own login', 5)),
    item('agreement_reviewed','Written agreement reviewed','shared'),
    item('arrangement_recorded','Negotiated arrangement recorded in the signed agreement — not a public rate card','hbe')
  ],
  search: [
    item('geography','Shared search geography drafted','shared', buyerTask('Confirm the search geography in Shared Household View', 5)),
    item('needs_vs_prefs','Needs separated from preferences','shared'),
    item('criteria_confirmed','First criteria version confirmed by linked buyers','shared')
  ],
  market: [
    item('listings_reviewed','Review representative listings and recent sales','shared'),
    item('gap_named','Name where expectations and the market disagree','shared', hbeTask('Prepare a short market-evidence note for this commute band', 4)),
    item('alternatives_visible','Keep alternatives visible before falling in love with one street','hbe')
  ],
  possibilities: [
    item('review_fits','Review today’s best-fit possibilities','shared', buyerTask('Each buyer reacts privately, then compare only shared facts', 3)),
    item('rejection_pattern','Record why rejected homes missed — without blaming either person','hbe', hbeTask('Update the household story with rejection patterns, not a score', 3)),
    item('flag_tours','Flag homes worth seeing','shared', buyerTask('Confirm which homes are worth an hour of household time', 4))
  ],
  evaluation: [
    item('tour_candidates','Choose tour candidates','shared', buyerTask('Say why these homes are worth seeing now', 3)),
    item('tour_packet','Plan an efficient tour and property packet','hbe', hbeTask('Prepare tour sequence and a VALUE note for each home', 2)),
    item('separate_reactions','Capture each buyer’s reaction separately','hbe', hbeTask('Record two voices, not one blended score', 2))
  ],
  offer: [
    item('walkaway','Name the walk-away boundary','shared', buyerTask('Talk about the point where this stops being the right house', 3)),
    item('unknowns','List remaining unknowns that could change the choice','hbe', hbeTask('Identify unresolved facts worth investigating before any offer', 2)),
    item('serves_why','Decide whether an offer serves the WHY','shared')
  ],
  terms: [
    item('price_terms','Confirm price and material terms','shared'),
    item('review_before_sign','Review the offer before signature','shared', buyerTask('Each person confirms what the terms protect and give up', 2)),
    item('document_delivery','Submit and document delivery','hbe', hbeTask('Document delivery and keep alternatives visible after submission', 1, 'critical'))
  ],
  negotiation: [
    item('evaluate_counter','Evaluate the counter against the WHY','shared'),
    item('keep_alternative','Keep at least one alternative visible','hbe', hbeTask('Place the next-best alternative beside the counter', 1, 'critical')),
    item('choose_path','Choose proceed, counter, or walk away','shared', buyerTask('Both people confirm the choice from their own logins', 1, 'critical'))
  ],
  diligence: [
    item('disclosures','Review disclosures and transaction records','shared'),
    item('new_facts','Track new facts as they appear','hbe', hbeTask('Log each new fact and what it changes', 2)),
    item('what_changed','Ask what each new fact changes about the decision','shared')
  ],
  inspection: [
    item('findings_sorted','Separate routine maintenance from meaningful risk','shared'),
    item('specialists','Identify specialist or follow-up needs','hbe', hbeTask('Queue specialist follow-up if findings warrant it', 2, 'critical')),
    item('response','Choose repairs, credits, acceptance, or exit when available','shared', buyerTask('Household records the inspection response choice', 2, 'critical'))
  ],
  value: [
    item('appraisal','Review appraisal and other value evidence','shared'),
    item('gap','Understand any value gap and its consequences','hbe', hbeTask('Explain the value-gap options in household language', 2)),
    item('protect','Choose the response that best protects the household','shared')
  ],
  loan: [
    item('underwriting','Track underwriting and lender conditions','hbe', hbeTask('Watch lender conditions so closing is not surprised', 3, 'critical')),
    item('cash_picture','Review final cash, payment, and financing expectations','shared', buyerTask('Confirm the cash-to-close picture you can actually live with', 3)),
    item('financing_risks','Protect the transaction from avoidable financing problems','hbe')
  ],
  commitment: [
    item('compare_then_now','Compare what you know now with what you knew at the start','shared'),
    item('remaining_risks','Confirm remaining risks and obligations','hbe'),
    item('still_serves_why','Make sure the home still serves your WHY','shared', buyerTask('Each buyer confirms the final-commitment decision from their login', 2, 'critical'))
  ],
  closing: [
    item('walkthrough','Final walk-through completed','shared', deadline('Final walk-through', 1, 'critical')),
    item('closing_complete','Closing completed','hbe', hbeTask('Keep wiring and last-mile logistics boring and safe', 1, 'critical')),
    item('possession','Keys and possession confirmed','shared', buyerTask('Confirm possession facts before celebration', 1, 'critical'))
  ],
  afterKeys: [
    item('settling_in','Settling-in / 30-day check','shared', hbeTask('Offer a settling-in check-in that is useful, not a review request', 30)),
    item('surprised_90','90-day “what surprised you?” review','shared', buyerTask('Tell HBE what the house is like on a Tuesday, not just closing day', 90)),
    item('one_year','One-year home + decision review','shared', hbeTask('Invite a one-year home and decision review', 365)),
    item('anniversary','Anniversary / long-horizon check-ins','hbe', hbeTask('Park a long-horizon anniversary reminder', 400)),
    item('warranty_vendor','Warranty, vendor, tax, insurance, and home-performance follow-ups','shared', hbeTask('Route warranty/vendor/tax/insurance/home-performance questions without pressure', 14))
  ]
};

export function stageById(id) {
  return STAGES.find(s => s[0] === id) || null;
}

export function stageLabel(id) {
  if (id === 'complete') return 'Journey complete';
  return stageById(id)?.[1] || id;
}

export function stageIndex(id) {
  return STAGES.findIndex(s => s[0] === id);
}

export function assertSeventeenStages() {
  if (STAGES.length !== STAGE_COUNT) {
    throw new Error(`Expected ${STAGE_COUNT} stages, found ${STAGES.length}`);
  }
  if (STAGES[15][0] !== 'closing' || STAGES[15][1] !== 'Get the Keys') {
    throw new Error('Stage 16 must remain Get the Keys');
  }
  if (STAGES[16][0] !== 'afterKeys' || STAGES[16][1] !== 'After the Keys') {
    throw new Error('Stage 17 must be After the Keys');
  }
  const banned = ['care30','care90','care365','anniversary','careAnniversary'];
  for (const id of banned) {
    if (STAGES.some(s => s[0] === id)) throw new Error(`Do not create extra stage ${id}`);
  }
  return true;
}

export const COMPENSATION_PUBLIC = {
  headline: 'Compensation is negotiable.',
  body: 'How HBE is paid depends on the written representation arrangement you actually agree to. HomeBuyer Experts does not publish percentages, dollar amounts, fee schedules, or preset packages on public or pre-hire pages. Seller-paid compensation is not automatic or guaranteed.'
};

export const COMPENSATION_POST_HIRE_NOTE = 'After hire, this private household surface may show the actual negotiated arrangement from the signed agreement. It is not a public rate card.';
