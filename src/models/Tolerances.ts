/**
 * Toleranser för över- och undergödsling per näringsämne
 * 
 * OBS: Dessa typer behålls för bakåtkompatibilitet med optimize-v4.
 * Produktionsmotorn (V7) använder istället konfiguration från databas 
 * (algorithm_config-tabellen) via AlgorithmConfigV7.
 */
export interface ToleranceSettings {
  underPct: number; // -5% => -5
  overPct: number;  // +10% => 10
}

/**
 * Toleranser per näringsämne
 */
export interface Tolerances {
  N?: ToleranceSettings;
  P?: ToleranceSettings;
  K?: ToleranceSettings;
  S?: ToleranceSettings;
  default: ToleranceSettings;
}
