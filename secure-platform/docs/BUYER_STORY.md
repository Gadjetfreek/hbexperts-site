# Your Buyer Story (v1, draft)

An optional last step at the end of the Stage 1 Buyer Experience questionnaire (`/questionnaire`
on buyer.hbexperts.com). It turns the buyer's own answers into a short, printable story they keep.

Code: `src/buyer-story.js` (copy module, phrase bank, story engine, page step). Tests:
`tests/buyer-story.test.mjs`. Wiring: `issue33-production-worker.js` (injects the step),
`portal-worker.js` / `ui-worker.js` / `worker.js` (pass the consented story through the existing
intake), `submission-alerts.js` (adds the story to the existing lead email).

## The two choices
- **Download my story** (default). Built in the browser from a fixed template plus the buyer's
  answers. No request is made, nothing is stored, no tags. It opens the browser's print dialog,
  where the buyer picks "Save as PDF" (desktop Chrome/Edge/Safari/Firefox, Android Chrome) or
  Share > Save to Files / Print (iOS Safari). Afterwards the questionnaire's sessionStorage draft
  is cleared.
- **Share it with HBE and keep my journey**. Disabled until the consent switch (OFF by default) is
  on. It opens the existing "Review & Send" dialog; on send, the normal form post to `/api/intake`
  carries three extra fields (`story_source=buyer_story`, `story_consent=yes`, `story_text`). The
  server rejects a story without consent. The existing flow then writes the buyer row, the
  `buyer_experience_submitted` notification (payload gains `source`, `story_consent`,
  `story_text`) and the `notification_deliveries` row in one D1 batch, and only then sends the
  existing alert email to the existing recipients, with the story after the lead summary.

## Why print-to-PDF instead of a PDF library
No new dependency, no CDN, no CSP change (the page CSP is unchanged), text stays selectable and
accessible, and every target browser has a built-in "Save as PDF". A vendored JS PDF library would
add ~300 KB+ to a page buyers fill on phones and would need its own review. Trade-off: the buyer
takes one extra tap in the print dialog.

## Editing copy
Everything the buyer reads lives in `STORY_COPY`: headings, intros, fixed lines, the versioned
phrase bank (one neutral phrase per multiple-choice option; `null` = deliberately left out), the
advocate rule table, and the UI labels. Bump `version` / `phraseBankVersion` when copy changes.

## Follow-ups (not built)
- Emailing the buyer their own copy: the existing send_email binding only reaches HBE inboxes.
  Needs a decision on new email setup.
- A PDF attachment on the lead email (v1 puts the story in the email body).
- AI-written version: consented path only; would use the existing Workers AI binding, so it is
  infrastructure-free but adds usage cost and review of invented-fact risk. Not built in v1.
- "After the Keys" post-close story.
- A way to reach the story without filling Part 1's required contact fields (they are not sent on
  the download path, but the step gate still asks for them).
