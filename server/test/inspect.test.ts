import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect } from '../src/inspect.ts';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const limits = { image: 25 * 1048576, video: 500 * 1048576 };
const run = (b: Buffer, headLen = b.length, tailLen = b.length) =>
  inspect(b.subarray(0, headLen), b.subarray(Math.max(0, b.length - tailLen)), b.length, limits);

test('imagens: detecta tipo pelo conteúdo e lê resolução', () => {
  for (const [f, mime] of [['img.png', 'image/png'], ['img.jpg', 'image/jpeg'], ['img.webp', 'image/webp'], ['img-lossless.webp', 'image/webp']]) {
    const r = run(fx(f));
    assert.equal(r.ok, true, f);
    assert.equal(r.mime, mime);
    assert.equal(r.width, 640); assert.equal(r.height, 360);
    assert.equal(r.compat, 'ok');
  }
});

test('arquivo falso com extensão .jpg é recusado (critério 14 / validação)', () => {
  const r = run(fx('fake.jpg'));
  assert.equal(r.ok, false);
  assert.match(r.error!, /Formato não reconhecido/);
});

test('MP4 H.264 com índice no fim, lido só pelas pontas', () => {
  const b = fx('h264.mp4');
  const r = run(b, 1024, 4096);
  assert.equal(r.ok, true);
  assert.equal(r.codec, 'avc1');
  assert.equal(r.width, 320); assert.equal(r.height, 180);
  assert.ok(Math.abs(r.duration_ms! - 2000) < 100, String(r.duration_ms));
  assert.equal(r.compat, 'ok');
  assert.ok(r.notes.some((n) => /fast start/.test(n)));
});

test('MP4 faststart não gera dica', () => {
  const r = run(fx('h264-faststart.mp4'), 8192, 1024);
  assert.equal(r.ok, true);
  assert.ok(!r.notes.some((n) => /fast start/.test(n)));
});

test('HEVC é aceito com aviso de compatibilidade', () => {
  const r = run(fx('hevc.mp4'));
  assert.equal(r.ok, true);
  assert.equal(r.codec, 'hvc1');
  assert.equal(r.compat, 'warning');
});

test('MP4 truncado é recusado', () => {
  const b = fx('h264.mp4');
  const r = inspect(b.subarray(0, 2000), b.subarray(0, 2000), 2000, limits);
  assert.equal(r.ok, false);
});

test('limite de tamanho', () => {
  const b = fx('img.png');
  const r = inspect(b, b, 30 * 1048576, limits);
  assert.equal(r.ok, false);
  assert.match(r.error!, /limite/);
});
