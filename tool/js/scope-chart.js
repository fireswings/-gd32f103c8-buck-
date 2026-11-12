import { APP, COLORS, SERIES_KEYS } from './config.js';
import { clamp, formatClock, unitOrDash } from './utils.js';

/**
 * Canvas scope renderer.  It owns chart-specific view state, hit-testing and
 * the hover tooltip, but not telemetry ingestion or the application lifecycle.
 */
export class ScopeChart {
  constructor({ canvas, tooltip, tooltipFields, onHover }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.tooltipFields = tooltipFields;
    this.onHover = onHover || (() => {});

    this.samples = [];
    this.paused = false;
    this.frozenEnd = null;
    this.timeWindowMs = APP.DEFAULT_TIME_WINDOW_MS;
    this.series = Object.fromEntries(SERIES_KEYS.map((key) => [key, true]));

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.geometry = null;
    this.hover = null;
    this.renderQueued = false;
    this.destroyed = false;
    this.resizeObserver = null;

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleWindowResize = this.resize.bind(this);

    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', this.handleWindowResize);
    }
    this.resize();
  }

  setView(update = {}) {
    if ('samples' in update) {
      this.samples = update.samples;
    }
    if ('paused' in update) {
      this.paused = update.paused;
    }
    if ('frozenEnd' in update) {
      this.frozenEnd = update.frozenEnd;
    }
    if ('timeWindowMs' in update) {
      this.timeWindowMs = update.timeWindowMs;
    }
    if ('series' in update) {
      this.series = update.series;
    }
    this.scheduleRender();
  }

  resize() {
    if (this.destroyed) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.renderQueued || this.destroyed) {
      return;
    }
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.destroyed) {
        this.draw();
      }
    });
  }

  clearHover() {
    this.hover = null;
    this.hideTooltip();
    this.scheduleRender();
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.hidden = true;
    }
    this.onHover(null);
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || this.width < 2 || this.height < 2) {
      return;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.samples.length === 0) {
      this.geometry = null;
      this.hideTooltip();
      return;
    }

    const compact = this.width < 620;
    const plotLeft = compact ? 43 : 53;
    const padRight = compact ? 43 : 57;
    const padTop = 24;
    const padBottom = 30;
    const plotTop = padTop;
    const plotWidth = Math.max(20, this.width - plotLeft - padRight);
    const plotHeight = Math.max(20, this.height - padTop - padBottom);
    const plotBottom = plotTop + plotHeight;
    const plotRight = plotLeft + plotWidth;

    let end = this.samples[this.samples.length - 1].t;
    if (this.paused && this.frozenEnd != null) {
      end = this.frozenEnd;
    }
    const start = end - this.timeWindowMs;
    const startIndex = Math.max(0, lowerBoundTime(this.samples, start) - 1);
    const visible = [];

    for (let i = startIndex; i < this.samples.length; i++) {
      const sample = this.samples[i];
      if (sample.t > end + 0.001) {
        break;
      }
      visible.push(sample);
    }

    if (visible.length === 0) {
      this.geometry = null;
      this.hideTooltip();
      return;
    }

    const voltageValues = [];
    const currentValues = [];
    for (const sample of visible) {
      if (sample.t < start) {
        continue;
      }
      if (this.series.voltage && sample.v != null) {
        voltageValues.push(sample.v);
      }
      if (this.series.setpoint && sample.vset != null) {
        voltageValues.push(sample.vset);
      }
      if (this.series.current && sample.i != null) {
        currentValues.push(sample.i);
      }
    }

    const voltageScale = makeScale(voltageValues, {
      minSpan: 0.1,
      nonNegative: true,
      targetTicks: 5,
    });
    const currentScale = makeScale(currentValues, {
      minSpan: 0.02,
      nonNegative: true,
      targetTicks: 5,
    });
    const primaryScale = voltageScale || currentScale;

    const geometry = {
      left: plotLeft,
      right: plotRight,
      top: plotTop,
      bottom: plotBottom,
      width: plotWidth,
      height: plotHeight,
      start,
      end,
      timeWindowMs: this.timeWindowMs,
      voltageScale,
      currentScale,
    };
    this.geometry = geometry;

    drawGrid(ctx, {
      plotLeft,
      plotTop,
      plotWidth,
      plotHeight,
      plotRight,
      plotBottom,
      start,
      end,
      voltageScale,
      currentScale,
      primaryScale,
      compact,
      paused: this.paused,
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
    ctx.clip();

    if (voltageScale) {
      if (this.series.voltage) {
        drawVoltageFill(
          ctx,
          visible,
          voltageScale,
          start,
          end,
          plotLeft,
          plotWidth,
          plotTop,
          plotHeight
        );
        drawSeriesLine(ctx, visible, 'v', voltageScale, COLORS.voltage, {
          start,
          end,
          plotLeft,
          plotWidth,
          plotTop,
          plotHeight,
          width: 1.7,
        });
      }
      if (this.series.setpoint) {
        drawSeriesLine(ctx, visible, 'vset', voltageScale, COLORS.setpoint, {
          start,
          end,
          plotLeft,
          plotWidth,
          plotTop,
          plotHeight,
          width: 1.25,
          dashed: [5, 4],
          alpha: 0.92,
        });
      }
    }

    if (currentScale && this.series.current) {
      drawSeriesLine(ctx, visible, 'i', currentScale, COLORS.current, {
        start,
        end,
        plotLeft,
        plotWidth,
        plotTop,
        plotHeight,
        width: 1.55,
        alpha: 0.94,
      });
    }

    drawLatestDots(
      ctx,
      visible,
      this.series,
      voltageScale,
      currentScale,
      start,
      end,
      plotLeft,
      plotWidth,
      plotTop,
      plotHeight
    );
    ctx.restore();

    drawCursor(ctx, this.hover, visible, {
      plotLeft,
      plotTop,
      plotWidth,
      plotHeight,
      start,
      end,
      voltageScale,
      currentScale,
    });

    if (this.hover && isInsidePlot(this.hover, plotLeft, plotTop, plotWidth, plotHeight)) {
      const timeAtPointer = start + ((this.hover.x - plotLeft) / plotWidth) * (end - start);
      const nearest = nearestSample(visible, timeAtPointer);
      if (nearest) {
        this.showTooltip(nearest, this.hover.x, this.hover.y, end);
        this.onHover({
          sample: nearest,
          relativeSeconds: Math.max(0, (end - nearest.t) / 1000),
        });
      } else {
        this.hideTooltip();
      }
    } else {
      this.hideTooltip();
    }
  }

  showTooltip(sample, pointerX, pointerY, end) {
    this.tooltip.hidden = false;
    const relative = Math.max(0, (end - sample.t) / 1000);
    const fields = this.tooltipFields;

    fields.time.textContent = `${relative < 0.05 ? '现在' : `T−${relative.toFixed(2)} s`} · ${formatClock(sample.wall)}`;
    fields.v.textContent = unitOrDash(sample.v, 3, 'V');
    fields.i.textContent = unitOrDash(sample.i, 3, 'A');
    fields.setpoint.textContent = unitOrDash(sample.vset, 3, 'V');
    fields.duty.textContent = unitOrDash(sample.duty, 1, '%');

    const tooltipWidth = this.tooltip.offsetWidth;
    const tooltipHeight = this.tooltip.offsetHeight;
    let left = pointerX + 14;
    if (left + tooltipWidth > this.width - 8) {
      left = pointerX - tooltipWidth - 14;
    }
    left = clamp(left, 8, this.width - tooltipWidth - 8);
    let top = pointerY - tooltipHeight / 2;
    top = clamp(top, 8, this.height - tooltipHeight - 8);
    this.tooltip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  handlePointerMove(event) {
    if (this.samples.length === 0 || !this.geometry) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.hover = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this.scheduleRender();
  }

  handlePointerLeave() {
    this.clearHover();
  }

  destroy() {
    this.destroyed = true;
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    window.removeEventListener('resize', this.handleWindowResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}

function drawGrid(ctx, options) {
  const {
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
    plotRight,
    plotBottom,
    start,
    end,
    voltageScale,
    currentScale,
    primaryScale,
    compact,
    paused,
  } = options;

  ctx.save();
  ctx.font = '9px "Cascadia Mono", Consolas, monospace';
  ctx.lineWidth = 1;

  const verticalTicks = compact ? 4 : 6;
  for (let i = 0; i <= verticalTicks; i++) {
    const x = plotLeft + (plotWidth * i) / verticalTicks;
    const t = start + ((end - start) * i) / verticalTicks;
    ctx.strokeStyle = i === 0 || i === verticalTicks ? COLORS.gridStrong : COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();

    const seconds = Math.max(0, (end - t) / 1000);
    let label;
    if (i === verticalTicks) {
      label = paused ? '冻结' : '现在';
    } else if (seconds >= 10) {
      label = `−${seconds.toFixed(0)} s`;
    } else {
      label = `−${seconds.toFixed(1)} s`;
    }
    ctx.fillStyle = COLORS.faint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, plotBottom + 9);
  }

  if (primaryScale) {
    for (const tick of axisTicks(primaryScale)) {
      const y = scaleY(tick, primaryScale, plotTop, plotHeight);
      ctx.strokeStyle = Math.abs(tick) < primaryScale.step * 0.001 ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
    }
  }

  if (voltageScale) {
    const decimals = axisDecimals(voltageScale.step);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of axisTicks(voltageScale)) {
      const y = scaleY(tick, voltageScale, plotTop, plotHeight);
      ctx.fillText(tick.toFixed(decimals), plotLeft - 9, y);
    }
    ctx.fillStyle = COLORS.voltage;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '8.5px "Cascadia Mono", Consolas, monospace';
    ctx.fillText('V', plotLeft - 3, plotTop - 9);
  }

  if (currentScale) {
    const decimals = axisDecimals(currentScale.step);
    ctx.fillStyle = COLORS.currentAxis;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '9px "Cascadia Mono", Consolas, monospace';
    for (const tick of axisTicks(currentScale)) {
      const y = scaleY(tick, currentScale, plotTop, plotHeight);
      ctx.fillText(tick.toFixed(decimals), plotRight + 9, y);
    }
    ctx.fillStyle = COLORS.current;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '8.5px "Cascadia Mono", Consolas, monospace';
    ctx.fillText('A', plotRight + 3, plotTop - 9);
  }

  ctx.strokeStyle = COLORS.gridStrong;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotBottom);
  ctx.stroke();
  ctx.restore();
}

