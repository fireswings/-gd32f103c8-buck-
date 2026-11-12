export const APP = Object.freeze({
  MAX_SAMPLES: 20000,
  MAX_RAW_ENTRIES: 600,
  RAW_FLUSH_MS: 250,
  LINK_REFRESH_MS: 500,
  METRICS_INTERVAL_MS: 120,
  LIVE_TIMEOUT_MS: 2500,
  DEFAULT_TIME_WINDOW_MS: 10000,
});

export const VOLTAGE = Object.freeze({
  MIN: 0,
  MAX: 4.5,
  MIN_MV: 0,
  MAX_MV: 4500,
  WARN: 3.6,
  DEFAULT: 3.3,
  STEP: 0.05,
});

export const SERIAL = Object.freeze({
  DEFAULT_BAUD: 115200,
  COMMAND_TIMEOUT_MS: 1600,
});

export const DEMO = Object.freeze({
  PERIOD_MS: 20,
  ACK_DELAY_MS: 100,
});

export const SERIES_KEYS = Object.freeze(['voltage', 'current', 'setpoint']);

export const TELEMETRY_LIMITS = Object.freeze({
  MIN_VOLTAGE: -1,
  MAX_VOLTAGE: 20,
  MIN_CURRENT: -20,
  MAX_CURRENT: 20,
  MIN_DUTY: -100,
  MAX_DUTY: 100,
});

export const COLORS = Object.freeze({
  voltage: '#51e5a8',
  current: '#ffb35c',
  setpoint: '#96aaff',
  grid: 'rgba(136, 166, 193, 0.115)',
  gridStrong: 'rgba(136, 166, 193, 0.18)',
  text: '#7890a3',
  faint: '#4f687b',
  crosshair: 'rgba(213, 231, 242, 0.22)',
  currentAxis: 'rgba(255, 179, 92, 0.68)',
  voltageFillTop: 'rgba(81, 229, 168, 0.17)',
  voltageFillMid: 'rgba(81, 229, 168, 0.045)',
  voltageFillBottom: 'rgba(81, 229, 168, 0)',
  dotStroke: 'rgba(5, 15, 22, 0.95)',
  dotFill: '#08121b',
});
