# S16 — Browser, alerts and application recovery

Prepared against S15 main 27ba167ff78ff933c701a9152a4977ad0d4b5f66. This directory does not authorize deployment, restore or new credentials.

The Vite build emits an enforcing CSP meta immediately after charset on all five shipped HTML pages, hashes the static JSON-LD, rejects other inline scripts, omits unsafe-inline/unsafe-eval from script policy, and restricts code, connections, frames and workers. Referrer metadata uses strict-origin. Inline styles remain necessary for Vue/D3; style-src unsafe-inline is an explicit limitation. Google reCAPTCHA and font origins are trusted code/resources; CSP does not isolate their JavaScript from local storage. Vue I18n11 uses JIT message compilation by default. The former inline report button is a normal safe anchor; share popups request noopener/noreferrer.

GitHub Pages does not supply a custom HTTP-header setting here. Meta CSP cannot enforce frame-ancestors, sandbox or violation reporting. This change does not claim clickjacking protection or a full response-header policy; a hosting/header decision remains open. No ignored _headers file or fake meta frame-ancestors is added.

Service-worker caching is limited to exact same-origin public shell/static paths without query/auth headers; reload/no-store requests bypass it, and private/no-store responses are never added. Only old caches in this application's namespace are removed. Device secrets and participation state are not cleared. Push input is bounded text, images are local and click destinations must remain on the same origin. Widget ids are UUIDs; API counters enter textContent, not HTML.

health-check.mjs checks eleven fixed public endpoints with bounded bodies/time, no redirects and identity-free results. It does not exercise a business route, database dependency, OTP provider or stored user record. The HTML check compares the complete expected policy, hash and placement, not full browser enforcement or artifact provenance. Monitoring is point-in-time, not continuous protection, request authentication or an SLA. It does not replace two external-client IP checks.

An existing hourly ChatGPT isolation task was found PAUSED; its identifier and activation proposal remain private. Do not duplicate or claim it active. The publication proposal will include resuming that task after the web update, preserving Railway read-only scope, failure-only Spanish alerts and the ban on secrets/user logs/third-party messages. No schedule is activated during preparation. A separate hourly watchdog is proposed to inspect this monitor last completed run and alert only on missing, blocked or failed execution. Both use the same scheduling platform, so this does not cover total platform outage.

Local Node tests cover CSP hashes/fail-closed build, worker origin/query/cache controls, push navigation, widget input and bounded/redacted monitor failures. A private read-only Actions rehearsal tests the built app in Chromium with all browser network requests intercepted and synthetic services. No real Google/OTP, SMS, email, push, payment or GPS operation is performed. Local Chrome could not start because this runtime disallows its singleton socket; that failed attempt is not counted as browser validation.

See RECOVERY.md for exact application baselines and the limits of the older database restoration. Finishing this S16 implementation round does not close the outstanding S9–S15 scopes or certify the system as safe.

References checked 2026-10-29:
- https://developers.google.com/recaptcha/docs/faq
- https://vue-i18n.intlify.dev/guide/advanced/optimization
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors

Recovery of the interrupted session, 2026-10-30: see `docs/security-s16-20261030.md` for the exact Chromium rehearsal, report-route correction, pending monitor activation and the version-bound fail-closed implementation-handoff gate. The gate is containment, not evidence of a verified model filesystem sandbox. No credential-bearing implementation run is authorized by this candidate alone.

CSP protects newly loaded HTML documents; existing open tabs are not force-reloaded. Builds require an exact reviewed VITE_API_URL without a trailing slash. The publication job tests browser boundaries and verifies every shipped HTML file before uploading; agent verification builds use a fixed public API origin and synthetic CAPTCHA setting. The widget uses the custom API hostname; the legacy Railway origin remains allowed for compatibility while it is attached to the existing monitored service.
