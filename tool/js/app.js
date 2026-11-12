import { APP, DEMO, SERIAL, SERIES_KEYS, VOLTAGE } from './config.js';
import {
  $,
  $$,
  clamp,
  formatBaud,
  formatNumber,
  formatTime,
  formatVoltage,
  roundTo,
  validVoltage,
} from './utils.js';
import { buildSetCommand, parseReply, parseTelemetry } from './protocol.js';
import {
  SerialLink,
  describePort,
  friendlySerialError,
  isPortPickerCancellation,
} from './serial-link.js';
import { DemoSource } from './demo-source.js';
import { ScopeChart } from './scope-chart.js';
import { RawLog } from './raw-log.js';
import { downloadCsv } from './csv.js';

export class BuckScopeApp {
  constructor() {
    this.mode = 'disconnected';
    this.serialSupported = false;
    this.secureContext = false;
    this.portInfo = null;
    this.activeBaud = SERIAL.DEFAULT_BAUD;
    this.samples = [];
    this.lastSample = null;
    this.totalSamples = 0;
    this.parseErrors = 0;
    this.lastRxAt = 0;
    this.lastRxWall = 0;
    this.paused = false;
    this.frozenEnd = null;
    this.timeWindowMs = APP.DEFAULT_TIME_WINDOW_MS;
    this.series = Object.fromEntries(SERIES_KEYS.map((key) => [key, true]));
    this.pending = null;
    this.commandSerial = 0;
    this.lastMetricsAt = 0;

    this.ui = {};
    this.serial = null;
    this.demoSource = null;
    this.chart = null;
    this.rawLog = null;
    this.intervals = [];
    this.numberFormat = new Intl.NumberFormat('zh-CN');
  }

  init() {
    this.cacheUi();
    this.loadPreferences();
    this.initSupport();
    this.initModules();
    this.bindEvents();

    this.syncVoltageUi(this.readVoltageInput());
    this.updateCommandHint();
    this.updateMetrics();
    this.updateEmptyState();
    this.refreshControls();
    this.updateLinkPanel();
    this.updateLiveBadge();
    this.syncChart();

    this.intervals.push(
      window.setInterval(() => this.updateLinkPanel(), APP.LINK_REFRESH_MS),
      window.setInterval(() => this.rawLog.flush(), APP.RAW_FLUSH_MS)
    );
  }

  cacheUi() {
    const ui = this.ui;
    ui.envBadge = $('#envBadge');
    ui.envText = $('#envText');
    ui.baudRate = $('#baudRate');
    ui.baudOptions = $$('option', ui.baudRate);
    ui.connectBtn = $('#connectBtn');
    ui.connectLabel = $('#connectLabel');
    ui.demoBtn = $('#demoBtn');
    ui.liveBadge = $('#liveBadge');
    ui.liveText = $('#liveText');
    ui.portInfo = $('#portInfo');
    ui.timeWindow = $('#timeWindow');
    ui.windowOptions = $$('option', ui.timeWindow);
    ui.pauseBtn = $('#pauseBtn');
    ui.exportBtn = $('#exportBtn');
    ui.clearBtn = $('#clearBtn');
    ui.metricV = $('#metricV');
    ui.metricI = $('#metricI');
    ui.metricP = $('#metricP');
    ui.metricD = $('#metricD');
    ui.metricVFoot = $('#metricVFoot');
    ui.metricIFoot = $('#metricIFoot');
    ui.metricDFoot = $('#metricDFoot');
    ui.chart = $('#chart');
    ui.chartEmpty = $('#chartEmpty');
    ui.emptyTitle = $('#emptyTitle');
    ui.emptyCopy = $('#emptyCopy');
    ui.emptyDemoBtn = $('#emptyDemoBtn');
    ui.chartTooltip = $('#chartTooltip');
    ui.tipTime = $('#tipTime');
    ui.tipV = $('#tipV');
    ui.tipI = $('#tipI');
    ui.tipSet = $('#tipSet');
    ui.tipD = $('#tipD');
    ui.legend = $('#legend');
    ui.hoverReadout = $('#hoverReadout');
    ui.chartRate = $('#chartRate');
    ui.loopSet = $('#loopSet');
    ui.feedbackBadge = $('#feedbackBadge');
    ui.voltageInput = $('#voltageInput');
    ui.voltageSlider = $('#voltageSlider');
    ui.voltageMinus = $('#voltageMinus');
    ui.voltagePlus = $('#voltagePlus');
    ui.presetButtons = $$('.preset-row button');
    ui.applyBtn = $('#applyBtn');
    ui.applyLabel = $('#applyLabel');
    ui.voltageHint = $('#voltageHint');
    ui.voltageWarning = $('#voltageWarning');
    ui.commandStatus = $('#commandStatus');
    ui.serialPill = $('#serialPill');
    ui.deviceDetail = $('#deviceDetail');
    ui.formatDetail = $('#formatDetail');
    ui.rateDetail = $('#rateDetail');
    ui.sampleDetail = $('#sampleDetail');
    ui.errorDetail = $('#errorDetail');
    ui.lastRxDetail = $('#lastRxDetail');
    ui.rawToggleBtn = $('#rawToggleBtn');
    ui.rawPanel = $('#rawPanel');
    ui.rawLog = $('#rawLog');
    ui.rawCopyBtn = $('#rawCopyBtn');
    ui.rawClearBtn = $('#rawClearBtn');
    ui.rawCloseBtn = $('#rawCloseBtn');
    ui.footerHint = $('#footerHint');
    ui.toastRegion = $('#toastRegion');
    ui.seriesInputs = $$('.series-toggle input', ui.legend);
  }

