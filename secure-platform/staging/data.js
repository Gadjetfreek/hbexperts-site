/**
 * Synthetic staging data only.
 * Assumption: live currently has 16 stages ending at Get the Keys.
 * Stage 17 is post-closing care ("After the keys").
 * Stages 18-21 are 30/90/365-day and anniversary follow-up.
 * Do not replace Get the Keys.
 */
export const ADMIN_EMAIL = 'cwhitehead@hbexperts.com';

export const DEMO = {
  alexEmail: 'alex.rivera@example.test',
  samEmail: 'sam.rivera@example.test',
  alexCode: 'ALEX-RIVERA-DEMO',
  samCode: 'SAM-RIVERA-DEMO',
  inviteToken: 'forge-rivera-sam-invite'
};

export const HOUSEHOLD = {
  id: 'synthetic-rivera',
  lastName: 'Rivera',
  hired: true,
  currentStage: 'possibilities',
  sharedFacts: {
    optimizing: 'A calmer daily home base with a practical commute and enough room to host family without the house becoming the center of life.',
    tradeoff: 'Willing to trade some square footage for location, condition, and a neighborhood that feels settled.',
    uncertainty: 'Which streets still feel right on a weeknight after dark, and whether a smaller house will still work when family visits.',
    evidence: 'Consultation complete. Representation chosen. Search criteria drafted around commute, quiet, gathering space, and condition.',
    nextTalk: 'Look at three homes that test the space-versus-location tradeoff rather than hunting for a perfect checklist match.'
  },
  sharedStory: 'We are trying to make daily life quieter without giving up a workable commute or the chance to have people over. We would rather get the street and the condition right than win on square footage. The decision only works if both of us understand the tradeoff and can still recognize ourselves in the house.',
  hbeStory: 'Rivera household: two decision-makers, one shared journey. Optimize for calm daily life, a practical commute, gathering space, neighborhood feel, and condition over maximum size. Alex wants major risks named before deciding. Sam wants time to talk through how a place feels. Do not collapse that difference into a fake consensus — surface the tradeoff. Representation is active; current stage is Discover Possibilities. Watch for jumping to offer-readiness before the search has taught them what they actually value on the ground.'
};

export const PEOPLE = {
  alex: {
    id: 'alex-rivera',
    first: 'Alex',
    full: 'Alex Rivera',
    email: DEMO.alexEmail,
    voice: 'I want a home that makes ordinary days calmer without making work and family harder to reach. I would rather see the real risks named than be surprised later.',
    privateNote: 'Alex tends to want the major risks named clearly and prefers evidence side by side. Do not dump questionnaire answers into the buyer view.',
    greeting: "You're signed in as Alex Rivera — your private view. Sam is part of this household and has a separate login."
  },
  sam: {
    id: 'sam-rivera',
    first: 'Sam',
    full: 'Sam Rivera',
    email: DEMO.samEmail,
    voice: 'I want enough room for people to gather, but I do not want the house itself to become the thing our life revolves around. I need time to feel a street, not just score it.',
    privateNote: 'Sam wants time to talk through tradeoffs and cares strongly about how the street and neighborhood feel. Private reflections stay on this login.',
    greeting: "You're signed in as Sam Rivera — your private view. Alex is part of this household and has a separate login."
  }
};

function item(label, done = false, early = null) {
  return { label, done, early };
}

