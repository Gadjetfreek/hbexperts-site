# HBE Buyer Decision Portal

Foundation for password-encrypted, buyer-specific post-appointment decision pages.

## Security model

GitHub Pages is static. A normal JavaScript password prompt would not protect buyer information because the data would still be present in the public source.

This portal stores buyer-specific context only as AES-GCM encrypted JSON. The buyer's password is never stored in the repository. The browser derives a key from the password with PBKDF2-SHA-256 and decrypts the payload locally.

This protects the appointment context at rest on the public site. It does **not** make GitHub Pages a full authenticated client portal. Do not store highly sensitive information such as SSNs, bank data, account numbers, medical information, or identity documents here.

## Buyer page model

Each buyer gets a folder under `static/buyers/<unguessable-slug>/` containing:

- `index.html` — thin shell that loads the shared portal app
- `client.enc.json` — encrypted buyer + appointment configuration

The shared UI lives in `static/buyer-portal/`.

## Appointment configuration

The decrypted JSON supports buyer identity labels, appointment type/date, personalized welcome copy, properties or completed tasks to debrief, focus questions, and next-step prompts. The first version is optimized for post-showing debriefs but the model is generic enough for consultations, inspections, offer reviews, task completions, and other buyer touchpoints.

## Submission handling

The form currently posts through the same FormSubmit pattern already used by the HBE site. It sends the buyer's answers to HBE.

## Next security evolution

When the portal begins carrying persistent client history, documents, or sensitive transaction data, move authentication and storage behind a real server-side identity layer rather than extending the static-site model.
