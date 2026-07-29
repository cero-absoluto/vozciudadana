// ── IndexNow (24 July 2026) ─────────────────────────────────────────────────
//
// Pushes changed public URLs (reports.voiceprotest.org/:id) to Bing, Yandex,
// Seznam and Naver the moment something meaningful happens, instead of
// waiting for their crawlers to notice on their own schedule. Google does
// not participate in this protocol (confirmed as of 2026 — it tested
// IndexNow in 2021-2022 and did not adopt it), so this has no effect on
// Google indexing; that remains sitemap + Search Console only.
//
// Per the auditor's explicit recommendation: this must NEVER fire per
// adhesion (a busy convocatoria could otherwise trigger hundreds of
// notifications an hour for the same URL, which the receiving engines would
// likely just deprioritise as noise). It fires on meaningful events only —
// today, that means convocatoria creation, the only such event that
// actually exists in the codebase yet. Closure/final-report publication is
// a natural second trigger, not added here because there is no real
// "closing" write action to hook into today — a convocatoria's closed
// state is derived at read time from ends_at, not a distinct event. Add
// that call here, reusing this same throttled function, once a real
// closure action exists.
//
// The philosophical framing this follows (per the auditor, and agreed):
// IndexNow does not change what Voice Protest does — no new data collected,
// no new dependency the platform couldn't function without — it only
// changes how quickly information the project already decided to make
// public reaches the outside world. Same category as the sitemap or an RSS
// feed, not the same category as embedding a third party's login or
// analytics into the core flow.

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'e8122c52eea9425398ef936e7f559047';
const THROTTLE_MS = 60 * 60 * 1000; // one notification per URL per hour, max

/**
 * Notify IndexNow that a convocatoria's public report URL has changed,
 * subject to the one-per-hour throttle (per protest, tracked in
 * protests.indexnow_last_notified_at). Never throws — a failure here must
 * never block or fail the request that triggered it; it only logs.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} protestId
 * @param {import('fastify').FastifyBaseLogger} [log]
 */
export async function notifyIndexNow(supabase, protestId, log) {
  try {
    const { data: protest } = await supabase
      .from('protests')
      .select('indexnow_last_notified_at')
      .eq('id', protestId)
      .maybeSingle();

    if (!protest) return;

    const last = protest.indexnow_last_notified_at ? new Date(protest.indexnow_last_notified_at).getTime() : 0;
    if (Date.now() - last < THROTTLE_MS) {
      return; // Already notified within the last hour for this URL — skip.
    }

    const url = `https://reports.voiceprotest.org/${protestId}`;

    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'reports.voiceprotest.org',
        key: INDEXNOW_KEY,
        keyLocation: `https://reports.voiceprotest.org/${INDEXNOW_KEY}.txt`,
        urlList: [url],
      }),
      signal: AbortSignal.timeout(5000),
    });

    // IndexNow returns 200 or 202 on success — fire-and-forget by design;
    // this confirms receipt, not that any engine has crawled or indexed it.
    await supabase.from('protests').update({ indexnow_last_notified_at: new Date().toISOString() }).eq('id', protestId);

    if (log) log.info({ protestId, status: res.status }, 'IndexNow notified');
  } catch (err) {
    // Never let a discoverability side-effect fail the actual request.
    if (log) log.warn({ err: err.message, protestId }, 'IndexNow notification failed (non-blocking)');
  }
}
