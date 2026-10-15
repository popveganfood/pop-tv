// Uso: npm run create-admin -- email@pop.com.br "Nome"   (a senha é pedida no terminal)
import { createInterface } from 'node:readline/promises';
import { migrate, pool, q } from './db.ts';
import { hashPassword } from './auth.ts';

const [email, name = 'Administrador'] = process.argv.slice(2);
if (!email) { console.error('Informe o e-mail: npm run create-admin -- email@exemplo.com "Nome"'); process.exit(1); }
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Senha (8+ caracteres): ');
rl.close();
if (password.length < 8) { console.error('Senha curta demais.'); process.exit(1); }
await migrate();
await q(`insert into users(name, email, password_hash, role, all_units) values ($1,$2,$3,'admin',true)
         on conflict ((lower(email))) do update set password_hash = excluded.password_hash, role = 'admin', active = true`,
[name, email.toLowerCase(), await hashPassword(password)]);
console.log('Administrador pronto:', email);
await pool.end();
