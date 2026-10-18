# Simple multilingual interface

The current sign-in, restaurant selection, owner settings and platform controls support English, Marathi and Hindi. A language selector is visible before sign-in and remains available after sign-in. Choices use native names: English, मराठी, हिन्दी.

Translations live in apps/web/lib/i18n/messages.ts. All dictionaries have the same TypeScript-enforced keys. Use useLanguage() in client components; do not embed English-only action labels or error sentences. Keep backend authorization and state identifiers language independent. The client maps HTTP failures to translated messages without exposing database errors. Messages remain translated if the user switches language after an error occurs.

The device remembers only the selected language in localStorage. If unavailable, switching still works for the current page. On a first visit the app uses a supported browser language, otherwise English. The document lang attribute updates for screen readers. Credentials and restaurant data are not stored with the language preference. Existing authentication remains in memory; reloading requires sign-in again.

Use short labels, visible words alongside controls, at least 44px touch targets and Devanagari-capable system fonts. Keep sign-in near the top on mobile; do not put marketing content before the primary task. Platform-only account IDs are hidden unless the administrator chooses a different owner. Pausing a restaurant requires an inline confirmation explaining the effect.

Translate dates, money and quantities using Intl for the selected language and restaurant currency/timezone when those screens are implemented. formatMoney provides a starting helper for integer minor-unit amounts.

Restaurant names, addresses and owner-entered content retain their original text. This release does not automatically translate menu content. When menu management is built, support optional owner-provided names/descriptions per language with fallback to the restaurant's original content. Never translate prices, IDs, authorization decisions or stored order snapshots.

Verification covers every dictionary key, language fallback and preferences, mobile screens in all three languages, translated validation/errors and workspace changes without modifying restaurant data. Native speakers should review wording with the pilot restaurants before broad rollout.
