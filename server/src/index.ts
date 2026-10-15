import { randomBytes } from 'node:crypto';
import { buildApp } from './app.ts';
import { assertConfig, config } from './config.ts';
import { migrate, one, q } from './db.ts';
import { hashPassword } from './auth.ts';
import { ensureBucketCors } from './storage.ts';

assertConfig();
await migrate();

// Admin inicial (só quando ainda não existe nenhum usuário)
const count = await one<{ n: number }>('select count(*)::int as n from users');
if (count?.n === 0) {
  if (config.admin.email) {
    // sem ADMIN_PASSWORD: gera uma senha temporária e mostra UMA vez no log do deploy (troque no painel)
    const password = config.admin.password.length >= 8 ? config.admin.password : randomBytes(12).toString('base64url');
    await q(`insert into users(name, email, password_hash, role, all_units) values ($1,$2,$3,'admin',true)`,
      [config.admin.name, config.admin.email.toLowerCase(), await hashPassword(password)]);
    console.log(`[POP TV] administrador inicial criado: ${config.admin.email}`);
    if (!config.admin.password) console.log(`[POP TV] senha temporária do administrador: ${password}  (troque em Usuários → Editar)`);
  } else {
    console.warn('[POP TV] Nenhum usuário. Defina ADMIN_EMAIL e ADMIN_PASSWORD (8+ caracteres) ou rode "npm run create-admin".');
  }
}

if (config.storageDriver !== 'local') await ensureBucketCors(config.publicUrl).catch((e) => console.warn('[POP TV] CORS do bucket:', e.message));

const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[POP TV] no ar em ${config.publicUrl} (painel) e ${config.publicUrl}/tv (player) — armazenamento: ${config.storageDriver}`);

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => app.close().then(() => process.exit(0)));
