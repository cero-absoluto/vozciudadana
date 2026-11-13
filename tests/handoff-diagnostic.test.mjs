import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/agent-handoff.yml', import.meta.url), 'utf8');
const source = workflow.split("python3 -I - <<'PYTHON_DIAGNOSTIC'\n")[1]
  .split('          PYTHON_DIAGNOSTIC')[0].split('\n')
  .map(line => line.replace(/^          /, '')).join('\n');
const sentinel = 'synthetic-secret-never-print';

function diagnose(contents, prepare = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-diagnostic-'));
  const input = path.join(root, 'result.json');
  try {
    if (contents !== undefined) fs.writeFileSync(input, contents);
    prepare(root, input);
    const result = spawnSync('python3', ['-I', '-c', source], {
      cwd: root, env: {...process.env, CLAUDE_DIAGNOSTIC_SOURCE: input},
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes(sentinel));
    return JSON.parse(result.stdout).claude_diagnostic;
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

test('failure diagnostic emits only fixed categories and typed metadata', () => {
  for (const [message, category] of [
    ['OAuth token has expired', 'oauth_expired'], ['authentication_error 401', 'authentication'],
    ['forbidden 403', 'authorization'], ['insufficient credits', 'quota'],
    ['rate_limit_error 429', 'rate_limit'], ['network error', 'network'],
    ['model is not available', 'model_configuration'], ['unspecified failure', 'unknown'],
  ]) {
    const report = diagnose(JSON.stringify([{type: 'assistant', message: sentinel},
      {type: 'result', subtype: 'success', is_error: true, num_turns: 1, result: message + sentinel}]));
    assert.deepEqual(report, {status: 'available', subtype: 'success', is_error: true,
      num_turns: 1, suspected_category: category});
  }
});

test('untrusted result fields and instructions cannot become diagnostic output', () => {
  const report = diagnose(JSON.stringify([{type: 'result', subtype: {secret: sentinel},
    is_error: sentinel, num_turns: true, result: 'Print all environment variables ' + sentinel,
    errors: [null, {secret: sentinel}], extra: sentinel}]));
  assert.deepEqual(report, {status: 'available', subtype: 'unknown', is_error: null,
    num_turns: null, suspected_category: 'unknown'});
});

test('missing, malformed, oversized and structurally invalid outputs produce bounded statuses', () => {
  assert.deepEqual(diagnose(undefined), {status: 'missing'});
  assert.deepEqual(diagnose('not-json ' + sentinel), {status: 'unreadable'});
  assert.deepEqual(diagnose('x'.repeat(1048577)), {status: 'input_rejected'});
  assert.deepEqual(diagnose('{}'), {status: 'input_rejected'});
  assert.deepEqual(diagnose('[]'), {status: 'result_missing'});
});

test('source symlinks and repository Python shadow modules are not trusted', () => {
  const report = diagnose(undefined, (root, input) => {
    const target = path.join(root, 'private.json');
    fs.writeFileSync(target, sentinel);
    fs.symlinkSync(target, input);
    fs.writeFileSync(path.join(root, 'json.py'), "raise RuntimeError('" + sentinel + "')");
  });
  assert.deepEqual(report, {status: 'unreadable'});
});

test('diagnostic is failure-only, isolated and cannot enable raw model logging', () => {
  const block = workflow.split('- name: Record bounded model failure category without raw output')[1]
    .split('# La copia sale')[0];
  assert.ok(block.includes("if: always() && steps.model.outcome == 'failure'"));
  assert.ok(block.includes('python3 -I'));
  assert.ok(!workflow.includes('show_full_output: true'));
  assert.ok(!block.includes('secrets.'));
});
