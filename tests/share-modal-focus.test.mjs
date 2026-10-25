import test from 'node:test';
import assert from 'node:assert/strict';
import { mountShareModal } from './helpers/share-modal-harness.mjs';

test('share dialog moves focus inside when opened and Escape returns focus to opener', async () => {
  const modal = await mountShareModal();
  try {
    await modal.open();
    assert.ok(modal.dialog().contains(modal.document.activeElement));
    await modal.key('Escape');
    assert.equal(modal.ui.showShareModal, false);
    assert.equal(modal.document.activeElement, modal.opener);
  } finally { await modal.unmount(); }
});

test('share dialog wraps Tab and Shift+Tab at its focus boundaries', async () => {
  const modal = await mountShareModal();
  try {
    await modal.open();
    const buttons = modal.controls(), first = buttons[0], last = buttons.at(-1);
    last.focus();
    assert.equal((await modal.key('Tab')).defaultPrevented, true);
    assert.equal(modal.document.activeElement, first);
    first.focus();
    assert.equal((await modal.key('Tab', true)).defaultPrevented, true);
    assert.equal(modal.document.activeElement, last);
  } finally { await modal.unmount(); }
});

for (const mode of ['close', 'backdrop', 'whatsapp', 'telegram', 'copy']) {
  test(`share dialog restores focus after ${mode}`, async () => {
    const modal = await mountShareModal();
    try {
      await modal.open();
      assert.ok(modal.dialog().contains(modal.document.activeElement));
      const buttons = modal.controls();
      const target = mode === 'backdrop' ? modal.dialog().parentNode :
        buttons[mode === 'close' ? buttons.length - 1 : ['whatsapp', 'telegram', 'copy'].indexOf(mode)];
      await modal.click(target);
      assert.equal(modal.ui.showShareModal, false);
      assert.equal(modal.document.activeElement, modal.opener);
    } finally { await modal.unmount(); }
  });
}

test('share dialog does not steal focus after rapid open-close or unmount', async () => {
  const modal = await mountShareModal();
  modal.ui.showShareModal = true;
  modal.ui.showShareModal = false;
  await modal.flush();
  assert.equal(modal.document.activeElement, modal.opener);
  await modal.open();
  await modal.unmount();
  assert.equal(modal.document.activeElement, modal.opener);
  await modal.key('Escape');
  assert.equal(modal.document.activeElement, modal.opener);
});

test('share dialog safely handles an opener removed before dismissal', async () => {
  const modal = await mountShareModal();
  try {
    await modal.open();
    modal.removeOpener();
    await modal.key('Escape');
    assert.equal(modal.ui.showShareModal, false);
    assert.notEqual(modal.document.activeElement, modal.opener);
  } finally { await modal.unmount(); }
});
