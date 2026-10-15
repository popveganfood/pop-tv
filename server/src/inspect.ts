// Validação do conteúdo REAL dos arquivos (bytes mágicos), sem confiar na extensão ou no MIME
// informado pelo navegador. Lê só o começo e o fim do arquivo (o MP4 guarda o índice "moov" num
// dos dois extremos), então funciona sem baixar vídeos inteiros.

export type Kind = 'image' | 'video';
export type Inspection = {
  ok: boolean; error?: string;
  kind?: Kind; mime?: string;
  width?: number; height?: number; duration_ms?: number; codec?: string;
  compat: 'ok' | 'warning' | 'incompatible'; notes: string[];
};

export const INSPECT_BYTES = 4 * 1024 * 1024; // lidos do início e do fim

export function sniff(b: Buffer): { kind: Kind; mime: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (brand.startsWith('qt')) return { kind: 'video', mime: 'video/quicktime' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  return null;
}

function imageSize(b: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png') return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
  if (mime === 'image/webp') {
    const fmt = b.toString('latin1', 12, 16);
    if (fmt === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L' && b.length >= 25) {
      const v = b.readUInt32LE(21);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X' && b.length >= 30) return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: procurar marcador SOFn
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** leitura por posição absoluta usando os pedaços do começo e do fim */
function reader(head: Buffer, tail: Buffer, total: number) {
  const tailStart = total - tail.length;
  return (off: number, len: number): Buffer | null => {
    if (off >= 0 && off + len <= head.length) return head.subarray(off, off + len);
    if (off >= tailStart && off + len <= total) return tail.subarray(off - tailStart, off - tailStart + len);
    return null;
  };
}

type Box = { type: string; start: number; body: number; end: number };
function boxes(read: (o: number, l: number) => Buffer | null, from: number, to: number): Box[] {
  const out: Box[] = [];
  let off = from;
  while (off + 8 <= to) {
    const h = read(off, 16) ?? read(off, 8);
    if (!h) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let body = off + 8;
    if (size === 1) { if (h.length < 16) break; size = Number(h.readBigUInt64BE(8)); body = off + 16; }
    else if (size === 0) size = to - off;
    if (size < 8) break;
    out.push({ type, start: off, body, end: off + size });
    off += size;
  }
  return out;
}

function mp4Info(head: Buffer, tail: Buffer, total: number) {
  const read = reader(head, tail, total);
  const top = boxes(read, 0, total);
  const moov = top.find((b) => b.type === 'moov');
  const mdat = top.find((b) => b.type === 'mdat');
  if (!moov) return null;
  const buf = read(moov.start, moov.end - moov.start);
  if (!buf) return null;
  const r = (o: number, l: number) => (o >= 0 && o + l <= buf.length ? buf.subarray(o, o + l) : null);
  const kids = (b: Box) => boxes(r, b.body, b.end);
  const root = { type: 'moov', start: 0, body: 8, end: buf.length };
  let duration_ms: number | undefined, width: number | undefined, height: number | undefined, codec: string | undefined, audio: string | undefined;
  for (const b of kids(root)) {
    if (b.type === 'mvhd') {
      const v = buf[b.body];
      const ts = v === 1 ? buf.readUInt32BE(b.body + 20) : buf.readUInt32BE(b.body + 12);
      const du = v === 1 ? Number(buf.readBigUInt64BE(b.body + 24)) : buf.readUInt32BE(b.body + 16);
      if (ts) duration_ms = Math.round((du / ts) * 1000);
    }
    if (b.type !== 'trak') continue;
    const trak = kids(b);
    const tkhd = trak.find((x) => x.type === 'tkhd');
    const mdia = trak.find((x) => x.type === 'mdia');
    if (!mdia) continue;
    const mk = kids(mdia);
    const hdlr = mk.find((x) => x.type === 'hdlr');
    const handler = hdlr ? buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) : '';
    const minf = mk.find((x) => x.type === 'minf');
    const stbl = minf && kids(minf).find((x) => x.type === 'stbl');
    const stsd = stbl && kids(stbl).find((x) => x.type === 'stsd');
    const entry = stsd ? buf.toString('latin1', stsd.body + 12, stsd.body + 16) : '';
    if (handler === 'vide' && !codec) {
      codec = entry;
      if (tkhd) { width = buf.readUInt32BE(tkhd.end - 8) >>> 16; height = buf.readUInt32BE(tkhd.end - 4) >>> 16; }
    }
    if (handler === 'soun' && !audio) audio = entry;
  }
  return { duration_ms, width, height, codec, audio, faststart: !!mdat && moov.start < mdat.start };
}

export function inspect(head: Buffer, tail: Buffer, total: number, limits: { image: number; video: number }): Inspection {
  const t = sniff(head);
  if (!t) return { ok: false, error: 'Formato não reconhecido. Envie JPG, PNG, WebP ou MP4.', compat: 'incompatible', notes: [] };
  const notes: string[] = [];
  if (t.kind === 'image') {
    if (total > limits.image) return { ok: false, error: `Imagem acima do limite de ${Math.round(limits.image / 1048576)} MB.`, compat: 'incompatible', notes };
    const s = imageSize(head, t.mime);
    if (!s || !s.width || !s.height) return { ok: false, error: 'Não foi possível ler a imagem (arquivo corrompido?).', compat: 'incompatible', notes };
    let compat: Inspection['compat'] = 'ok';
    if (Math.max(s.width, s.height) > 4096) { compat = 'warning'; notes.push('Imagem maior que 4096 px: pode pesar na memória da TV. Ideal: 1920×1080.'); }
    return { ok: true, ...t, ...s, compat, notes };
  }
  if (t.mime !== 'video/mp4') return { ok: false, error: 'Vídeo .mov não é suportado. Exporte como MP4 (H.264).', compat: 'incompatible', notes };
  if (total > limits.video) return { ok: false, error: `Vídeo acima do limite de ${Math.round(limits.video / 1048576)} MB.`, compat: 'incompatible', notes };
  const m = mp4Info(head, tail, total);
  if (!m) return { ok: false, error: 'MP4 inválido ou corrompido (índice do vídeo não encontrado).', compat: 'incompatible', notes };
  if (!m.codec) return { ok: false, error: 'O MP4 não tem faixa de vídeo.', compat: 'incompatible', notes };
  let compat: Inspection['compat'] = 'ok';
  const warn = (s: string) => { compat = 'warning'; notes.push(s); };
  if (m.codec === 'avc1' || m.codec === 'avc3') { /* H.264: compatível com todas as TVs */ }
  else if (m.codec === 'hvc1' || m.codec === 'hev1') warn('Vídeo em H.265/HEVC: muitas TVs não tocam no navegador. Converta para H.264.');
  else warn(`Codec de vídeo "${m.codec}" pode não tocar nas TVs. Converta para H.264.`);
  if (m.audio && m.audio !== 'mp4a') notes.push(`Áudio "${m.audio}" (as TVs tocam mudas por padrão).`);
  if ((m.width ?? 0) > 1920 || (m.height ?? 0) > 1920) warn('Resolução acima de Full HD: pode travar em TVs mais simples. Ideal: 1920×1080.');
  if (!m.faststart) notes.push('Dica: exporte com "fast start" (índice no início) para começar a tocar mais rápido.');
  return { ok: true, ...t, width: m.width, height: m.height, duration_ms: m.duration_ms, codec: m.codec, compat, notes };
}
