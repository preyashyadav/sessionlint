import type { ForecastBand } from "./types";

export function renderForecastBand(band: ForecastBand): string {
  return `~${band.lowMinutes}-${band.highMinutes}min`;
}

export function renderGauge(usedPercentage: number, band: ForecastBand | null): string {
  const pct = `${Math.round(usedPercentage)}%`;
  if (band === null) {
    return `sessionlint: ${pct} used, 5h window · steady (no wall projected)`;
  }
  return `sessionlint: ${pct} used, 5h window · wall in ${renderForecastBand(band)}`;
}