export const STAGES = [
  {
    id: 'buyerExperience',
    name: 'Buyer Experience',
    summary: 'Start with what matters to you',
    bullets: [
      'Share what is bringing you to the idea of buying a home.',
      'Tell us what you know, what you do not know, and what you are worried about.',
      'Give HBE a useful starting point without needing perfect answers.'
    ],
    checklist: [
      item('Buyer Experience submitted', true),
      item('HBE notified that a private record exists', true),
      item('Cross-device access created for this buyer', true)
    ]
  },
  {
    id: 'consultation',
    name: 'Consultation',
    summary: 'Turn answers into understanding',
    bullets: [
      'Talk through your Buyer Experience with an HBE advisor.',
      'Clarify priorities, tradeoffs, timing, risks, and unanswered questions.',
      'Decide whether HBE feels like the right fit for you.'
    ],
    checklist: [
      item('Consultation held', true),
      item('Priorities and tradeoffs named in household language', true),
      item('Fit with HBE discussed without pressure to hire', true)
    ]
  },
  {
    id: 'representation',
    name: 'Hire HBE',
    summary: 'Choose your representation deliberately',
    bullets: [
      'Understand who HBE represents and what fiduciary representation means.',
      'Review responsibilities and the written agency agreement.',
      'Choose whether to hire HBE without pressure. Compensation is discussed after that choice, and it is negotiable.'
    ],
    checklist: [
      item('Representation choice recorded for each buyer', true),
      item('Written agreement reviewed and signed', true),
      item('Compensation arrangement recorded in the agreement — negotiable, not a public rate card', true)
    ]
  },
  {
    id: 'search',
    name: 'Build Your Home Search',
    summary: 'Turn priorities into a useful search',
    bullets: [
      'Translate your priorities into search criteria and tradeoffs.',
      'Connect your profile to the search without pretending the first version is final.',
      'Adjust the search as we learn what actually fits.'
    ],
    checklist: [
      item('Shared search geography drafted', true),
      item('Needs separated from preferences', true),
      item('First criteria version confirmed by both buyers', true)
    ]
  },
  {
    id: 'market',
    name: 'Learn the Market',
    summary: 'Understand what the market is really offering',
    bullets: [
      'See what your money buys in the current market.',
      'Compare location, condition, value, and alternatives.',
      'Refine expectations before chasing individual homes.'
    ],
    checklist: [
      item('Review representative listings and recent sales', true),
      item('Name where expectations and the market disagree', true),
      item('Keep alternatives visible before falling in love with one street', false, {
        who: 'hbe',
        text: 'HBE prepares a short market-evidence note: what this budget actually buys in the Riveras’ commute band.'
      })
    ]
  },
  {
    id: 'possibilities',
    name: 'Discover Possibilities',
    summary: 'Find homes worth learning from',
    bullets: [
      'Review homes that may fit your evolving profile.',
      'Notice useful possibilities you did not originally expect.',
      'Flag homes worth seeing without letting the search become noise.'
    ],
    checklist: [
      item('Review today’s best-fit possibilities', false, {
        who: 'buyer',
        text: 'Alex and Sam each react privately to three homes, then compare only the shared facts.'
      }),
      item('Record why rejected homes missed — without blaming either person', false, {
        who: 'hbe',
        text: 'HBE updates the household story with rejection patterns, not a score.'
      }),
      item('Flag homes worth seeing', false, {
        who: 'buyer',
        text: 'Household confirms which homes are actually worth an hour of their life.'
      })
    ]
  },
  {
    id: 'evaluation',
    name: 'Evaluate Homes',
    summary: 'Learn from each property',
    bullets: [
      'Tour homes with an HBE advisor.',
      'Capture details, observations, photos, and questions worth remembering.',
      'Use each home to improve the next decision.'
    ],
    checklist: [
      item('Choose tour candidates', false, {
        who: 'buyer',
        text: 'Checking this before finishing Discover Possibilities asks the household to say why these homes are worth seeing now.'
      }),
      item('Plan an efficient tour and property packet', false, {
        who: 'hbe',
        text: 'Extra HBE action: prepare a tour sequence and a VALUE note for each home.'
      }),
      item('Capture each buyer’s reaction separately', false, {
        who: 'hbe',
        text: 'HBE records Alex’s and Sam’s reactions as two voices, not one blended score.'
      })
    ]
  },
  {
    id: 'offer',
    name: 'Ready to Offer?',
    summary: 'Decide before negotiating',
    bullets: [
      'Separate excitement from decision quality.',
      'Identify what is still unknown and what could change the decision.',
      'Choose whether making an offer actually serves your goals.'
    ],
    checklist: [
      item('Name the walk-away boundary', false, {
        who: 'buyer',
        text: 'Checking this early asks the household to talk about the point where this stops being the right house — before urgency does it for them.'
      }),
      item('List remaining unknowns that could change the choice', false, {
        who: 'hbe',
        text: 'Extra HBE action: identify unresolved facts worth investigating before any offer is drafted.'
      }),
      item('Decide whether an offer serves the WHY', false)
    ]
  },
  {
    id: 'terms',
    name: 'Build the Offer',
    summary: 'Construct price and terms deliberately',
    bullets: [
      'Choose price, timing, contingencies, and protections consciously.',
      'Understand what each term gives up or protects.',
      'Build an offer you can live with whether it wins or loses.'
    ],
    checklist: [
      item('Confirm price and material terms', false),
      item('Review the offer before signature', false, {
        who: 'buyer',
        text: 'Buyer action: each person confirms they understand what the terms protect and what they give up.'
      }),
      item('Submit and document delivery', false, {
        who: 'hbe',
        text: 'Extra HBE action: document delivery and keep alternatives visible after submission.'
      })
    ]
  },
  {
    id: 'negotiation',
    name: 'Negotiate Wisely',
    summary: 'Protect leverage and your WHY',
    bullets: [
      'Evaluate counters, concessions, and seller responses.',
      'Keep alternatives and leverage visible.',
      'Choose when to proceed, counter, or walk away.'
    ],
    checklist: [
      item('Evaluate the counter against the WHY', false),
      item('Keep at least one alternative visible', false, {
        who: 'hbe',
        text: 'Extra HBE action: put the next-best alternative next to the counter so urgency does not erase it.'
      }),
      item('Choose proceed, counter, or walk away', false, {
        who: 'buyer',
        text: 'Buyer action: both people confirm the choice; one login cannot decide for the other.'
      })
    ]
  },
  {
    id: 'diligence',
    name: 'Learn What We Did Not Know',
    summary: 'Investigate before commitment hardens',
    bullets: [
      'Review disclosures, records, transaction details, and unanswered questions.',
      'Track new facts as they appear.',
      'Ask what each new fact changes about the decision.'
    ],
    checklist: [
      item('Disclosures and records reviewed', false),
      item('New facts logged against the original WHY', false, {
        who: 'hbe',
        text: 'Extra HBE action: map each new fact to what it changes, not just whether it is “normal.”'
      }),
      item('Household says what still has to be true', false, {
        who: 'buyer',
        text: 'Buyer action: name what would make this the wrong house even after being under contract.'
      })
    ]
  },
  {
    id: 'inspection',
    name: 'Inspection Decision',
    summary: 'Put inspection findings in context',
    bullets: [
      'Separate routine maintenance from meaningful risk.',
      'Identify specialist or follow-up needs.',
      'Choose repairs, credits, acceptance, or exit when available.'
    ],
    checklist: [
      item('Inspection completed', false),
      item('Findings sorted by consequence, not by scare', false, {
        who: 'hbe',
        text: 'Extra HBE action: prepare an inspection decision brief before anyone is asked to “just deal with it.”'
      }),
      item('Household chooses repair, credit, accept, or exit', false, {
        who: 'buyer',
        text: 'Buyer action: choose the response that protects the WHY, including walking away if that is best.'
      })
    ]
  },
  {
    id: 'value',
    name: 'Value Check',
    summary: 'Compare price with independent evidence',
    bullets: [
      'Review appraisal and other value evidence.',
      'Understand any value gap and its consequences.',
      'Choose the response that best protects you.'
    ],
    checklist: [
      item('Appraisal and value evidence reviewed', false),
      item('Any gap is named as a choice, not a surprise', false, {
        who: 'hbe',
        text: 'Extra HBE action: explain gap options without steering the household into overpaying to “win.”'
      }),
      item('Household chooses the response', false, {
        who: 'buyer',
        text: 'Buyer action: decide whether the house still earns this price given what you know now.'
      })
    ]
  },
  {
    id: 'loan',
    name: 'Final Financing',
    summary: 'Finish financing without surprises',
    bullets: [
      'Track underwriting and lender conditions.',
      'Review final cash, payment, and financing expectations.',
      'Protect the transaction from avoidable financing problems.'
    ],
    checklist: [
      item('Lender milestones on track', false),
      item('Final cash and payment reviewed in household language', false, {
        who: 'buyer',
        text: 'Buyer action: both people confirm the cash-to-close picture before the last week.'
      }),
      item('Avoidable financing problems closed', false, {
        who: 'hbe',
        text: 'Extra HBE action: chase outstanding conditions before they become a closing-week emergency.'
      })
    ]
  },
  {
    id: 'commitment',
    name: 'Final Decision',
    summary: 'Ask whether this is still the right choice',
    bullets: [
      'Compare what you know now with what you knew when you started.',
      'Confirm remaining risks and obligations.',
      'Make sure the home still serves your WHY before final commitment.'
    ],
    checklist: [
      item('Re-read the original WHY against the house you are buying', false, {
        who: 'buyer',
        text: 'Buyer action: each person answers, privately, whether this still serves the life they described.'
      }),
      item('Remaining risks named without minimizing', false, {
        who: 'hbe',
        text: 'Extra HBE action: put remaining risks next to the original story, including the option not to close.'
      }),
      item('Final commitment is deliberate', false)
    ]
  },
  {
    id: 'closing',
    name: 'Get the Keys',
    summary: 'Complete the purchase and take possession',
    bullets: [
      'Verify final documents, funds, and logistics.',
      'Complete the final walk-through and closing.',
      'Get the keys and begin making the home yours.'
    ],
    checklist: [
      item('Final walk-through completed', false),
      item('Closing completed', false, {
        who: 'hbe',
        text: 'Extra HBE action: keep wiring and last-mile logistics boring and safe.'
      }),
      item('Keys and possession confirmed', false, {
        who: 'buyer',
        text: 'Buyer action: confirm possession facts; celebration comes after the facts are final.'
      })
    ]
  },
  {
    id: 'afterKeys',
    name: 'After the keys',
    summary: 'Post-closing care — the relationship does not end at the table',
    bullets: [
      'Settle in with a human still available for the first surprises.',
      'Use the first weeks to notice what the home is teaching you.',
      'Keep HBE as a resource, not as a leftover transaction.'
    ],
    checklist: [
      item('Welcome-home check: utilities, keys, first surprises', false, {
        who: 'hbe',
        text: 'Extra HBE action: send a settling-in check-in that is useful, not a review request.'
      }),
      item('Household records what the first week taught them', false, {
        who: 'buyer',
        text: 'Buyer action: write what surprised you — this feeds the year-one story, not a questionnaire dump.'
      }),
      item('Warranty / vendor questions routed without pressure', false)
    ]
  },
  {
    id: 'care30',
    name: '30-day care',
    summary: 'A short check-in after the move is real',
    bullets: [
      'Urgent surprises, vendors, and warranty questions.',
      'What already feels right or wrong in daily life.',
      'Whether any follow-up still serves the household.'
    ],
    checklist: [
      item('30-day settling-in conversation offered', false, {
        who: 'hbe',
        text: 'Extra HBE action: schedule a 30-day homeowner check-in.'
      }),
      item('Household names the first real surprises', false, {
        who: 'buyer',
        text: 'Buyer action: tell HBE what the house is like on a Tuesday, not just closing day.'
      }),
      item('Open vendor / warranty items closed or parked', false)
    ]
  },
  {
    id: 'care90',
    name: '90-day care',
    summary: 'What changed after living there?',
    bullets: [
      'Update the household story with lived evidence.',
      'Notice whether the original tradeoff still feels honest.',
      'Ask what would be useful from HBE now — including nothing.'
    ],
    checklist: [
      item('90-day “what surprised you?” review offered', false, {
        who: 'hbe',
        text: 'Extra HBE action: invite a 90-day story update, not a sales follow-up.'
      }),
      item('Shared story updated in the household’s voice', false, {
        who: 'buyer',
        text: 'Buyer action: rewrite one paragraph of the story now that you have lived there.'
      }),
      item('Seasonal / maintenance picture sketched', false)
    ]
  },
  {
    id: 'care365',
    name: 'One-year review',
    summary: 'Look back at the decision with a year of evidence',
    bullets: [
      'Review the purchase against the original WHY.',
      'Home performance, taxes, insurance, and future plans.',
      'Decide whether ongoing HBE care is still useful.'
    ],
    checklist: [
      item('One-year ownership review offered', false, {
        who: 'hbe',
        text: 'Extra HBE action: schedule the one-year decision review.'
      }),
      item('Household says whether the tradeoff was honest', false, {
        who: 'buyer',
        text: 'Buyer action: answer, in your own words, whether this is still the right house.'
      }),
      item('Next-year plans recorded only if useful', false)
    ]
  },
  {
    id: 'anniversary',
    name: 'Anniversary follow-up',
    summary: 'Light-touch care for as long as it remains useful',
    bullets: [
      'A human check-in on each purchase anniversary, if you want it.',
      'No manufactured reason to transact.',
      'People remain the purpose after the paperwork is over.'
    ],
    checklist: [
      item('Anniversary note offered — easy to decline', false, {
        who: 'hbe',
        text: 'Extra HBE action: a light anniversary check-in, not a listing pitch.'
      }),
      item('Household keeps or pauses ongoing care', false, {
        who: 'buyer',
        text: 'Buyer action: say whether you still want a human in this story.'
      }),
      item('No pressure to buy, sell, or refer', false)
    ]
  }
];

export const FOLLOW_UP = [
  ['30 days', 'Settling-in check: urgent surprises, vendors, warranty questions.'],
  ['90 days', 'What changed after living there? Update the household story with lived evidence.'],
  ['365 days', 'Review the purchase decision, home performance, taxes/insurance, and whether the original WHY still holds.'],
  ['Each anniversary', 'Light-touch homeowner check-in for as long as it remains useful. Easy to decline. Never a reason to manufacture a transaction.']
];

export const COMPENSATION_POST_HIRE = [
  {
    title: 'Seller-offered compensation',
    body: 'Where a seller or listing broker offers compensation, HBE can apply it in the buyer’s interest under the written agreement.'
  },
  {
    title: 'Buyer-paid professional fee',
    body: 'A direct buyer-paid arrangement when that is the clearest, most loyal structure for this household.'
  },
  {
    title: 'Negotiated combination',
    body: 'A written mix of sources, credits, or retainers when permitted and actually better for the buyer. There is no posted “standard” rate.'
  }
];
