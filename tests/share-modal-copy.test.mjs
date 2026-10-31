import test from 'node:test';
import assert from 'node:assert/strict';
import { mountShareModal } from './helpers/share-modal-harness.mjs';

const deferred = () => {
  const d = {};
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
};
const copyButton = modal => modal.controls()[2];
const hasText = (modal, text) => modal.document.body.descendants().some(n => n.text === text);
const manualText = modal => modal.document.body.descendants().find(n => n.tagName === 'TEXTAREA');

test('copy announces, closes and counts only after writeText resolves', async () => {
  const modal = await mountShareModal();
  try {
    const d = deferred();
    modal.navigator.clipboard.writeText = () => d.promise;
    await modal.open();
    await modal.click(copyButton(modal));
    assert.equal(modal.ui.showShareModal, true);
    assert.deepEqual(modal.toasts, []);
    assert.deepEqual(modal.increments, []);
    d.resolve();
    await modal.flush();
    assert.equal(modal.ui.showShareModal, false);
    assert.deepEqual(modal.toasts, ['share.toastCopy']);
    assert.deepEqual(modal.increments, ['7']);
  } finally { await modal.unmount(); }
});

test('copy rejection keeps modal open with manual text and share.copyError', async () => {
  const modal = await mountShareModal();
  try {
    modal.navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    await modal.open();
    await modal.click(copyButton(modal));
    assert.equal(modal.ui.showShareModal, true);
    assert.deepEqual(modal.toasts, []);
    assert.deepEqual(modal.increments, []);
    assert.ok(hasText(modal, 'share.copyError'));
    assert.equal(manualText(modal).props.value, 'Event Synthetic share event: https://www.voiceprotest.org/#/detail/7');
  } finally { await modal.unmount(); }
});

test('missing clipboard API keeps modal open with manual fallback', async () => {
  const modal = await mountShareModal();
  try {
    delete modal.navigator.clipboard;
    await modal.open();
    await modal.click(copyButton(modal));
    assert.equal(modal.ui.showShareModal, true);
    assert.deepEqual(modal.toasts, []);
    assert.deepEqual(modal.increments, []);
    assert.ok(hasText(modal, 'share.copyError'));
    assert.ok(manualText(modal));
  } finally { await modal.unmount(); }
});

test('double click while pending issues a single write and a single count', async () => {
  const modal = await mountShareModal();
  try {
    const d = deferred();
    let writes = 0;
    modal.navigator.clipboard.writeText = () => { writes++; return d.promise; };
    await modal.open();
    const button = copyButton(modal);
    await modal.click(button);
    await modal.click(button);
    assert.equal(writes, 1);
    d.resolve();
    await modal.flush();
    assert.deepEqual(modal.increments, ['7']);
    assert.deepEqual(modal.toasts, ['share.toastCopy']);
  } finally { await modal.unmount(); }
});

test('late success after close and reopen does not close, announce or count', async () => {
  const modal = await mountShareModal();
  try {
    const d = deferred();
    modal.navigator.clipboard.writeText = () => d.promise;
    await modal.open();
    await modal.click(copyButton(modal));
    await modal.key('Escape');
    await modal.open({id:'8',title:'New share event'});
    d.resolve();
    await modal.flush();
    assert.equal(modal.ui.showShareModal, true);
    assert.deepEqual(modal.toasts, []);
    assert.deepEqual(modal.increments, []);
  } finally { await modal.unmount(); }
});

test('late success or failure after unmount has no effect', async () => {
  const modal = await mountShareModal();
  const d = deferred();
  modal.navigator.clipboard.writeText = () => d.promise;
  await modal.open();
  await modal.click(copyButton(modal));
  await modal.unmount();
  d.resolve();
  await modal.flush();
  assert.deepEqual(modal.toasts, []);
  assert.deepEqual(modal.increments, []);
});


const UUID='12345678-1234-4234-8234-123456789abc';
const URL_FOR_UUID='https://www.voiceprotest.org/#/detail/'+UUID;
for(const channel of ['whatsapp','telegram'])test(channel+' uses the explicit UUID and title despite unrelated route, session and list changes',async()=>{
  const modal=await mountShareModal();
  try {
    await modal.open({id:UUID,title:'Original selected title'});
    modal.route.params.id='wrong-route';modal.route.params.protestId='wrong-institution';
    modal.session.set('vc_last_joined','wrong-session');modal.store.protests=[{id:UUID,title:'Changed list title'}];
    // Neither mutable global data nor even replacement of the source context changes this opening.
    modal.ui.shareContext={id:'wrong-global',title:'Wrong global title'};
    await modal.flush();await modal.click(modal.controls()[channel==='whatsapp'?0:1]);
    assert.equal(modal.windows.length,1);const opened=new URL(modal.windows[0][0]);
    assert.match(opened.searchParams.get('text'),/Original selected title/);
    assert.ok(opened.searchParams.get('text').includes(URL_FOR_UUID));
    if(channel==='telegram')assert.equal(opened.searchParams.get('url'),URL_FOR_UUID);
    assert.deepEqual(modal.increments,[UUID]);assert.equal(modal.ui.showShareModal,false);
    assert.deepEqual(modal.toasts,[channel==='whatsapp'?'share.toastWA':'share.toastTG']);
  }finally{await modal.unmount();}
});

