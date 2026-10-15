const env = process.env;

// falha fechado: qualquer coisa diferente de development/test é tratada como produção
const isProd = env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';
// r2 = Cloudflare R2 · s3 = qualquer S3 compatível (ex.: Railway Buckets) · local = disco (só dev/teste)
const storageDriver = (env.STORAGE_DRIVER || (isProd ? 'r2' : 'local')) as 'r2' | 's3' | 'local';

export const config = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/pop_tv',
  databaseSsl: env.DATABASE_SSL === 'true',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  appSecret: env.APP_SECRET || (isProd ? '' : 'dev-secret-nao-use-em-producao'),
  storageDriver,
  localStorageDir: env.LOCAL_STORAGE_DIR || './data/uploads',
  s3: storageDriver === 's3'
    ? { // Railway Buckets: URL virtual-hosted (bucket como subdomínio do endpoint)
      endpoint: (env.S3_ENDPOINT || '').replace(/\/$/, ''), region: env.S3_REGION || 'auto', bucket: env.S3_BUCKET || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '', secretAccessKey: env.S3_SECRET_ACCESS_KEY || '', virtualHosted: true }
    : { // Cloudflare R2: URL path-style
      endpoint: env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '', region: 'auto', bucket: env.R2_BUCKET || 'pop-tv-media',
      accessKeyId: env.R2_ACCESS_KEY_ID || '', secretAccessKey: env.R2_SECRET_ACCESS_KEY || '', virtualHosted: false },
  maxImageBytes: Number(env.MAX_IMAGE_MB || 25) * 1024 * 1024,
  maxVideoBytes: Number(env.MAX_VIDEO_MB || 500) * 1024 * 1024,
  admin: { email: env.ADMIN_EMAIL || '', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || 'Administrador' },
  sessionDays: 14,
  pollSeconds: Math.max(2, Number(env.POLL_SECONDS || 30)),
};

export function assertConfig() {
  const problems: string[] = [];
  if (config.isProd && config.storageDriver === 'local')
    problems.push('STORAGE_DRIVER=local é proibido em produção (o disco do Railway é temporário). Use r2.');
  // APP_SECRET só assina URLs do armazenamento local (dev/teste); com R2/S3 não é usado.
  if (config.storageDriver !== 'local' && (!config.s3.endpoint || !config.s3.bucket || !config.s3.accessKeyId || !config.s3.secretAccessKey))
    problems.push(config.storageDriver === 'r2' ? 'Faltam R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.' : 'Faltam S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.');
  if (problems.length) throw new Error('Configuração inválida:\n- ' + problems.join('\n- '));
}
