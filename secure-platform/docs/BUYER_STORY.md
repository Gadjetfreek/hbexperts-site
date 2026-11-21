# Your Buyer Story (v1, draft)

An optional last step at the end of the Stage 1 Buyer Experience questionnaire (`/questionnaire`
on buyer.hbexperts.com). It turns the buyer's multiple-choice answers into a short, printable story they keep. The
story speaks in generalities: every sentence comes from the phrase bank, and free-text answers are never
quoted, echoed, or read by the story engine (only `STORY_COPY.structuredFields` are read).

Code: `src/buyer-story.js` (copy module, phrase bank, story engine, page step). Tests:
`tests/buyer-story.test.mjs`. Wiring: `issue33-production-worker.js` (injects the step),
`portal-worker.js` / `ui-worker.js` / `worker.js` (pass the consented story through the existing
intake), `submission-alerts.js` (adds the story to the existing lead email).

## The two choices
- **Download my story** (default). Built in the browser from the fixed phrase bank, selected by the
  buyer's multiple-choice answers. No request is made, nothing is stored, no tags. It opens the browser's print dialog,
  where the buyer picks "Save as PDF" (desktop Chrome/Edge/Safari/Firefox, Android Chrome) or
  Share > Save to Files / Print (iOS Safari). Afterwards the questionnaire's sessionStorage draft
  is cleared.
- **Share my story with HBE and keep my journey**. Disabled until the consent switch (OFF by default) is
  on, and until Part 1's contact fields are filled (the download path never needs them; a "Continue
  without contact details" link on Part 1 relaxes them until the buyer tries to share). The preview has
  a live counter matching the 12,000-character server cap; sharing is blocked above it. It opens the existing "Review & Send" dialog; on send, the normal form post to `/api/intake`
  carries three extra fields (`story_source=buyer_story`, `story_consent=yes`, `story_text`). Without
  consent the server drops the story and saves an ordinary lead (never a 400). The existing flow then writes the buyer row, the
  `buyer_experience_submitted` notification (payload gains `source`, `story_consent`,
  `story_text`) and the `notification_deliveries` row in one D1 batch, and only then sends the
  existing alert email to the existing recipients, with the story after the lead summary. As with any
  submission, the buyer's full questionnaire answers (free text included) are stored on the lead in
  `buyers.answers_json`; the email does not copy them, only the approved story text.

## Why print-to-PDF instead of a PDF library
No new dependency, no CDN, no CSP change (the page CSP is unchanged), text stays selectable and
accessible, and every target browser has a built-in "Save as PDF". A vendored JS PDF library would
add ~300 KB+ to a page buyers fill on phones and would need its own review. Trade-off: the buyer
takes one extra tap in the print dialog.

## Editing copy
Everything the buyer reads lives in `STORY_COPY`: headings, intros, fixed lines, the versioned
phrase bank (one neutral phrase per multiple-choice option; `null` = deliberately left out). Money
worries appear only as general phrases (no figures, prices, budget amounts, or financing/loan type); the
advocate rule table, and the UI labels. Bump `version` / `phraseBankVersion` when copy changes.

## Handling shared stories
- The preview is editable, so treat the shared `story_text` as buyer-authored, not as a record of their answers. It can
  contain anything the buyer typed into the preview.
- Deletion requests (Sentinel R29 L3): the shared story lives in `notifications.payload_json` (`story_text`) for the
  `buyer_experience_submitted` notification, as well as in the alert email. Any deletion of a buyer must also purge or
  null that payload, not just the `buyers` row. There is no deletion tool in this repo yet; see the TODO in `worker.js`.
- Story fields without `story_consent=yes` (or with empty text) are dropped; the lead is saved as an ordinary submission.

## Follow-ups (not built)
- Emailing the buyer their own copy: the existing send_email binding only reaches HBE inboxes.
  Needs a decision on new email setup.
- A PDF attachment on the lead email (v1 puts the story in the email body).
- AI-written version: consented path only; would use the existing Workers AI binding, so it is
  infrastructure-free but adds usage cost and review of invented-fact risk. Not built in v1.
- "After the Keys" post-close story.