  loadPreferences() {
    try {
      const savedBaud = window.localStorage.getItem('buckscope.baud');
      if (savedBaud && this.ui.baudOptions.some((option) => option.value === savedBaud)) {
        this.ui.baudRate.value = savedBaud;
      }
      const savedWindow = window.localStorage.getItem('buckscope.window');
      if (savedWindow && this.ui.windowOptions.some((option) => option.value === savedWindow)) {
        this.ui.timeWindow.value = savedWindow;
        this.timeWindowMs = Number(savedWindow) * 1000;
      }
    } catch (_error) {
      /* localStorage can be unavailable when the page runs from a restricted origin. */
    }
    this.activeBaud = Number(this.ui.baudRate.value) || SERIAL.DEFAULT_BAUD;
  }

  initSupport() {
    this.secureContext = window.isSecureContext;
    this.serialSupported = Boolean(navigator.serial) && this.secureContext;
    this.ui.envBadge.classList.remove('is-ready', 'is-blocked');

    if (this.serialSupported) {
      this.ui.envBadge.classList.add('is-ready');
      this.ui.envText.textContent = 'Web Serial 就绪';
      this.ui.envBadge.title = '浏览器支持 Web Serial，可以连接 USB 串口设备';
      this.ui.footerHint.textContent = '数据不离开浏览器 · 串口由 Web Serial 读取';
      return;
    }

    this.ui.envBadge.classList.add('is-blocked');
    if (!this.secureContext) {
      this.ui.envText.textContent = '需要 localhost / HTTPS';
      this.ui.envBadge.title = 'Web Serial 只能在安全上下文中使用，请通过 localhost 或 HTTPS 打开本页';
      this.ui.footerHint.textContent = '请从 localhost 或 HTTPS 打开本页，Web Serial 才可用';
    } else {
      this.ui.envText.textContent = '浏览器不支持串口';
      this.ui.envBadge.title = '请使用 Chrome 或 Edge 的较新版本；仍可播放演示波形';
      this.ui.footerHint.textContent = '当前浏览器没有 Web Serial，请改用 Chrome / Edge；演示模式仍可使用';
    }
    this.ui.connectBtn.title = this.ui.envBadge.title;
  }

  initModules() {
    this.rawLog = new RawLog(this.ui.rawLog);
    this.serial = new SerialLink({
      onLine: (line) => this.handleIncomingLine(line, 'serial'),
      onUnexpectedClose: (info) => this.handleSerialUnexpectedClose(info),
      onLog: (kind, text) => this.rawLog.add(kind, text),
    });
    this.demoSource = new DemoSource((line) => this.handleIncomingLine(line, 'demo'));
    this.chart = new ScopeChart({
      canvas: this.ui.chart,
      tooltip: this.ui.chartTooltip,
      tooltipFields: {
        time: this.ui.tipTime,
        v: this.ui.tipV,
        i: this.ui.tipI,
        setpoint: this.ui.tipSet,
        duty: this.ui.tipD,
      },
      onHover: (hover) => this.handleChartHover(hover),
    });
  }

