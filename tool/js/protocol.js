import { TELEMETRY_LIMITS } from './config.js';

const TELEMETRY_RE = /\b(Iref|I|V|D|set)\s*=\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mV|V|mA|A|%)?/gi;
const REPLY_SET_RE = /^SET\s+(-?\d+)\s*mV\b/i;
const REPLY_ERROR_RE = /^ERR\b/i;
const REPLY_PONG_RE = /^PONG\b/i;
const MAX_RX_BUFFER = 8192;

/**
 * Buffers UART text and returns complete LF-terminated lines.  CR is stripped
 * from the end of each line so callers only deal with protocol content.
 */
export class LineDecoder {
  constructor(maxBuffer = MAX_RX_BUFFER) {
    this.maxBuffer = maxBuffer;
    this.buffer = '';
  }

  reset() {
    this.buffer = '';
  }

  push(text) {
    this.buffer += text;
    const lines = [];
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      lines.push(line);
      newlineIndex = this.buffer.indexOf('\n');
    }

    let overflow = false;
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = '';
      overflow = true;
    }
    return { lines, overflow };
  }
}

/**
 * Parse one firmware telemetry line.  Returns null for banners, acknowledgments
 * and malformed lines.  Units are normalized to V, A and percent.
 */
export function parseTelemetry(line) {
  const values = {};
  let matched = 0;
  TELEMETRY_RE.lastIndex = 0;

  let match = TELEMETRY_RE.exec(line);
  while (match) {
    const key = match[1].toLowerCase();
    const unit = (match[3] || '').toLowerCase();
    let value = Number.parseFloat(match[2]);

    if (!Number.isFinite(value)) {
      match = TELEMETRY_RE.exec(line);
      continue;
    }

    if (key === 'v' || key === 'set') {
      if (unit === 'mv') {
        value /= 1000;
      } else if (unit !== '' && unit !== 'v') {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      if (
        value < TELEMETRY_LIMITS.MIN_VOLTAGE ||
        value > TELEMETRY_LIMITS.MAX_VOLTAGE
      ) {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      values[key === 'v' ? 'v' : 'vset'] = value;
      matched += 1;
    } else if (key === 'i' || key === 'iref') {
      if (unit === 'ma') {
        value /= 1000;
      } else if (unit !== '' && unit !== 'a') {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      if (
        value < TELEMETRY_LIMITS.MIN_CURRENT ||
        value > TELEMETRY_LIMITS.MAX_CURRENT
      ) {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      values[key] = value;
      matched += 1;
    } else if (key === 'd') {
      if (unit !== '' && unit !== '%') {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      if (value < TELEMETRY_LIMITS.MIN_DUTY || value > TELEMETRY_LIMITS.MAX_DUTY) {
        match = TELEMETRY_RE.exec(line);
        continue;
      }
      values.duty = value;
      matched += 1;
    }

    match = TELEMETRY_RE.exec(line);
  }

  if (matched === 0 || (values.v === undefined && values.i === undefined)) {
    return null;
  }
  return values;
}

/**
 * Parse an acknowledgment line beginning with '#'.  A SET reply is still a
 * candidate at this stage; the application owns the accepted voltage range.
 */
export function parseReply(rawLine) {
  const body = rawLine.replace(/^#\s*/, '').trim();
  const setMatch = body.match(REPLY_SET_RE);

  if (setMatch) {
    return {
      kind: 'set',
      mv: Number(setMatch[1]),
      message: body,
    };
  }
  if (REPLY_ERROR_RE.test(body)) {
    return { kind: 'error', message: body };
  }
  if (REPLY_PONG_RE.test(body)) {
    return { kind: 'pong', message: body };
  }
  return { kind: 'info', message: body };
}

export function buildSetCommand(mv) {
  return `SET ${mv}`;
}
