import { DEMO, VOLTAGE } from './config.js';

/**
 * Generates the same ASCII telemetry and acknowledgment lines as the MCU.
 * The source is deliberately transport-agnostic and never touches the DOM.
 */
export class DemoSource {
  constructor(onLine) {
    this.onLine = onLine || (() => {});
    this.active = false;
    this.timer = null;
    this.ackTimer = null;
    this.targetMv = VOLTAGE.DEFAULT * 1000;
    this.setV = 0;
    this.voltage = 0;
    this.startedAt = 0;
    this.lastTick = 0;
  }

  get running() {
    return this.active;
  }

  start(targetMv) {
    this.stop();
    this.active = true;
    this.targetMv = targetMv;
    this.setV = 0;
    this.voltage = 0;
    this.startedAt = performance.now();
    this.lastTick = this.startedAt;
    this.timer = window.setInterval(() => this.tick(), DEMO.PERIOD_MS);
  }

  stop() {
    this.active = false;
    window.clearInterval(this.timer);
    window.clearTimeout(this.ackTimer);
    this.timer = null;
    this.ackTimer = null;
  }

  /** Simulates the MCU processing a SET command after a short turnaround. */
  requestSet(mv) {
    if (!this.active) {
      return;
    }
    window.clearTimeout(this.ackTimer);
    this.ackTimer = window.setTimeout(() => {
      if (!this.active) {
        return;
      }
      this.targetMv = mv;
      this.onLine(`# SET ${mv} mV\r\n`);
    }, DEMO.ACK_DELAY_MS);
  }

  tick() {
    if (!this.active) {
      return;
    }

    const now = performance.now();
    const dt = Math.min(0.20, Math.max(0.005, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const elapsed = (now - this.startedAt) / 1000;
    const targetV = this.targetMv / 1000;

    const rampStep = 10 * dt;
    if (this.setV < targetV) {
      this.setV = Math.min(targetV, this.setV + rampStep);
    } else if (this.setV > targetV) {
      this.setV = Math.max(targetV, this.setV - rampStep);
    }

    const tracking = Math.min(1, dt * 22);
    this.voltage += (this.setV - this.voltage) * tracking;
    const ripple =
      0.0048 * Math.sin(2 * Math.PI * 2.7 * elapsed) +
      0.0016 * Math.sin(2 * Math.PI * 9.1 * elapsed + 1.2) +
      (Math.random() - 0.5) * 0.0009;
    const voltage = Math.max(0, this.voltage + ripple);

    const load = 7.4 + 1.8 * Math.sin(2 * Math.PI * 0.105 * elapsed + 0.5);
    const current = Math.max(
      0,
      voltage / load +
        0.008 * Math.sin(2 * Math.PI * 5.4 * elapsed) +
        (Math.random() - 0.5) * 0.002
    );
    const currentRef = Math.max(
      0,
      current + (this.setV - voltage) * 0.42 + 0.004 * Math.sin(2 * Math.PI * 1.4 * elapsed)
    );
    const duty = Math.min(
      45,
      Math.max(0, (voltage / 12.2) * 100 + 0.55 + 0.12 * Math.sin(2 * Math.PI * 2.7 * elapsed))
    );

    this.onLine(
      `V=${voltage.toFixed(3)}V ` +
        `I=${current.toFixed(3)}A ` +
        `Iref=${currentRef.toFixed(3)}A ` +
        `D=${duty.toFixed(1)}% ` +
        `set=${this.setV.toFixed(3)}V\r\n`
    );
  }
}