  bindEvents() {
    const ui = this.ui;

    ui.connectBtn.addEventListener('click', () => this.onConnectClick());
    ui.demoBtn.addEventListener('click', () => this.onDemoClick());
    ui.emptyDemoBtn.addEventListener('click', () => this.onDemoClick());

    ui.baudRate.addEventListener('change', () => {
      try {
        window.localStorage.setItem('buckscope.baud', ui.baudRate.value);
      } catch (_error) {
        /* Not fatal. */
      }
      this.activeBaud = Number(ui.baudRate.value);
      this.updateLinkPanel();
    });

    ui.timeWindow.addEventListener('change', () => {
      this.timeWindowMs = Number(ui.timeWindow.value) * 1000;
      try {
        window.localStorage.setItem('buckscope.window', ui.timeWindow.value);
      } catch (_error) {
        /* Not fatal. */
      }
      this.syncChart();
    });

    ui.pauseBtn.addEventListener('click', () => this.togglePause());
    ui.exportBtn.addEventListener('click', () => this.exportCsv());
    ui.clearBtn.addEventListener('click', () => this.clearSamples());

    ui.seriesInputs.forEach((input) => {
      input.addEventListener('change', () => {
        this.series[input.dataset.series] = input.checked;
        this.syncChart();
      });
    });

    ui.voltageInput.addEventListener('input', () => this.onVoltageInput());
    ui.voltageInput.addEventListener('blur', () => this.onVoltageBlur());
    ui.voltageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!ui.applyBtn.disabled) {
          this.applyVoltage();
        }
      }
    });
    ui.voltageSlider.addEventListener('input', () => {
      this.syncVoltageUi(Number(ui.voltageSlider.value));
    });
    ui.voltageMinus.addEventListener('click', () => this.stepVoltage(-VOLTAGE.STEP));
    ui.voltagePlus.addEventListener('click', () => this.stepVoltage(VOLTAGE.STEP));
    ui.presetButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.syncVoltageUi(Number(button.dataset.preset));
      });
    });
    ui.applyBtn.addEventListener('click', () => this.applyVoltage());

    ui.rawToggleBtn.addEventListener('click', () => this.toggleRawPanel());
    ui.rawCloseBtn.addEventListener('click', () => this.toggleRawPanel(false));
    ui.rawCopyBtn.addEventListener('click', () => this.copyRawLog());
    ui.rawClearBtn.addEventListener('click', () => this.clearRawLog());

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.chart.resize();
        this.updateLinkPanel();
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Serial lifecycle                                                        */
  /* ---------------------------------------------------------------------- */

  async onConnectClick() {
    if (this.mode === 'serial') {
      await this.disconnectSerial();
      return;
    }
    if (this.mode === 'disconnected') {
      await this.openSerial();
    }
  }

  async openSerial() {
    if (!this.serialSupported) {
      this.rawLog.add('sys', '当前环境不支持 Web Serial。');
      this.toast(
        this.secureContext
          ? '当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge。'
          : '串口功能需要 localhost 或 HTTPS 安全上下文。',
        'error',
        5500
      );
      return;
    }

    this.setMode('connecting');
    this.clearCommandStatus();

    try {
      const info = await this.serial.open(Number(this.ui.baudRate.value));
      this.portInfo = info.portInfo;
      this.activeBaud = info.baudRate;
      this.resetSamples();
      this.setMode('serial');
      this.clearCommandStatus();
      this.rawLog.add(
        'sys',
        `串口已连接 · ${formatBaud(info.baudRate)} · ${describePort(info.portInfo)}`
      );
      this.serial.startReading();
      this.toast('串口已连接，等待遥测数据…', 'info', 3200);
      this.updateLinkPanel();
    } catch (error) {
      try {
        await this.serial.close();
      } catch (_closeError) {
        /* The transport may already be closed after a failed start. */
      }
      this.portInfo = null;
      this.setMode('disconnected');
      if (!isPortPickerCancellation(error)) {
        const message = friendlySerialError(error);
        this.setCommandStatus('error', message);
        this.rawLog.add('sys', message);
        this.toast(message, 'error', 5500);
      }
    }
  }

  async disconnectSerial() {
    if (this.mode !== 'serial') {
      return;
    }
    this.setMode('disconnecting');
    this.cancelPendingCommand('串口已断开，等待中的命令未确认。', 'warn');

    try {
      await this.serial.close();
    } finally {
      this.portInfo = null;
      this.setMode('disconnected');
      this.rawLog.add('sys', '串口已断开。');
      this.toast('串口已断开。', 'info', 3200);
      this.updateLinkPanel();
    }
  }

  handleSerialUnexpectedClose({ message, isError }) {
    this.portInfo = null;
    this.cancelPendingCommand('串口连接中断，等待中的命令未确认。', 'warn');
    this.rawLog.add('sys', message);
    this.setMode('disconnected');
    this.updateLinkPanel();
    if (message) {
      this.toast(message, isError ? 'error' : 'info', isError ? 5500 : 3200);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Demo source                                                             */
  /* ---------------------------------------------------------------------- */

  onDemoClick() {
    if (this.mode === 'demo') {
      this.stopDemo();
      return;
    }
    if (this.mode === 'disconnected') {
      this.startDemo();
    }
  }

  startDemo() {
    const initialVoltage = validVoltage(this.readVoltageInput())
      ? this.readVoltageInput()
      : VOLTAGE.DEFAULT;

    this.resetSamples();
    this.clearCommandStatus();
    this.setMode('demo');
    this.rawLog.add('sys', '演示信号源已启动：数据完全在浏览器内生成。');
    this.rawLog.add('demo', 'DEMO 内置 50 Hz 遥测 · SET 命令将在页面内模拟。');
    this.demoSource.start(Math.round(initialVoltage * 1000));
    this.updateLinkPanel();
  }

  stopDemo() {
    if (this.mode !== 'demo') {
      return;
    }
    this.demoSource.stop();
    this.cancelPendingCommand('演示已停止，等待中的命令已取消。', 'warn');
    this.setMode('disconnected');
    this.rawLog.add('sys', '演示信号源已停止。');
    this.updateLinkPanel();
    this.toast('演示已停止；波形数据仍保留在图表中。', 'info', 3000);
  }

  /* ---------------------------------------------------------------------- */
  /* Incoming protocol                                                       */
  /* ---------------------------------------------------------------------- */

  handleIncomingLine(line, source = 'serial') {
    if (line == null) {
      return;
    }
    const trimmed = line.trimEnd();
    if (!trimmed) {
      return;
    }

    const isAck = trimmed.startsWith('#');
    const isErrorAck = isAck && /^#\s*ERR\b/i.test(trimmed);
    if (isAck) {
      this.rawLog.add(isErrorAck ? 'error' : 'ack', trimmed, source);
    } else if (trimmed.includes('=')) {
      this.rawLog.add(source === 'demo' ? 'demo' : 'rx', trimmed, source);
    } else {
      this.rawLog.add('rx', trimmed, source);
    }

    if (isAck) {
      this.handleAcknowledgement(trimmed, source);
      return;
    }

    const values = parseTelemetry(trimmed);
    if (!values) {
      if (trimmed.includes('=')) {
        this.parseErrors += 1;
        if (this.parseErrors <= 3) {
          const preview = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
          this.rawLog.add('sys', `无法解析的遥测行：${preview}`);
        }
      }
      return;
    }

    this.appendSample(values, source);
  }

  appendSample(values, source) {
    const now = performance.now();
    const previous = this.lastSample;
    const t = previous ? Math.max(now, previous.t + 0.01) : now;
    const sample = {
      t,
      wall: Date.now(),
      v: values.v ?? null,
      i: values.i ?? null,
      iref: values.iref ?? null,
      duty: values.duty ?? null,
      vset: values.vset ?? null,
      source,
    };

    if (this.samples.length === 0) {
      this.rawLog.add('sys', source === 'demo' ? '开始接收演示遥测。' : '检测到遥测数据，开始绘图。');
    }

    this.samples.push(sample);
    this.lastSample = sample;
    this.totalSamples += 1;
    this.lastRxAt = now;
    this.lastRxWall = sample.wall;

    if (this.samples.length > APP.MAX_SAMPLES + 500) {
      this.samples.splice(0, this.samples.length - APP.MAX_SAMPLES);
    }

    if (!this.paused) {
      const metricsDue = now - this.lastMetricsAt >= APP.METRICS_INTERVAL_MS;
      if (this.samples.length === 1 || metricsDue) {
        this.lastMetricsAt = now;
        this.updateMetrics();
      }
      if (this.samples.length === 1) {
        this.refreshControls();
        this.updateEmptyState();
        this.updateLiveBadge();
      }
      this.syncChart();
    }
  }

  handleAcknowledgement(rawLine, source) {
    const reply = parseReply(rawLine);

    if (reply.kind === 'set') {
      if (
        !Number.isFinite(reply.mv) ||
        reply.mv < VOLTAGE.MIN_MV ||
        reply.mv > VOLTAGE.MAX_MV
      ) {
        return;
      }

      const pending = this.pending;
      if (pending && pending.kind === 'set') {
        window.clearTimeout(pending.timer);
        this.pending = null;
        this.syncVoltageUi(reply.mv / 1000);
        if (reply.mv === pending.mv) {
          this.setCommandStatus(
            'success',
            `MCU 已确认目标 ${formatVoltage(reply.mv)} V，电压将按软启动斜坡变化。`
          );
        } else {
          this.setCommandStatus('warn', `MCU 实际接受的目标为 ${formatVoltage(reply.mv)} V。`);
        }
        this.refreshControls();
      } else {
        this.syncVoltageUi(reply.mv / 1000);
        this.setCommandStatus('success', `MCU 当前目标：${formatVoltage(reply.mv)} V。`);
      }
      return;
    }

    if (reply.kind === 'error') {
      if (this.pending) {
        window.clearTimeout(this.pending.timer);
        this.pending = null;
        this.refreshControls();
      }
      this.setCommandStatus('error', `MCU 拒绝命令：${reply.message}`);
      if (source !== 'demo') {
        this.toast('MCU 返回命令错误，详见电压设置面板。', 'error', 4200);
      }
      return;
    }

    if (reply.kind === 'pong') {
      this.rawLog.add('sys', 'MCU 链路心跳正常（PONG）。');
      return;
    }

    this.rawLog.add('sys', `MCU 消息：${reply.message}`);
  }

  /* ---------------------------------------------------------------------- */
  /* Voltage controls and commands                                           */
  /* ---------------------------------------------------------------------- */

  onVoltageInput() {
    if (!this.pending && !this.ui.commandStatus.hidden) {
      this.clearCommandStatus();
    }
    const value = this.readVoltageInput();
    if (Number.isFinite(value)) {
      this.ui.voltageSlider.value = String(clamp(value, VOLTAGE.MIN, VOLTAGE.MAX));
      this.updateSliderVisual();
      this.updateVoltageWarning(value);
      this.updatePresetStates(value);
    }
  }

  onVoltageBlur() {
    const value = this.readVoltageInput();
    if (!Number.isFinite(value)) {
      this.syncVoltageUi(VOLTAGE.DEFAULT);
      return;
    }
    this.syncVoltageUi(clamp(value, VOLTAGE.MIN, VOLTAGE.MAX));
  }

  stepVoltage(delta) {
    const current = this.readVoltageInput();
    const base = Number.isFinite(current) ? current : VOLTAGE.DEFAULT;
    this.syncVoltageUi(
      clamp(roundTo(base + delta, 2), VOLTAGE.MIN, VOLTAGE.MAX)
    );
  }

  readVoltageInput() {
    const raw = this.ui.voltageInput.value.trim();
    if (raw === '') {
      return Number.NaN;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  syncVoltageUi(value) {
    const safeValue = Number.isFinite(value)
      ? clamp(value, VOLTAGE.MIN, VOLTAGE.MAX)
      : VOLTAGE.DEFAULT;
    this.ui.voltageSlider.value = String(safeValue);
    this.updateSliderVisual();
    this.ui.voltageInput.value = Number(safeValue).toFixed(2);
    this.updateVoltageWarning(safeValue);
    this.updatePresetStates(safeValue);
  }

  updateSliderVisual() {
    const value = Number(this.ui.voltageSlider.value);
    const percent = ((value - VOLTAGE.MIN) / (VOLTAGE.MAX - VOLTAGE.MIN)) * 100;
    this.ui.voltageSlider.style.setProperty('--slider-pct', `${clamp(percent, 0, 100)}%`);
  }

  updateVoltageWarning(value) {
    this.ui.voltageWarning.hidden = !(Number.isFinite(value) && value > VOLTAGE.WARN);
  }

  updatePresetStates(value) {
    this.ui.presetButtons.forEach((button) => {
      button.classList.toggle('active', Math.abs(Number(button.dataset.preset) - value) < 0.0005);
    });
  }

  async applyVoltage() {
    if (this.mode !== 'serial' && this.mode !== 'demo') {
      this.setCommandStatus('warn', '请先连接串口，或进入演示模式。');
      return;
    }
    if (this.pending) {
      return;
    }

    const value = this.readVoltageInput();
    if (!Number.isFinite(value)) {
      this.setCommandStatus('error', '请输入有效的目标电压。');
      this.ui.voltageInput.focus();
      return;
    }

    const mv = Math.round(value * 1000);
    if (mv < VOLTAGE.MIN_MV || mv > VOLTAGE.MAX_MV) {
      this.setCommandStatus(
        'error',
        `目标电压超出范围：${VOLTAGE.MIN.toFixed(2)}–${VOLTAGE.MAX.toFixed(2)} V。`
      );
      this.ui.voltageInput.focus();
      return;
    }

    this.syncVoltageUi(mv / 1000);
    const command = buildSetCommand(mv);
    const token = ++this.commandSerial;
    this.pending = { kind: 'set', mv, token, timer: 0 };
    this.refreshControls();
    this.setCommandStatus('pending', `已发送 ${command}，等待 MCU 确认…`);

    try {
      if (this.mode === 'demo') {
        this.rawLog.add('tx', command);
        this.demoSource.requestSet(mv);
        this.armCommandTimeout(token);
      } else {
        await this.serial.writeLine(command);
        if (!this.pending || this.pending.token !== token) {
          return;
        }
        this.armCommandTimeout(token);
      }
    } catch (error) {
      if (this.pending && this.pending.token === token) {
        window.clearTimeout(this.pending.timer);
        this.pending = null;
        this.refreshControls();
      }
      const message = `命令发送失败：${error && error.message ? error.message : '未知错误'}`;
      this.setCommandStatus('error', message);
      this.toast(message, 'error', 4800);
    }
  }

  armCommandTimeout(token) {
    if (!this.pending || this.pending.token !== token) {
      return;
    }
    window.clearTimeout(this.pending.timer);
    this.pending.timer = window.setTimeout(() => {
      if (!this.pending || this.pending.token !== token) {
        return;
      }
      this.pending = null;
      this.refreshControls();
      this.setCommandStatus(
        'warn',
        `命令已发出，但 ${(SERIAL.COMMAND_TIMEOUT_MS / 1000).toFixed(1)} 秒内没有收到 MCU 确认。请确认固件支持 SET 命令；旧固件只能读取遥测，不能修改目标电压。`
      );
    }, SERIAL.COMMAND_TIMEOUT_MS);
  }

  cancelPendingCommand(reason, kind = 'warn') {
    if (!this.pending) {
      return;
    }
    window.clearTimeout(this.pending.timer);
    this.pending = null;
    this.refreshControls();
    this.setCommandStatus(kind, reason);
  }

  setCommandStatus(kind, message) {
    this.ui.commandStatus.hidden = false;
    this.ui.commandStatus.dataset.kind = kind;
    this.ui.commandStatus.textContent = message;
  }

  clearCommandStatus() {
    this.ui.commandStatus.hidden = true;
    this.ui.commandStatus.textContent = '';
    delete this.ui.commandStatus.dataset.kind;
  }

  /* ---------------------------------------------------------------------- */
  /* Mode and status rendering                                               */
  /* ---------------------------------------------------------------------- */

  setMode(mode) {
    this.mode = mode;
    this.refreshControls();
    this.updateLiveBadge();
    this.updateEmptyState();
    this.updateCommandHint();
    this.updateLinkPanel();
  }

  refreshControls() {
    const ui = this.ui;
    const busy = this.mode === 'connecting' || this.mode === 'disconnecting';
    const isDemo = this.mode === 'demo';
    const isSerial = this.mode === 'serial';

    ui.connectBtn.disabled =
      this.mode === 'demo' || busy || (!this.serialSupported && this.mode === 'disconnected');
    ui.connectBtn.classList.toggle('is-connected', isSerial);
    ui.connectBtn.classList.toggle('is-busy', busy);
    if (this.mode === 'connecting') {
      ui.connectLabel.textContent = '正在连接…';
    } else if (this.mode === 'disconnecting') {
      ui.connectLabel.textContent = '正在断开…';
    } else if (isSerial) {
      ui.connectLabel.textContent = '断开串口';
    } else {
      ui.connectLabel.textContent = '连接串口';
    }

    ui.baudRate.disabled = this.mode !== 'disconnected';
    ui.demoBtn.disabled = isSerial || busy;
    ui.demoBtn.classList.toggle('is-active', isDemo);
    ui.demoBtn.textContent = isDemo ? '停止演示' : '演示';

    const canApply = (isSerial || isDemo) && !this.pending;
    ui.applyBtn.disabled = !canApply;
    if (this.pending) {
      ui.applyLabel.textContent = '等待 MCU 确认…';
    } else if (isDemo) {
      ui.applyLabel.textContent = '应用输出电压 · 演示';
    } else {
      ui.applyLabel.textContent = '应用输出电压';
    }

    const hasSamples = this.samples.length > 0;
    ui.pauseBtn.disabled = !hasSamples;
    ui.pauseBtn.textContent = this.paused ? '继续' : '冻结';
    ui.pauseBtn.classList.toggle('is-active', this.paused);
    ui.pauseBtn.setAttribute('aria-pressed', String(this.paused));
    ui.exportBtn.disabled = !hasSamples;
    ui.clearBtn.disabled = !hasSamples;

    if (this.mode !== 'disconnected') {
      ui.emptyDemoBtn.hidden = true;
    } else if (!this.paused && this.samples.length === 0) {
      ui.emptyDemoBtn.hidden = false;
    }

    this.updateCommandHint();
  }

  updateCommandHint() {
    const ui = this.ui;
    if (this.mode === 'serial') {
      ui.voltageHint.textContent = `命令将以 ASCII 行发送，MCU 侧限幅 ${VOLTAGE.MIN_MV}–${VOLTAGE.MAX_MV} mV。`;
    } else if (this.mode === 'demo') {
      ui.voltageHint.textContent = '演示模式不会访问真实串口，SET 命令由页面模拟确认。';
    } else {
      ui.voltageHint.textContent = '连接串口后可下发命令。';
    }

    ui.feedbackBadge.textContent =
      this.mode === 'serial' ? '实时' : this.mode === 'demo' ? '模拟' : '离线';
    ui.feedbackBadge.classList.toggle('is-live', this.mode === 'serial');
    ui.feedbackBadge.classList.toggle('is-demo', this.mode === 'demo');
  }

  updateLiveBadge() {
    let status = 'offline';
    let text = '未连接';

    if (this.paused && this.samples.length > 0 && (this.mode === 'serial' || this.mode === 'demo')) {
      status = 'paused';
      text = this.mode === 'demo' ? '演示已冻结' : '显示已冻结';
    } else if (this.mode === 'connecting') {
      status = 'waiting';
      text = '正在连接';
    } else if (this.mode === 'disconnecting') {
      status = 'waiting';
      text = '正在断开';
    } else if (this.mode === 'serial') {
      const stale = this.lastRxAt > 0 && performance.now() - this.lastRxAt > APP.LIVE_TIMEOUT_MS;
      if (this.lastRxAt === 0 || stale) {
        status = 'waiting';
        text = '等待遥测';
      } else {
        status = 'live';
        text = '串口在线';
      }
    } else if (this.mode === 'demo') {
      status = 'demo';
      text = '演示数据';
    } else if (this.samples.length > 0) {
      text = '已停止';
    }

    this.ui.liveBadge.dataset.state = status;
    this.ui.liveText.textContent = text;
    this.ui.liveBadge.title = text;
  }

  updateEmptyState() {
    const ui = this.ui;
    if (this.samples.length > 0) {
      ui.chartEmpty.classList.add('is-hidden');
      return;
    }

    ui.chartEmpty.classList.remove('is-hidden');
    if (this.mode === 'serial') {
      ui.emptyTitle.textContent = '串口已连接，等待遥测';
      ui.emptyCopy.textContent = `请确认 MCU 波特率为 ${formatBaud(this.activeBaud)}，并正在输出 “V=… I=… set=…” 遥测。`;
      ui.emptyDemoBtn.hidden = true;
    } else if (this.mode === 'demo') {
      ui.emptyTitle.textContent = '演示缓冲中';
      ui.emptyCopy.textContent = '正在生成模拟遥测，第一个波形点即将出现。';
      ui.emptyDemoBtn.hidden = true;
    } else if (this.mode === 'connecting') {
      ui.emptyTitle.textContent = '正在打开串口';
      ui.emptyCopy.textContent = '在浏览器弹出的设备列表中选择 USB 串口设备。';
      ui.emptyDemoBtn.hidden = true;
    } else {
      ui.emptyTitle.textContent = '等待遥测数据';
      ui.emptyCopy.textContent = '连接串口，或播放一段演示波形预览这个工具。';
      ui.emptyDemoBtn.hidden = false;
    }
  }

  updateMetrics() {
    const ui = this.ui;
    const sample = this.lastSample;
    if (!sample) {
      ui.metricV.textContent = '--';
      ui.metricI.textContent = '--';
      ui.metricP.textContent = '--';
      ui.metricD.textContent = '--';
      ui.metricVFoot.textContent = '设定 -- V';
      ui.metricIFoot.textContent = 'Iref -- A';
      ui.metricDFoot.textContent = '内环输出';
      ui.loopSet.textContent = '--';
      ui.chartRate.textContent = '0.0 Hz';
      return;
    }

    ui.metricV.textContent = formatNumber(sample.v, 3);
    ui.metricI.textContent = formatNumber(sample.i, 3);
    const power = sample.v != null && sample.i != null ? sample.v * sample.i : null;
    ui.metricP.textContent = formatNumber(power, 2);
    ui.metricD.textContent = formatNumber(sample.duty, 1);
    ui.metricVFoot.textContent = `设定 ${sample.vset != null ? formatNumber(sample.vset, 3) : '--'} V`;
    ui.metricIFoot.textContent = `Iref ${sample.iref != null ? formatNumber(sample.iref, 3) : '--'} A`;
    ui.metricDFoot.textContent = sample.duty != null ? '内环输出' : '无占空比数据';
    ui.loopSet.textContent = sample.vset != null ? formatNumber(sample.vset, 3) : '--';
  }

  updateLinkPanel() {
    const ui = this.ui;
    const mode = this.mode;
    const rate = this.computeSampleRate();
    const baud = mode === 'serial' ? this.activeBaud : Number(ui.baudRate.value);

    ui.formatDetail.textContent = `${formatBaud(baud)} · 8N1`;
    ui.rateDetail.textContent = this.samples.length > 0 ? `${rate.toFixed(1)} Hz` : '—';
    ui.sampleDetail.textContent = this.numberFormat.format(this.totalSamples);
    ui.errorDetail.textContent = this.numberFormat.format(this.parseErrors);
    ui.lastRxDetail.textContent = this.formatLastRx();
    ui.chartRate.textContent = `${rate.toFixed(1)} Hz`;

    const isSerial = mode === 'serial';
    const isDemo = mode === 'demo';
    ui.serialPill.textContent = isSerial
      ? '已连接'
      : isDemo
        ? '演示中'
        : mode === 'connecting'
          ? '连接中'
          : mode === 'disconnecting'
            ? '断开中'
            : '离线';
    ui.serialPill.classList.toggle('is-live', isSerial);
    ui.serialPill.classList.toggle('is-demo', isDemo);

    if (isSerial) {
      ui.deviceDetail.textContent = describePort(this.portInfo);
      ui.portInfo.textContent = `${describePort(this.portInfo)} · ${formatBaud(this.activeBaud)} · 50 Hz telemetry`;
    } else if (isDemo) {
      ui.deviceDetail.textContent = '内置模拟信号源';
      ui.portInfo.textContent = `内置演示信号源 · ${DEMO.PERIOD_MS} ms 采样 · 不访问真实串口`;
    } else if (mode === 'connecting') {
      ui.deviceDetail.textContent = '正在选择';
      ui.portInfo.textContent = '正在请求串口访问权限…';
    } else if (mode === 'disconnecting') {
      ui.portInfo.textContent = '正在关闭串口…';
    } else {
      ui.deviceDetail.textContent = '—';
      ui.portInfo.textContent =
        this.samples.length > 0 ? '串口未连接 · 当前显示历史数据' : '等待选择串口设备';
    }

    this.updateLiveBadge();
  }

  computeSampleRate() {
    if (this.samples.length < 1) {
      return 0;
    }
    const cutoff = performance.now() - 1000;
    let low = 0;
    let high = this.samples.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.samples[mid].t < cutoff) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return Math.max(0, this.samples.length - low);
  }

  formatLastRx() {
    if (!this.lastRxAt) {
      return '—';
    }
    const age = performance.now() - this.lastRxAt;
    if (age < 1000) {
      return '刚刚';
    }
    if (age < 60000) {
      return `${(age / 1000).toFixed(1)} s 前`;
    }
    return formatTime(new Date(this.lastRxWall));
  }

  /* ---------------------------------------------------------------------- */
  /* Chart synchronization and interaction                                   */
  /* ---------------------------------------------------------------------- */

  syncChart() {
    this.chart.setView({
      samples: this.samples,
      paused: this.paused,
      frozenEnd: this.frozenEnd,
      timeWindowMs: this.timeWindowMs,
      series: this.series,
    });
  }

  handleChartHover(hover) {
    if (!hover) {
      this.ui.hoverReadout.textContent = this.paused
        ? '波形显示已冻结，数据仍在后台接收'
        : '悬停波形读数';
      return;
    }
    const relative = hover.relativeSeconds;
    const timeLabel = relative < 0.05 ? '现在' : `T−${relative.toFixed(2)} s`;
    this.ui.hoverReadout.textContent =
      `${timeLabel} · V ${formatNumber(hover.sample.v, 3)} · I ${formatNumber(hover.sample.i, 3)}`;
  }

  /* ---------------------------------------------------------------------- */
  /* Waveform actions                                                        */
  /* ---------------------------------------------------------------------- */

  togglePause() {
    if (this.samples.length === 0) {
      return;
    }
    this.paused = !this.paused;
    if (this.paused) {
      this.frozenEnd = this.lastSample ? this.lastSample.t : performance.now();
      this.chart.clearHover();
      this.ui.hoverReadout.textContent = '波形显示已冻结，数据仍在后台接收';
    } else {
      this.frozenEnd = null;
      this.chart.clearHover();
      this.updateMetrics();
      this.updateLinkPanel();
    }
    this.refreshControls();
    this.updateLiveBadge();
    this.syncChart();
  }

  resetSamples() {
    this.samples = [];
    this.lastSample = null;
    this.totalSamples = 0;
    this.parseErrors = 0;
    this.lastRxAt = 0;
    this.lastRxWall = 0;
    this.paused = false;
    this.frozenEnd = null;
    this.lastMetricsAt = 0;
    if (this.chart) {
      this.chart.clearHover();
    }
    this.updateMetrics();
    this.refreshControls();
    this.updateEmptyState();
    this.updateLinkPanel();
    this.updateLiveBadge();
    this.syncChart();
  }

  clearSamples() {
    this.resetSamples();
    this.rawLog.add('sys', '波形数据与样本计数已清空。');
    this.toast('波形已清空。', 'info', 2200);
  }

  exportCsv() {
    if (this.samples.length === 0) {
      return;
    }
    downloadCsv(this.samples);
    this.toast(`已导出 ${this.numberFormat.format(this.samples.length)} 个样本。`, 'info', 2600);
    this.rawLog.add('sys', `导出 CSV：${this.numberFormat.format(this.samples.length)} 个样本。`);
  }

  /* ---------------------------------------------------------------------- */
  /* Raw serial log                                                          */
  /* ---------------------------------------------------------------------- */

  toggleRawPanel(force) {
    const show = force !== undefined ? force : !this.rawLog.visible;
    this.ui.rawPanel.hidden = !show;
    this.ui.rawToggleBtn.setAttribute('aria-expanded', String(show));
    this.ui.rawToggleBtn.classList.toggle('is-open', show);
    this.rawLog.setVisible(show);

    if (show) {
      this.rawLog.scrollToBottom();
      this.ui.rawToggleBtn.textContent = '收起日志';
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.ui.rawPanel.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    } else {
      this.ui.rawToggleBtn.textContent = '原始日志';
    }
  }

  async copyRawLog() {
    if (this.rawLog.entries.length === 0) {
      this.toast('日志为空。', 'warn', 2200);
      return;
    }
    const text = this.rawLog.toText();

    try {
      await navigator.clipboard.writeText(text);
      this.toast('原始日志已复制到剪贴板。', 'info', 2400);
    } catch (_error) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        this.toast('原始日志已复制到剪贴板。', 'info', 2400);
      } catch (_copyError) {
        this.toast('复制失败，请在日志区域手动选择文本。', 'error', 3600);
      } finally {
        textarea.remove();
      }
    }
  }

  clearRawLog() {
    this.rawLog.clear();
    this.rawLog.add('sys', '原始日志已清空。');
    this.rawLog.flush();
  }

  /* ---------------------------------------------------------------------- */
  /* Toast                                                                   */
  /* ---------------------------------------------------------------------- */

  toast(message, kind = 'info', timeout = 3600) {
    if (!message) {
      return;
    }
    while (this.ui.toastRegion.children.length >= 3) {
      this.ui.toastRegion.firstElementChild.remove();
    }
    const item = document.createElement('div');
    item.className = `toast${kind === 'error' ? ' is-error' : kind === 'warn' ? ' is-warn' : ''}`;
    item.textContent = message;
    this.ui.toastRegion.appendChild(item);
    window.setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(4px)';
      window.setTimeout(() => item.remove(), 180);
    }, timeout);
  }
}
