import { APP } from './config.js';
import { formatClock, shorten } from './utils.js';

const DIRECTION_BY_KIND = Object.freeze({
  tx: 'TX',
  sys: 'SYS',
  ack: 'ACK',
  error: 'ERR',
  demo: 'SIM',
  rx: 'RX',
});

/**
 * Bounded, throttled view model for the serial console.  The owner decides
 * when the panel is visible and calls flush() at a fixed UI cadence.
 */
export class RawLog {
  constructor(element, { maxEntries = APP.MAX_RAW_ENTRIES } = {}) {
    this.element = element;
    this.maxEntries = maxEntries;
    this.entries = [];
    this.dirty = false;
    this.visible = false;
  }

  add(kind, text, source = 'serial') {
    this.entries.push({
      kind,
      text: shorten(String(text), 1200),
      at: new Date(),
      source,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.dirty = true;
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) {
      this.renderNow();
    }
  }

  flush() {
    if (!this.visible || !this.dirty) {
      return;
    }
    this.renderNow();
  }

  renderNow() {
    const nearBottom =
      this.element.scrollHeight - this.element.scrollTop - this.element.clientHeight < 44;
    const fragment = document.createDocumentFragment();

    for (const entry of this.entries) {
      const line = document.createElement('div');
      line.className = `raw-line is-${entry.kind}`;

      const time = document.createElement('span');
      time.className = 'raw-time';
      time.textContent = formatClock(entry.at);

      const direction = document.createElement('span');
      direction.className = 'raw-dir';
      direction.textContent = this.direction(entry);

      const text = document.createElement('span');
      text.className = 'raw-text';
      text.textContent = entry.text;

      line.append(time, direction, text);
      fragment.appendChild(line);
    }

    this.element.replaceChildren(fragment);
    this.dirty = false;
    if (nearBottom) {
      this.element.scrollTop = this.element.scrollHeight;
    }
  }

  scrollToBottom() {
    this.element.scrollTop = this.element.scrollHeight;
  }

  clear() {
    this.entries = [];
    this.dirty = false;
    this.renderNow();
  }

  toText() {
    return this.entries
      .map((entry) => `${formatClock(entry.at)} ${this.direction(entry)} ${entry.text}`)
      .join('\n');
  }

  direction(entry) {
    const direction = DIRECTION_BY_KIND[entry.kind] || 'RX';
    if ((entry.kind === 'ack' || entry.kind === 'error') && entry.source === 'demo') {
      return 'SIM';
    }
    return direction;
  }
}
