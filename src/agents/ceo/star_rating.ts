/** Star rating — deterministic edge → conviction mapping (05_AGENT_CEO.md). */

export function computeStarRating(edge_pct: number): { stars: number; display: string } {
  if (edge_pct < 2.0) return { stars: 0, display: '' };
  if (edge_pct < 2.5) return { stars: 0.5, display: '½★' };
  if (edge_pct < 3.5) return { stars: 1.0, display: '★' };
  if (edge_pct < 4.5) return { stars: 1.5, display: '★½' };
  if (edge_pct < 6.0) return { stars: 2.0, display: '★★' };
  if (edge_pct < 8.0) return { stars: 2.5, display: '★★½' };
  return { stars: 3.0, display: '★★★' };
}
