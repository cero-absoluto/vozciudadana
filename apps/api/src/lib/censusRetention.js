// Keep challenge rows only for the one-hour abuse-control window after expiry.
// Provider-independent: no email/OTP is sent by this maintenance operation.
export async function purgeCensusChallenges(db, now = Date.now()) {
  const cutoff = new Date(now - 60 * 60 * 1000).toISOString();
  let failed = false;
  for (const table of ['census_otp_requests', 'email_otp_requests']) {
    try { const { error } = await db.from(table).delete().lt('expires_at', cutoff); if (error) failed = true; } catch { failed = true; }
  }
  if (failed) throw new Error('CENSUS_OTP_RETENTION_FAILED');
}
export function registerCensusRetention(app, db) {
  let timer;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await purgeCensusChallenges(db); }
    catch { app.log.error({ code: 'CENSUS_OTP_RETENTION_FAILED' }, 'Census OTP cleanup failed; operator attention required'); }
    finally { running = false; }
  };
  app.addHook('onReady', async () => {
    await run();
    timer = setInterval(run, 15 * 60 * 1000);
    timer.unref?.();
  });
  app.addHook('onClose', async () => { clearInterval(timer); });
}
