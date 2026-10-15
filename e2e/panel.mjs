// Fluxos do painel feitos pela INTERFACE (cliques reais), como a equipe do POP vai usar.
// Uso: npm run e2e:panel
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright-core';

const PORT = 3101, BASE = `http://localhost:${PORT}`, DB = 'pop_tv_e2e_ui';
const ADMIN_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/postgres';
const OUT = new URL('./out/', import.meta.url).pathname;
const FX = new URL('../server/test/fixtures/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✔ ${name}`); }
  catch (e) {
    results.push({ name, ok: false, error: e.message });
    const toasts = await page.getByRole('status').innerText().catch(() => '');
    console.log(`✘ ${name}\n   ${e.message.split('\n')[0]}\n   avisos na tela: ${toasts.replace(/\n/g, ' | ')}`);
    await page.screenshot({ path: OUT + 'falha-' + name.slice(0, 20).replace(/[^a-z0-9]/gi, '_') + '.png' }).catch(() => {});
  }
}

const a = new pg.Client({ connectionString: ADMIN_DB });
await a.connect();
await a.query(`drop database if exists ${DB} with (force)`);
await a.query(`create database ${DB}`);
await a.end();
const dbUrl = new URL(ADMIN_DB); dbUrl.pathname = '/' + DB;
const server = spawn(process.execPath, ['server/src/index.ts'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: dbUrl.toString(), STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'poptv-ui-')), POLL_SECONDS: '3', ADMIN_EMAIL: 'marketing@popveganfood.com.br', ADMIN_PASSWORD: 'senha-forte-123', ADMIN_NAME: 'Equipe Marketing' },
  stdio: 'ignore',
});
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* subindo */ } await sleep(300); }

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const tv = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));
page.on('response', async (r) => { if (r.request().method() !== 'GET' && r.status() >= 400) console.log('   [resposta]', r.status(), r.url(), (await r.text().catch(() => '')).slice(0, 300)); });
const shot = (n) => page.screenshot({ path: OUT + n + '.png' });
const toast = (text) => page.getByRole('status').getByText(text).first().waitFor({ timeout: 15000 });

await check('Login pela tela de entrada', async () => {
  await page.goto(BASE + '/');
  await shot('20-ui-login');
  await page.getByLabel('E-mail').fill('marketing@popveganfood.com.br');
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('button', { name: 'Entrar no painel' }).click();
  await page.getByText('Telas online').waitFor();
});

await check('Adicionar tela digitando o código da TV', async () => {
  await tv.goto(BASE + '/tv/');
  await tv.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.getElementById('code').textContent.trim()));
  const code = (await tv.textContent('#code')).trim();
  await page.getByRole('button', { name: '+ Adicionar tela' }).first().click();
  await page.getByLabel('Código mostrado na TV').fill(code);
  await page.getByLabel('Nome da TV').fill('TV 01 — Salão');
  await page.getByLabel('Ambiente').selectOption({ label: 'Salão' });
  await shot('21-ui-adicionar-tela');
  await page.getByRole('button', { name: 'Parear e ativar' }).click();
  await page.getByText('pareada!').waitFor();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await tv.waitForFunction(() => window.__popTv.status.state !== 'pairing', null, { timeout: 15000 });
});

await check('Enviar imagem e vídeo pela biblioteca (com miniatura do vídeo)', async () => {
  await page.getByRole('link', { name: 'Mídia' }).click();
  await page.locator('input[type=file]').first().setInputFiles([FX + 'img.png', FX + 'video3s-vp9.mp4']);
  await toast('2 arquivo(s) enviado(s).');
  await page.getByText('Video3s Vp9').or(page.getByText('video3s-vp9')).first().waitFor();
  await sleep(500);
  await shot('22-ui-midia-enviada');
});

