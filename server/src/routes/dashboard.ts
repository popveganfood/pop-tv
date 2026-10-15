import type { FastifyInstance } from 'fastify';
import { q } from '../db.ts';
import { user, seesAllUnits, isAdmin } from '../auth.ts';
import { screenStatus, screensVisibleTo } from './org.ts';
import { snapshot } from '../resolver.ts';
import { localNaive, activeAtLocal, blocks, PRIORITY_LABEL, targets } from '../schedule.ts';

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const me = user(req);
    const screens = await screenStatus(await screensVisibleTo(me));
    const units = await q('select id, name, active from units where archived_at is null order by name');
    const visibleUnits = units.filter((u) => seesAllUnits(me) || me.unit_ids.includes(u.id));
    const s = await snapshot();
    const now = new Date();

    // campanhas (prioridade ≥ 50) no ar agora em ao menos uma tela visível
    const live = s.rules.filter((r) => r.priority >= 50 && screens.some((sc) => {
      const ctx = s.screens.get(sc.id);
      return ctx && targets(r, ctx) && activeAtLocal(r, localNaive(now, ctx.timezone));
    }));

    // próximos inícios nas próximas 48 h (horário local da primeira tela atingida)
    const upcoming: { id: string; name: string; priority_label: string; starts: string; screens: number }[] = [];
    for (const r of s.rules) {
      const hit = screens.map((sc) => s.screens.get(sc.id)!).filter((ctx) => ctx && targets(r, ctx));
      if (!hit.length) continue;
      const startLocal = localNaive(now, hit[0].timezone);
      const b = blocks(r, startLocal - (startLocal % 300000), 2).find((x) => x.start > new Date(startLocal).toISOString().slice(0, 16));
      if (b) upcoming.push({ id: r.id, name: r.name, priority_label: PRIORITY_LABEL[r.priority], starts: b.start, screens: hit.length });
    }
    upcoming.sort((a, b) => a.starts.localeCompare(b.starts));

    // linha do tempo de hoje (00:00–24:00 no fuso da primeira tela visível)
    const tz = (screens.length && s.screens.get(screens[0].id)?.timezone) || 'America/Sao_Paulo';
    const nowLocal = localNaive(now, tz);
    const dayStart = nowLocal - (nowLocal % 86_400_000);
    const plNames = new Map((await q<{ id: string; name: string }>('select id, name from playlists')).map((p) => [p.id, p.name]));
    const timeline = s.rules.flatMap((r) => {
      const hit = screens.filter((sc) => { const ctx = s.screens.get(sc.id); return ctx && targets(r, ctx); });
      if (!hit.length) return [];
      const today = blocks(r, dayStart, 1, 15 * 60_000);
      return today.length ? [{ id: r.id, name: r.name, priority: r.priority, priority_label: PRIORITY_LABEL[r.priority], target_type: r.target_type,
        playlist_name: plNames.get(r.playlist_id) ?? '', screens: hit.length, blocks: today }] : [];
    }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

    const published = await q('select count(*)::int as n from playlists where published_version_id is not null and archived_at is null');
    const changes = await q(`select a.summary, a.created_at, a.action, a.entity_type, u.name as user_name from audit_logs a left join users u on u.id = a.user_id
                              where $1::boolean or a.user_id = $2 order by a.id desc limit 10`, [isAdmin(me) || seesAllUnits(me), me.id]);
    return {
      counts: {
        units: visibleUnits.length,
        screens: screens.length,
        online: screens.filter((x) => x.online).length,
        offline: screens.filter((x) => !x.online).length,
        campaigns_live: live.length,
        playlists_published: published[0].n,
      },
      offline_after_seconds: s.offlineAfter,
      units: visibleUnits,
      screens,
      live_campaigns: live.map((r) => ({ id: r.id, name: r.name, priority_label: PRIORITY_LABEL[r.priority] })),
      upcoming: upcoming.slice(0, 8),
      timeline: timeline.slice(0, 8),
      now_local: new Date(nowLocal).toISOString().slice(0, 16).replace('T', ' '),
      timezone: tz,
      changes,
    };
  });
}
