/** Walters timing signals — bet favorites early, dogs late. */

export type TimingSignalKind = 'fav_early' | 'dog_late' | 'draw_drift_value' | 'neutral';

export interface TimingSignal {
  signal: TimingSignalKind;
  explanation: string;
}

export function computeTimingSignal(args: {
  market: string;
  opening_consensus_american: number;
  current_consensus_american: number;
  kickoff_utc: Date;
  now?: Date;
}): TimingSignal {
  const now = args.now ?? new Date();
  const hoursToKickoff = (args.kickoff_utc.getTime() - now.getTime()) / 3_600_000;
  const movement = args.current_consensus_american - args.opening_consensus_american;

  const isDraw = args.market === 'match_outcome_draw';
  const isFavorite = args.opening_consensus_american < 0;
  const isUnderdog = args.opening_consensus_american > 0 && !isDraw;

  if (isFavorite && hoursToKickoff > 12) {
    return {
      signal: 'fav_early',
      explanation: 'Favorite — Walters principle: bet early before public piles on. Current price may be best available.'
    };
  }
  if (isUnderdog && hoursToKickoff < 6 && movement > 0) {
    return {
      signal: 'dog_late',
      explanation: 'Underdog — line has drifted favorable as kickoff approaches. Walters: bet dogs late.'
    };
  }
  if (isDraw && movement > 4) {
    return { signal: 'draw_drift_value', explanation: 'Draw price drifting longer — context-dependent value.' };
  }
  return { signal: 'neutral', explanation: 'No clear timing edge' };
}
