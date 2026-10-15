// Cliente da API: JSON, mensagens de erro em português vindas do servidor.
export class ApiError extends Error {
  status: number; data: any;
  constructor(status: number, message: string, data: any) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Erro ${res.status}`, data);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** PUT do arquivo direto para o armazenamento (R2), com progresso */
export function uploadFile(url: string, file: Blob, headers: Record<string, string>, onProgress?: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Falha no envio (${x.status})`)));
    x.onerror = () => reject(new Error('Falha de rede no envio. Verifique a conexão (e o CORS do bucket R2).'));
    x.send(file);
  });
}

/** quadro do vídeo como JPEG (miniatura), gerado no navegador */
export function videoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (b: Blob | null) => { URL.revokeObjectURL(url); resolve(b); };
    v.muted = true; v.preload = 'auto'; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      const w = 480; c.width = w; c.height = Math.round((v.videoHeight / v.videoWidth) * w) || 270;
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => done(b), 'image/jpeg', 0.8);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

/** fluxo completo: pedir URL → enviar → servidor valida → miniatura (vídeo) */
export async function uploadMedia(file: File, opts: { collection_id?: string | null; replaceId?: string; onProgress?: (p: number) => void }) {
  const mime = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' } as Record<string, string>)[file.name.split('.').pop()!.toLowerCase()] || '';
  const r = opts.replaceId
    ? await post(`/api/media/${opts.replaceId}/replace`, { mime, size: file.size })
    : await post('/api/media/uploads', { name: file.name, mime, size: file.size, collection_id: opts.collection_id ?? null });
  await uploadFile(r.upload.url, file, r.upload.headers, opts.onProgress);
  const asset = await post(`/api/media/${r.id}/complete`);
  if (asset.kind === 'video') {
    const thumb = await videoThumbnail(file);
    if (thumb) {
      try {
        const t = await post(`/api/media/${asset.id}/thumbnail`, { size: thumb.size });
        await uploadFile(t.upload.url, thumb, t.upload.headers);
        await post(`/api/media/${asset.id}/thumbnail/complete`, { key: t.key });
      } catch { /* miniatura é opcional */ }
    }
  }
  return asset;
}