test('clipboard gets the exact opening snapshot while a session and store change during its promise',async()=>{
  const modal=await mountShareModal();
  try {
    const d=deferred();let written;modal.navigator.clipboard.writeText=text=>{written=text;return d.promise;};
    await modal.open({id:UUID,title:'Original copy title'});await modal.click(copyButton(modal));
    modal.route.params.id='another';modal.session.set('vc_last_joined','another');modal.store.protests=[{id:UUID,title:'Mutated store title'}];
    assert.equal(written,'Event Original copy title: '+URL_FOR_UUID);d.resolve();await modal.flush();
    assert.deepEqual(modal.increments,[UUID]);assert.deepEqual(modal.toasts,['share.toastCopy']);
  }finally{await modal.unmount();}
});

for(const sameId of [true,false])for(const rejection of [false,true])test('batched close/reopen '+(sameId?'same':'different')+' ID ignores a late '+(rejection?'rejection':'resolution'),async()=>{
  const modal=await mountShareModal();
  try {
    const d=deferred();modal.navigator.clipboard.writeText=()=>d.promise;
    await modal.open({id:UUID,title:'First opening'});await modal.click(copyButton(modal));
    const nextId=sameId?UUID:'other-event';
    modal.ui.showShareModal=false;
    modal.openSync({id:nextId,title:'Second opening'});
    // Deliberately no nextTick between false and true; only opening identity separates them.
    await modal.flush();
    if(rejection)d.reject(new Error('clipboard refused'));else d.resolve();
    await modal.flush();
    assert.equal(modal.ui.showShareModal,true);assert.deepEqual(modal.increments,[]);assert.deepEqual(modal.toasts,[]);
    assert.equal(manualText(modal),undefined);assert.equal(copyButton(modal).disabled,false);
    let currentText;modal.navigator.clipboard.writeText=async text=>{currentText=text;};await modal.click(copyButton(modal));
    assert.equal(currentText,'Event Second opening: https://www.voiceprotest.org/#/detail/'+nextId);
    assert.deepEqual(modal.increments,[nextId]);assert.deepEqual(modal.toasts,['share.toastCopy']);
  }finally{await modal.unmount();}
});

for(const context of [null,{}, {id:'',title:'Missing destination'},{id:'../wrong',title:'Unsafe path'},{id:UUID,title:''}])test('modal refuses a missing/invalid explicit context without a session fallback '+JSON.stringify(context),async()=>{
  const modal=await mountShareModal();
  try {
    modal.route.params.id='valid-but-unrequested';modal.session.set('vc_last_joined','unrelated-event');
    await modal.open(context);assert.equal(modal.ui.showShareModal,false);
    assert.deepEqual(modal.toasts,[]);assert.deepEqual(modal.increments,[]);assert.equal(modal.windows.length,0);
    assert.equal(modal.document.activeElement,modal.opener);
  }finally{await modal.unmount();}
});

test('pending clipboard prevents competing WhatsApp and Telegram actions',async()=>{
  const modal=await mountShareModal();
  try {
    const d=deferred();modal.navigator.clipboard.writeText=()=>d.promise;await modal.open();await modal.click(copyButton(modal));
    await modal.click(modal.controls()[0]);await modal.click(modal.controls()[1]);
    assert.equal(modal.windows.length,0);assert.deepEqual(modal.increments,[]);assert.deepEqual(modal.toasts,[]);
    d.resolve();await modal.flush();assert.deepEqual(modal.increments,['7']);
  }finally{await modal.unmount();}
});

test('manual fallback is a labelled read-only focusable textarea in the modal Tab order',async()=>{
  const modal=await mountShareModal();
  try {
    delete modal.navigator.clipboard;await modal.open({id:UUID,title:'Manual selected title'});
    await modal.click(copyButton(modal));const field=manualText(modal);
    assert.ok(field);assert.equal(field.props['aria-label'],'share.messageLabel');assert.ok(field.hasAttribute('readonly'));
    assert.equal(field.props.value,'Event Manual selected title: '+URL_FOR_UUID);
    copyButton(modal).focus();const next=await modal.key('Tab');assert.equal(next.defaultPrevented,false);
    assert.equal(modal.document.activeElement,field);assert.equal(field.selected,true);
    await modal.key('Tab');assert.equal(modal.document.activeElement,modal.controls().at(-1));
    await modal.key('Tab');assert.equal(modal.document.activeElement,modal.controls()[0]);
    await modal.key('Escape');assert.equal(modal.document.activeElement,modal.opener);
  }finally{await modal.unmount();}
});
