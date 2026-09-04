/**
 * HBE Showing Card dossier schema (v1).
 * Generic field definitions for property walk-throughs.
 * Instance answers live in D1 — never commit completed answers.
 */

export const DOSSIER_VERSION = 'brigham-v1';

export const YN_UNCLEAR = ['Yes', 'No', 'Unclear'];
export const RATING_1_5 = ['1', '2', '3', '4', '5'];

/** @typedef {'yn_unclear'|'option'|'multi_option'|'rating_1_5'|'count'|'dimensions'|'short_text'|'long_text'|'checklist'|'table'|'readonly'|'photo_prompt'} FieldType */

/**
 * @param {string} id
 * @param {string} label
 * @param {FieldType} type
 * @param {object} [extra]
 */
function f(id, label, type, extra = {}) {
  return { id, label, type, photos: extra.photos !== false, ...extra };
}

export const DOSSIER_SECTIONS = [
  {
    id: 'header_visit',
    title: 'Header / visit',
    fields: [
      f('visit_date', 'Visit date', 'short_text', { input: 'date', photos: false }),
      f('start_time', 'Start time', 'short_text', { input: 'time', photos: false }),
      f('end_time', 'End time', 'short_text', { input: 'time', photos: false }),
      f('weather', 'Weather', 'short_text', { photos: false }),
      f('immediate_observations', 'Immediate observations / deal-breakers', 'long_text')
    ]
  },
  {
    id: 'six_must_answer',
    title: 'Six things that must be answered before leaving',
    fields: [
      f('must_traffic_noise', 'Is road/traffic noise acceptable at the house?', 'yn_unclear'),
      f('must_first_floor', 'Can they live comfortably on the first floor with minimal daily steps?', 'yn_unclear'),
      f('must_kitchen', "Does Richard's kitchen actually work, especially counter landing space around the cooktop/range?", 'yn_unclear'),
      f('must_offices', 'Are there two genuinely useful work/office spaces?', 'yn_unclear'),
      f('must_acreage_feel', 'Does the 6.1-acre setting feel private and peaceful rather than burdensome?', 'yn_unclear'),
      f('must_condition_issue', 'Did you see any condition, water, roof, septic, road, or maintenance issue that changes the value story?', 'yn_unclear')
    ]
  },
  {
    id: 'known_facts',
    title: 'Known-facts reference panel',
    fields: [
      f('ref_ask_history', 'Ask / history', 'readonly', {
        photos: false,
        value: '$699,900 now; sold $550,000 Feb 2025; sold $455,000 Oct 2022'
      }),
      f('ref_house', 'House', 'readonly', {
        photos: false,
        value: '1977; 4 BR; 2 full + 1 half bath; 2-car attached garage; 6.10 acres'
      }),
      f('ref_living_area', 'Living area', 'readonly', {
        photos: false,
        value: 'Auditor 2,843 sf above grade + 899 sf basement; current MLS treats all 899 basement sf as finished — verify'
      }),
      f('ref_utilities', 'Utilities', 'readonly', {
        photos: false,
        value: 'Public water; septic; seller says septic inspected 6/3/2025 by The Potters Co.'
      }),
      f('ref_roof', 'Roof', 'readonly', {
        photos: false,
        value: 'Wood shake; age/condition/repairs/insurability/remaining life matter'
      }),
      f('ref_association', 'Association', 'readonly', {
        photos: false,
        value: 'Highwood Road Association, current MLS $2,400/year; prior listings $1,750/year'
      }),
      f('ref_upgrades', 'Seller-reported upgrades', 'readonly', {
        photos: false,
        value: 'Septic, heat pump, A/C, furnace, electrical panel, EV outlet, rec room, appliances, paint/landscaping; some predate current ownership — verify dates'
      }),
      f('ref_disclosure', 'Disclosure posture', 'readonly', {
        photos: false,
        value: 'Seller reports no known material water/septic/roof/intrusion/structural/termite/mechanical/drainage/zoning/boundary issues; seller-knowledge only, not an inspection'
      }),
      f('before_leaving_checklist', 'Before-leaving checklist', 'checklist', {
        photos: false,
        options: [
          'traffic test done',
          'step counts done',
          'kitchen measured',
          'workspaces measured',
          'HVAC/panel/roof photos',
          'stream/septic/road inspected'
        ]
      })
    ]
  },
  {
    id: 's1_approach',
    title: 'Section 1 — Approach / road / privacy',
    fields: [
      f('s1_brigham_feel', 'Brigham approach feels', 'option', {
        options: ['quiet', 'moderate', 'busy', 'unexpectedly busy']
      }),
      f('s1_entrance_safe', 'Entrance/private-road turn easy and safe in both directions', 'option', {
        options: ['yes', 'no', 'uncertain']
      }),
      f('s1_road_condition', 'Road/private lane condition', 'option', {
        options: ['good', 'fair', 'poor']
      }),
      f('s1_potholes_notes', 'Potholes / drainage / shoulders notes', 'long_text'),
      f('s1_winter_concern', 'Winter concern: grade, snow storage, plow access, ice, tree canopy, sight distance', 'long_text'),
      f('s1_neighbors_visible', 'Neighbors visible from house in leaf-on condition', 'option', {
        options: ['none', 'some', 'significant']
      }),
      f('s1_winter_privacy', 'Likely winter privacy after leaves drop', 'option', {
        options: ['strong', 'moderate', 'weak', 'unknown']
      }),
      f('s1_approach_notes', 'Approach/access notes', 'long_text')
    ]
  },
  {
    id: 's1_listening',
    title: 'Section 1 — 10-minute listening test',
    fields: [
      f('s1_listening_table', 'Listening test rows', 'table', {
        photos: false,
        rowLabel: 'Location',
        presetRows: ['Lane / road entrance', 'House — front', 'Rear / deck', 'Primary-bedroom side'],
        columns: [
          { id: 'minutes', label: 'Time / minutes', type: 'short_text' },
          { id: 'vehicles_seen', label: 'Vehicles seen', type: 'count' },
          { id: 'vehicles_heard', label: 'Vehicles heard', type: 'count' },
          { id: 'trucks_bikes', label: 'Trucks / bikes', type: 'short_text' },
          { id: 'noise', label: 'Noise 1–5', type: 'rating_1_5' },
          { id: 'feels_like', label: 'What it feels like', type: 'short_text' }
        ]
      }),
      f('s1_noise_character', 'Noise character', 'long_text', {
        placeholder: 'Steady hum, individual bursts, motorcycles, acceleration from intersection, birds/water masking it, etc.'
      })
    ]
  },
  {
    id: 's1_impression',
    title: 'Section 1 — First impression of setting',
    fields: [
      f('s1_privacy_rating', 'Privacy / seclusion', 'rating_1_5'),
      f('s1_privacy_notes', 'Privacy / seclusion notes', 'short_text', { photos: false }),
      f('s1_quiet_rating', 'Quietness', 'rating_1_5'),
      f('s1_quiet_notes', 'Quietness notes', 'short_text', { photos: false }),
      f('s1_curb_rating', 'Arrival / curb appeal', 'rating_1_5'),
      f('s1_curb_notes', 'Arrival / curb appeal notes', 'short_text', { photos: false }),
      f('s1_burden_rating', 'Maintenance burden', 'rating_1_5'),
      f('s1_burden_notes', 'Maintenance burden notes', 'short_text', { photos: false })
    ]
  },
  {
    id: 's2_steps',
    title: 'Section 2 — Step counts & daily route',
    fields: [
      f('s2_steps_table', 'Step counts', 'table', {
        photos: false,
        rowLabel: 'Route',
        presetRows: [
          'Drive/garage → house',
          'Garage entry → kitchen',
          'Kitchen → laundry',
          'Primary → bath/closet',
          'Main floor → rear deck/yard',
          'Main floor → basement'
        ],
        columns: [
          { id: 'steps', label: 'Step count / threshold', type: 'short_text' },
          { id: 'easy', label: 'Easy?', type: 'option', options: ['yes', 'no'] },
          { id: 'notes', label: 'Notes', type: 'short_text' }
        ]
      })
    ]
  },
  {
    id: 's2_rooms',
    title: 'Section 2 — Room measurements / usefulness',
    fields: [
      f('s2_rooms_table', 'Room measurements', 'table', {
        photos: true,
        rowLabel: 'Room',
        presetRows: [
          'Kitchen',
          'Primary bedroom',
          'Primary bath',
          'Primary closet',
          '2nd main-floor bedroom',
          'Office',
          'Laundry',
          'Great / living room',
          'Dining area'
        ],
        columns: [
          { id: 'dimensions', label: 'Approx dimensions', type: 'dimensions' },
          { id: 'outlets_light', label: 'Outlets / light', type: 'short_text' },
          { id: 'likely_use', label: 'Likely use / fit', type: 'short_text' },
          { id: 'notes', label: 'Notes', type: 'short_text' }
        ]
      })
    ]
  },
  {
    id: 's2_kitchen',
    title: 'Section 2 — Kitchen — do not leave without this',
    fields: [
      f('s2_cooktop_type', 'Cooktop/range type & width', 'short_text'),
      f('s2_landing_left', 'Counter landing LEFT of cooking surface — inches', 'dimensions'),
      f('s2_landing_right', 'Counter landing RIGHT of cooking surface — inches', 'dimensions'),
      f('s2_island_clearances', 'Island clearances / pinch points', 'long_text'),
      f('s2_appliance_interfere', 'Fridge / oven / DW doors interfere with traffic?', 'option', {
        options: ['No', 'Yes + explanation']
      }),
      f('s2_appliance_interfere_explain', 'If yes — explanation', 'long_text', { photos: false }),
      f('s2_pantry', 'Pantry / food storage', 'option', {
        options: ['strong', 'adequate', 'weak']
      }),
      f('s2_richard_spread', 'Can Richard spread out while cooking?', 'option', {
        options: ['yes', 'maybe', 'no']
      }),
      f('s2_kitchen_notes', 'Kitchen notes', 'long_text'),
      f('s2_photo_cooking_wall', 'Photo: entire cooking wall straight-on', 'photo_prompt'),
      f('s2_photo_island', 'Photo: island from cooking side', 'photo_prompt')
    ]
  },
  {
    id: 's3_roof',
    title: 'Section 3 — Roof / exterior envelope',
    fields: [
      f('s3_shake_condition', 'Wood shake condition', 'multi_option', {
        options: ['good-looking', 'weathered', 'curling-splitting', 'moss-algae', 'repairs visible']
      }),
      f('s3_roof_staining', 'Roof staining / soft-looking areas / flashing / chimney / gutter overflow evidence', 'long_text'),
      f('s3_exterior_condition', 'Exterior wood/brick/siding condition; peeling paint; rot; caulk gaps; deck/rail condition', 'long_text'),
      f('s3_foundation', 'Foundation exterior: cracks, settlement indicators, efflorescence, grading toward house', 'long_text'),
      f('s3_roof_notes', 'Roof/exterior notes', 'long_text')
    ]
  },
  {
    id: 's3_mechanical',
    title: 'Section 3 — Mechanical / electrical — photograph data plates',
    fields: [
      f('s3_furnace_brand', 'Furnace brand/model', 'short_text', { photos: true }),
      f('s3_furnace_year', 'Furnace mfg year / serial', 'short_text', { photos: true }),
      f('s3_heatpump_brand', 'Heat pump / A/C brand/model', 'short_text', { photos: true }),
      f('s3_heatpump_year', 'Heat pump / A/C mfg year / serial', 'short_text', { photos: true }),
      f('s3_water_heater', 'Water heater', 'short_text', { photos: true }),
      f('s3_water_heater_age', 'Water heater age/type', 'short_text', { photos: true }),
      f('s3_panel_brand', 'Electrical panel brand', 'short_text', { photos: true }),
      f('s3_service_amps', 'Service amps', 'short_text', { photos: true }),
      f('s3_ev_outlet', 'EV outlet location/type', 'short_text', { photos: true }),
      f('s3_ev_pro', 'EV outlet looks professional?', 'option', { options: ['Yes', 'No'], photos: true }),
      f('s3_mech_ref', 'Reference note', 'readonly', {
        photos: false,
        value: 'Seller calls several systems “recent”; use labels/stickers to establish actual ages and distinguish current-seller work from improvements that already existed before Feb 2025.'
      })
    ]
  },
  {
    id: 's3_basement',
    title: 'Section 3 — Basement / lower level — square footage check',
    fields: [
      f('s3_basement_899', 'Basement total area feels close to 899 sf', 'option', {
        options: ['yes', 'no', 'cannot tell']
      }),
      f('s3_finished_sf', 'Approx finished sf', 'short_text'),
      f('s3_finished_rooms', 'Finished rooms', 'long_text'),
      f('s3_second_kitchen', 'Second kitchen/cabinet area usable?', 'option', {
        options: ['yes', 'limited', 'not really']
      }),
      f('s3_basement_appliances', 'Appliances', 'short_text'),
      f('s3_workroom', 'Potential workroom', 'option', {
        options: ['strong', 'possible', 'poor']
      }),
      f('s3_natural_light', 'Natural light / egress', 'long_text'),
      f('s3_moisture', 'Moisture smell / staining / efflorescence / dehumidifier / sump / fresh paint hiding clues', 'long_text'),
      f('s3_stairs_width', 'Stairs width', 'short_text'),
      f('s3_stairs_steep', 'Stairs steep?', 'option', { options: ['Yes', 'No'] }),
      f('s3_railings', 'Railings', 'option', { options: ['good', 'weak'] }),
      f('s3_daily_burden', 'Daily-use burden', 'long_text'),
      f('s3_lower_notes', 'Lower-level notes', 'long_text')
    ]
  },
  {
    id: 's3_septic',
    title: 'Section 3 — Septic / water / lead',
    fields: [
      f('s3_public_water', 'Public water: confirm meter/service visible', 'long_text'),
      f('s3_septic_locate', 'Septic: locate tank/aerator/controls/field if visible', 'long_text'),
      f('s3_septic_record', 'Known record (read-only)', 'readonly', {
        photos: false,
        value: 'Seller disclosure says septic inspected 6/3/2025 by The Potters Co.'
      }),
      f('s3_variance_note', '2023 variance note (read-only)', 'readonly', {
        photos: false,
        value: 'Do not diagnose onsite; note site constraints and request full county file/final approval'
      }),
      f('s3_lead_note', 'Lead note (read-only)', 'readonly', {
        photos: false,
        value: '1977 house; sellers report no knowledge of lead hazards and no reports'
      })
    ]
  },
  {
    id: 's4_drainage',
    title: 'Section 4 — Stream / spring / drainage / topography',
    fields: [
      f('s4_stream_locate', 'Locate stream/spring relative to house, deck, driveway, and septic', 'long_text'),
      f('s4_drainage_notes', 'Site sketch / drainage notes', 'long_text', {
        placeholder: 'Text is acceptable for v1'
      }),
      f('s4_wet_zones', 'Wet/muddy zones despite current weather', 'option', {
        options: ['none', 'some', 'significant']
      }),
      f('s4_slopes', 'Ground slopes toward house', 'option', {
        options: ['no', 'some locations', 'yes']
      }),
      f('s4_culverts', 'Culverts / swales / drains functioning', 'option', {
        options: ['yes', 'concerns', 'cannot tell']
      }),
      f('s4_erosion', 'Erosion / exposed roots / bank instability / standing water / retaining walls', 'long_text'),
      f('s4_trees', 'Large trees close enough to threaten roof/drive', 'option', {
        options: ['few', 'several', 'significant']
      })
    ]
  },
  {
    id: 's4_hoa',
    title: 'Section 4 — Highwood Road Association',
    fields: [
      f('s4_hoa_fee_ref', 'Fee reference (read-only)', 'readonly', {
        photos: false,
        value: 'Current MLS fee: $2,400/year. Prior MLS fee: $1,750/year in 2022 & 2024 — ask why increased.'
      }),
      f('s4_road_today', 'Road condition today', 'long_text'),
      f('s4_hoa_drainage', 'Drainage / culverts', 'long_text'),
      f('s4_plow', 'Plow / winter implications', 'long_text'),
      f('s4_recreation', '“Recreation” inclusion in MLS — what exactly is included?', 'long_text'),
      f('s4_hoa_caution', 'Association caution (read-only)', 'readonly', {
        photos: false,
        value: 'Governing documents place the parcel in Highwood Road Association and permit ordinary/extraordinary road expenses; owner-caused road damage from contractors/trucks can be charged to that owner; access changes require Board approval. Before offer, obtain current budget, reserves, minutes, insurance, planned road work, assessment history, and current balance/ledger.'
      })
    ]
  },
  {
    id: 's4_burden',
    title: 'Section 4 — Maintenance-burden reality check',
    fields: [
      f('s4_wooded_rating', 'Wooded acreage / leaves / deadfall', 'rating_1_5'),
      f('s4_wooded_notes', 'Wooded acreage notes', 'short_text', { photos: false }),
      f('s4_drive_rating', 'Drive/private road exposure', 'rating_1_5'),
      f('s4_drive_notes', 'Drive/private road notes', 'short_text', { photos: false }),
      f('s4_decks_rating', 'Decks / gazebo / sheds', 'rating_1_5'),
      f('s4_decks_notes', 'Decks / gazebo / sheds notes', 'short_text', { photos: false }),
      f('s4_shake_burden_rating', 'Wood shake roof burden', 'rating_1_5'),
      f('s4_shake_burden_notes', 'Wood shake roof burden notes', 'short_text', { photos: false }),
      f('s4_stream_burden_rating', 'Stream / drainage burden', 'rating_1_5'),
      f('s4_stream_burden_notes', 'Stream / drainage burden notes', 'short_text', { photos: false }),
      f('s4_future_pool', 'Could a future pool / outbuilding / addition work?', 'long_text', {
        placeholder: 'Do not infer entitlement from acreage; record likely space and constraints only.'
      })
    ]
  },
  {
    id: 's5_shots',
    title: 'Section 5 — Photo/video shot list',
    fields: [
      f('s5_shot_checklist', 'Shot checklist', 'checklist', {
        options: [
          'Approach from Chagrin River Rd and Brigham both directions',
          'Road/private-lane entrance + sight lines',
          '60-sec traffic audio/video: front + rear/deck (note/photo OK for v1)',
          'Front / all four exterior elevations',
          'Roof close-ups + chimney/flashing/gutters',
          'Garage floor + garage-to-house threshold/steps',
          'Kitchen entire cooking wall straight-on',
          'Kitchen island from cooking side + appliance clearances',
          'Laundry entire room/closet + surrounding working space',
          'Primary bedroom/bath/closet door relationships',
          '2nd main-floor bedroom + office from two corners each',
          'All basement rooms + stairs + windows + any stains',
          'Furnace / heat pump / A/C / water-heater data plates',
          'Electrical panel open (if safely accessible) + labels + EV outlet',
          'Septic visible components / controls / field area',
          'Stream/spring + drainage paths + wet areas',
          'Decks / gazebo / sheds / retaining structures',
          'Neighbor visibility through trees / property edges'
        ]
      })
    ]
  },
  {
    id: 's5_fit_score',
    title: 'Section 5 — Steinberger fit score (1 poor – 5 excellent)',
    fields: [
      f('s5_score_quiet', 'Quietness', 'rating_1_5'),
      f('s5_score_first_floor', 'First-floor living', 'rating_1_5'),
      f('s5_score_kitchen', 'Kitchen function', 'rating_1_5'),
      f('s5_score_office', 'Work / office space', 'rating_1_5'),
      f('s5_score_privacy', 'Privacy / setting', 'rating_1_5'),
      f('s5_score_maintenance', 'Maintenance burden', 'rating_1_5'),
      f('s5_score_condition', 'Condition confidence', 'rating_1_5'),
      f('s5_score_value', 'Value impression', 'rating_1_5')
    ]
  },
  {
    id: 's5_narrative',
    title: 'Section 5 — Final narrative',
    fields: [
      f('s5_top3_work', 'Top 3 reasons this could work', 'long_text'),
      f('s5_top3_fail', 'Top 3 reasons this could fail / cost money', 'long_text'),
      f('s5_questions', 'Questions for listing agent / documents to request', 'long_text'),
      f('s5_tell_clients', 'Would I tell Richard & Sally to make the trip?', 'option', {
        options: ['YES', 'MAYBE — after answers', 'NO']
      }),
      f('s5_price_defensible', 'Do I think the asking price might be defensible?', 'option', {
        options: ['YES', 'MAYBE', 'NO — likely high']
      }),
      f('s5_need_before', 'Need before client visit', 'option', {
        options: ['none', 'listing-agent answers', 'septic file', 'HOA docs', 'other']
      }),
      f('s5_one_sentence', 'One-sentence report back to Richard & Sally', 'long_text'),
      f('s5_footer', 'Internal caution (read-only)', 'readonly', {
        photos: false,
        value: 'This is an internal field aid, not an inspection report, survey, title opinion, or septic certification.'
      })
    ]
  }
];

