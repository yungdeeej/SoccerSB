/* Shared dashboard helpers — vanilla JS, no build step. */

const MT = 'America/Edmonton';

export function fmtOdds(american) {
  if (american === null || american === undefined) return '—';
  return american > 0 ? `+${american}` : `${american}`;
}

export function fmtMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function fmtKickoffMT(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: MT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false
  }) + ' MT';
}

export function fmtMovement(cents) {
  if (Math.abs(cents) < 3) return '<span class="flat">flat</span>';
  const arrow = cents > 0 ? '↑' : '↓';
  const cls = cents > 0 ? 'up' : 'down';
  return `<span class="${cls}">${arrow} ${Math.abs(cents)}¢</span>`;
}

export function statusBadge(match) {
  if (match.status === 'live') return '<span class="live">● LIVE</span>';
  if (match.status === 'finished') return '<span class="ft">FT</span>';
  const ms = new Date(match.kickoff).getTime() - Date.now();
  if (ms <= 0) return '<span class="live">● LIVE</span>';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `<span class="soon">in ${h > 0 ? `${h}h ` : ''}${m}m</span>`;
}

export function stageLabel(stage, group) {
  const map = {
    group_md1: 'Matchday 1', group_md2: 'Matchday 2', group_md3: 'Matchday 3',
    r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarterfinal',
    sf: 'Semifinal', third: 'Third Place', final: 'FINAL'
  };
  const s = map[stage] ?? stage;
  return group ? `Group ${group} · ${s}` : s;
}

export function marketLabel(market) {
  if (market.startsWith('match_outcome_')) {
    const side = market.split('_').pop();
    return { mkt: 'ML', side };
  }
  let m = market.match(/^total_(over|under)_(.+)$/);
  if (m) return { mkt: `${m[1] === 'over' ? 'O' : 'U'} ${m[2]}`, side: m[1] };
  m = market.match(/^asian_handicap_(home|away)_(.+)$/);
  if (m) return { mkt: `AH ${m[2]}`, side: m[1] };
  return { mkt: market, side: '' };
}

export function renderFooter(el, status) {
  el.innerHTML = `
    <span>BANKROLL <b>${fmtMoney(status.bankroll_cents)}</b></span>
    <span>TODAY'S BETS <b>${status.todays_bet_count}/${status.daily_bet_cap}</b></span>
    <span>API CREDITS <b>${status.api_credits_remaining ?? '—'}${status.reduced_polling ? ' (REDUCED)' : ''}</b></span>
    <span>ODDS SYNC <b>${status.last_odds_sync ? timeAgo(status.last_odds_sync) : 'never'}</b></span>
    <span>FIXTURES <b>${status.last_fixtures_sync ? timeAgo(status.last_fixtures_sync) : 'never'}</b></span>
    <span><a href="/bets">BETS</a> · <a href="/health">HEALTH</a></span>`;
}

export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