await check('Montar playlist, definir tempo e publicar', async () => {
  await page.getByRole('link', { name: 'Playlists' }).click();
  await page.getByRole('button', { name: '+ Nova playlist' }).first().click();
  await page.getByLabel('Nome').fill('Promo de sexta');
  await page.getByRole('button', { name: 'Criar e editar' }).click();
  await page.getByText('Playlist vazia').waitFor();
  await page.getByTitle('Adicionar img').click();
  await page.getByTitle('Adicionar video3s-vp9').click();
  await page.getByRole('button', { name: '5s' }).first().click();
  await shot('23-ui-editor');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByText('Publicado!').waitFor();
  await shot('24-ui-publicado');
  await page.getByRole('button', { name: 'Continuar editando' }).click();
});

await check('Agendar a playlist na TV com verificação de conflitos', async () => {
  await page.getByRole('link', { name: 'Programação' }).click();
  await page.getByRole('button', { name: '+ Nova programação' }).first().click();
  await page.getByLabel('Nome').fill('Promo na TV do salão');
  await page.getByLabel('1. O que tocar (playlist)').selectOption({ label: 'Promo de sexta (v1)' });
  await page.getByRole('button', { name: 'Uma TV' }).click();
  await page.locator('dialog select').nth(1).selectOption({ label: 'TV 01 — Salão — Consolação' });
  await page.getByText('Sem conflitos').waitFor();
  await shot('25-ui-nova-programacao');
  await page.getByRole('button', { name: 'Agendar' }).click();
  await toast('Programação criada');
});

await check('A TV recebe e o painel mostra "TV confirmou"', async () => {
  await tv.waitForFunction(() => (window.__popTv.current() || {}).items?.length === 2, null, { timeout: 20000 });
  await page.getByRole('link', { name: 'Início' }).click();
  await page.getByText('TV confirmou').waitFor({ timeout: 30000 });
  await shot('26-ui-dashboard-confirmado');
  await tv.screenshot({ path: OUT + '27-tv-tocando.png' });
});

await check('Pré-visualizar abre o simulador rotulado como simulação', async () => {
  await page.getByRole('button', { name: 'Pré-visualizar' }).first().click();
  await page.getByText('Simulação — não é a imagem ao vivo da TV').waitFor();
  await page.getByRole('button', { name: 'Vertical 9:16' }).click();
  await sleep(600);
  await shot('28-ui-simulador');
  await page.keyboard.press('Escape');
});

await check('Gerenciar → "O que está tocando" explica a regra', async () => {
  await page.getByRole('button', { name: 'Gerenciar' }).first().click();
  await page.getByRole('button', { name: 'O que está tocando' }).click();
  await page.getByText('Regra que decide o conteúdo').waitFor();
  await page.getByText('Promo na TV do salão').first().waitFor();
  await page.getByRole('button', { name: 'Diagnóstico' }).click();
  await page.getByText('Capacidades detectadas').waitFor();
  await shot('29-ui-diagnostico');
  await page.keyboard.press('Escape');
});

await check('Criar nova unidade e ambiente pelo painel', async () => {
  await page.getByRole('link', { name: 'Unidades' }).click();
  await page.getByRole('button', { name: '+ Nova unidade' }).click();
  await page.getByLabel('Nome da unidade').fill('Unidade Pinheiros (teste)');
  await page.getByLabel('Cidade').fill('São Paulo');
  await page.getByRole('button', { name: 'Criar unidade' }).click();
  await page.getByPlaceholder('Novo ambiente (ex.: Área externa)').fill('Área externa');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await toast('Ambiente criado.');
  await shot('30-ui-nova-unidade');
});

await check('Calendário da semana', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Programação' }).click();
  await page.getByRole('button', { name: 'Calendário da semana' }).click();
  await page.getByText('Promo na TV do salão').first().waitFor();
  await shot('31-ui-calendario');
});

await check('Sem erros de JavaScript no painel', async () => { if (jsErrors.length) throw new Error(jsErrors.join('; ')); });

await browser.close();
server.kill('SIGTERM');
writeFileSync(OUT + 'panel-results.json', JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} fluxos do painel passaram.`);
process.exit(failed ? 1 : 0);