export function allFields() {
  const out = [];
  for (const section of DOSSIER_SECTIONS) {
    for (const field of section.fields) out.push({ ...field, sectionId: section.id, sectionTitle: section.title });
  }
  return out;
}

export function answerableFields() {
  return allFields().filter(f => f.type !== 'readonly');
}

export function fieldById(id) {
  return allFields().find(f => f.id === id) || null;
}

export function sectionIds() {
  return DOSSIER_SECTIONS.map(s => s.id);
}

/** Minimum operational seed identifiers only — no correspondence or private notes. */
export const BRIGHAM_SEED = {
  householdKey: 'hh-steinberger',
  caseId: 'case-steinberger',
  buyerId: 'buyer-steinberger-richard',
  buyerEmail: 'steinberger.buyer@example.test',
  firstName: 'Richard',
  lastName: 'Steinberger',
  propertyId: 'prop-brigham-7511',
  address: '7511 Brigham Rd',
  city: 'Gates Mills',
  state: 'OH',
  zip: '44040',
  mls: '5236567',
  askPrice: 699900
};

export const ORDER_SECTION_TITLES = [
  'Header / visit',
  'Six things that must be answered before leaving',
  'Known-facts reference panel',
  'Section 1 — Arrival, access & traffic test',
  'Section 2 — First-floor fit — Steinberger test',
  'Section 3 — House condition, systems & lower level',
  'Section 4 — Site, water, road association & future burden',
  'Section 5 — Photo/video shot list & final field verdict'
];