function drawVoltageFill(ctx, visible, scale, start, end, left, width, top, height) {
  const duration = Math.max(1, end - start);
  ctx.save();
  ctx.beginPath();
  let started = false;
  let firstX = left;
  let lastX = left;

  for (const sample of visible) {
    if (sample.v == null || !Number.isFinite(sample.v)) {
      continue;
    }
    const x = left + clamp((sample.t - start) / duration, 0, 1) * width;
    const y = scaleY(sample.v, scale, top, height);
    if (!started) {
      ctx.moveTo(x, y);
      firstX = x;
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
    lastX = x;
  }

  if (!started) {
    ctx.restore();
    return;
  }

  ctx.lineTo(lastX, top + height);
  ctx.lineTo(firstX, top + height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, top, 0, top + height);
  gradient.addColorStop(0, COLORS.voltageFillTop);
  gradient.addColorStop(0.65, COLORS.voltageFillMid);
  gradient.addColorStop(1, COLORS.voltageFillBottom);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawSeriesLine(ctx, samples, key, scale, color, options) {
  const {
    start,
    end,
    plotLeft,
    plotWidth,
    plotTop,
    plotHeight,
    width = 1.5,
    dashed = null,
    alpha = 1,
  } = options;
  const duration = Math.max(1, end - start);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dashed) {
    ctx.setLineDash(dashed);
  }
  ctx.beginPath();

  let started = false;
  for (const sample of samples) {
    const value = sample[key];
    if (value == null || !Number.isFinite(value)) {
      started = false;
      continue;
    }
    const x = plotLeft + clamp((sample.t - start) / duration, 0, 1) * plotWidth;
    const y = scaleY(value, scale, plotTop, plotHeight);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function drawLatestDots(
  ctx,
  samples,
  series,
  voltageScale,
  currentScale,
  start,
  end,
  left,
  width,
  top,
  height
) {
  const sample = samples[samples.length - 1];
  const duration = Math.max(1, end - start);
  const x = left + clamp((sample.t - start) / duration, 0, 1) * width;

  const drawDot = (value, scale, color) => {
    if (value == null || !Number.isFinite(value) || !scale) {
      return;
    }
    const y = scaleY(value, scale, top, height);
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, y, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.dotStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  };

  if (series.voltage && voltageScale) {
    drawDot(sample.v, voltageScale, COLORS.voltage);
  }
  if (series.setpoint && voltageScale) {
    drawDot(sample.vset, voltageScale, COLORS.setpoint);
  }
  if (series.current && currentScale) {
    drawDot(sample.i, currentScale, COLORS.current);
  }
}

function drawCursor(ctx, hover, samples, options) {
  if (!hover || !isInsidePlot(hover, options.plotLeft, options.plotTop, options.plotWidth, options.plotHeight)) {
    return;
  }
  const timeAtPointer =
    options.start +
    ((hover.x - options.plotLeft) / options.plotWidth) * (options.end - options.start);
  const sample = nearestSample(samples, timeAtPointer);
  if (!sample) {
    return;
  }
  const duration = Math.max(1, options.end - options.start);
  const x =
    options.plotLeft +
    clamp((sample.t - options.start) / duration, 0, 1) * options.plotWidth;

  ctx.save();
  ctx.strokeStyle = COLORS.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, options.plotTop);
  ctx.lineTo(x, options.plotTop + options.plotHeight);
  ctx.stroke();

  if (options.voltageScale) {
    drawCrosshairPoint(
      ctx,
      sample.v,
      options.voltageScale,
      x,
      options.plotTop,
      options.plotHeight,
      COLORS.voltage
    );
    drawCrosshairPoint(
      ctx,
      sample.vset,
      options.voltageScale,
      x,
      options.plotTop,
      options.plotHeight,
      COLORS.setpoint
    );
  }
  if (options.currentScale) {
    drawCrosshairPoint(
      ctx,
      sample.i,
      options.currentScale,
      x,
      options.plotTop,
      options.plotHeight,
      COLORS.current
    );
  }
  ctx.restore();
}

function drawCrosshairPoint(ctx, value, scale, x, top, height, color) {
  if (value == null || !Number.isFinite(value) || !scale) {
    return;
  }
  const y = scaleY(value, scale, top, height);
  ctx.save();
  ctx.fillStyle = COLORS.dotFill;
  ctx.beginPath();
  ctx.arc(x, y, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function makeScale(values, { minSpan = 0.1, nonNegative = true, targetTicks = 5 } = {}) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return null;
  }

  let min = Math.min(...finite);
  let max = Math.max(...finite);
  const rawSpan = max - min;
  const paddedSpan = Math.max(rawSpan * 1.24, minSpan);
  const center = (min + max) / 2;
  min = center - paddedSpan / 2;
  max = center + paddedSpan / 2;
  if (nonNegative && min < 0) {
    max -= min;
    min = 0;
  }

  const step = niceStep(max - min, targetTicks);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  return {
    min: niceMin,
    max: niceMax === niceMin ? niceMin + step : niceMax,
    step,
  };
}

function niceStep(span, targetTicks) {
  const rough = Math.max(1e-9, span) / Math.max(1, targetTicks);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const ratio = rough / power;
  let nice = 10;
  if (ratio <= 1) {
    nice = 1;
  } else if (ratio <= 2) {
    nice = 2;
  } else if (ratio <= 2.5) {
    nice = 2.5;
  } else if (ratio <= 5) {
    nice = 5;
  }
  return nice * power;
}

function axisTicks(scale) {
  const ticks = [];
  const count = Math.min(12, Math.max(2, Math.round((scale.max - scale.min) / scale.step) + 1));
  for (let i = 0; i < count; i++) {
    const value = scale.min + i * scale.step;
    ticks.push(Math.abs(value) < scale.step * 1e-9 ? 0 : value);
  }
  return ticks;
}

function scaleY(value, scale, top, height) {
  const ratio = (value - scale.min) / (scale.max - scale.min);
  return top + height - clamp(ratio, -0.12, 1.12) * height;
}

function axisDecimals(step) {
  if (!Number.isFinite(step) || step <= 0) {
    return 2;
  }
  if (step >= 1) {
    return 0;
  }
  const magnitude = -Math.floor(Math.log10(step));
  const normalized = step / 10 ** -magnitude;
  const extra = Math.abs(normalized - Math.round(normalized)) > 1e-9 ? 1 : 0;
  return Math.min(5, magnitude + extra);
}

function isInsidePlot(point, left, top, width, height) {
  return point.x >= left && point.x <= left + width && point.y >= top && point.y <= top + height;
}

function nearestSample(samples, time) {
  if (samples.length === 0) {
    return null;
  }
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].t < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const candidate = samples[low];
  const previous = low > 0 ? samples[low - 1] : null;
  if (previous && Math.abs(previous.t - time) < Math.abs(candidate.t - time)) {
    return previous;
  }
  return candidate;
}

function lowerBoundTime(samples, time) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].t < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
