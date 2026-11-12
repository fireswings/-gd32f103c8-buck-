import { VOLTAGE } from './config.js';

const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value, digits) {
  if (value == null || !Number.isFinite(value)) {
    return '--';
  }
  return Number(value).toFixed(digits);
}

export function unitOrDash(value, digits, unit) {
  if (value == null || !Number.isFinite(value)) {
    return '—';
  }
  return `${Number(value).toFixed(digits)} ${unit}`;
}

export function formatVoltage(mv) {
  return (Number(mv) / 1000).toFixed(3);
}

export function formatTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  return clockFormatter.format(value);
}

export function formatClock(date) {
  const value = date instanceof Date ? date : new Date(date);
  const milliseconds = String(value.getMilliseconds()).padStart(3, '0');
  return `${formatTime(value)}.${milliseconds}`;
}

export function formatBaud(value) {
  return `${Number(value)} baud`;
}

export function hex4(value) {
  return Number(value).toString(16).toUpperCase().padStart(4, '0');
}

export function shorten(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function dateStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function csvValue(value) {
  return value == null || !Number.isFinite(value) ? '' : String(value);
}

export function validVoltage(value) {
  return Number.isFinite(value) && value >= VOLTAGE.MIN && value <= VOLTAGE.MAX;
}
