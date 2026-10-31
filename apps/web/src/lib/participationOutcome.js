// A local receipt is a display/replay guard, never an authentication credential.
// No phone, email, OTP, token or location is stored in these records.
export const validReceipt = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function freshOutcomeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
const key = context => 'vc_participation_outcome:v1:' + context;
export function readOutcome(storage, context) {
  try {
    const raw = storage.getItem(key(context));
    if (raw === null) return null;
    if (raw.length > 4096) return {state:'uncertain'};
    const record = JSON.parse(raw);
    if (record?.v !== 1 || record.context !== context || !['pending','uncertain','completed','rejected'].includes(record.state)) return {state:'uncertain'};
    if (record.state === 'completed' && (!validReceipt(record.receipt) || typeof record.title !== 'string')) return {state:'uncertain'};
    return record;
  } catch { return {state:'unavailable'}; }
}
export function writeOutcome(storage, context, {state, receipt, title = '', attemptId}) {
  if (!['pending','uncertain','completed','rejected'].includes(state) || (state === 'completed' && !validReceipt(receipt))) return false;
  const previous = readOutcome(storage, context);
  if (previous?.state === 'completed') return false; // A later failure cannot erase a receipt.
  if (state === 'pending' && previous && previous.state !== 'rejected') return false;
  if (state !== 'pending' && previous?.attemptId && previous.attemptId !== attemptId) return false;
  const record = {v:1, context, state, title:String(title).slice(0,500), at:Date.now()};
  if (attemptId) record.attemptId = attemptId;
  if (state === 'completed') record.receipt = receipt;
  try {
    const raw = JSON.stringify(record);
    storage.setItem(key(context), raw);
    return storage.getItem(key(context)) === raw;
  } catch { return false; }
}
// Synchronous check+write: no await can interleave two mounts in this tab.
export function beginOutcome(storage, context, title) {
  const previous = readOutcome(storage, context);
  if (previous && previous.state !== 'rejected') return {started:false, previous};
  try {
    const attemptId = freshOutcomeId();
    if (writeOutcome(storage, context, {state:'pending',title,attemptId})) return {started:true,attemptId};
  } catch { /* No request may be dispatched without a durable marker. */ }
  return {started:false, previous:readOutcome(storage,context) || {state:'unavailable'}};
}
export function uncertainOutcome(error) {
  if (['REQUEST_TIMEOUT','API_NETWORK_ERROR','INVALID_API_RESPONSE'].includes(error?.code)) return true;
  return ![400,401,402,403,404,409,410,422,429].includes(error?.status);
}
export function participationErrorKey(error) {
  if (uncertainOutcome(error)) return 'participation.uncertain';
  return ({400:'requestRejected',401:'verificationRejected',402:'noFunds',403:'requirements',404:'notAvailable',409:'alreadyRecorded',410:'closed',422:'requestRejected',429:'rateLimited'})[error.status]
    ? 'participation.' + ({400:'requestRejected',401:'verificationRejected',402:'noFunds',403:'requirements',404:'notAvailable',409:'alreadyRecorded',410:'closed',422:'requestRejected',429:'rateLimited'})[error.status]
    : 'participation.uncertain';
}
