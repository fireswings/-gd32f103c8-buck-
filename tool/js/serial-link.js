import { LineDecoder } from './protocol.js';
import { hex4 } from './utils.js';

/**
 * Owns the Web Serial transport and its lifecycle.  It knows nothing about
 * DOM, charts or application modes; decoded lines and lifecycle events are
 * delivered through callbacks.
 */
export class SerialLink {
  constructor({ onLine, onUnexpectedClose, onLog } = {}) {
    this.onLine = onLine || (() => {});
    this.onUnexpectedClose = onUnexpectedClose || (() => {});
    this.onLog = onLog || (() => {});
    this.port = null;
    this.reader = null;
    this.readLoop = null;
    this.closing = false;
    this.closePromise = null;
    this.lineDecoder = new LineDecoder();
    this.textDecoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.baudRate = null;
    this.portInfo = null;
    this.handleDisconnectEvent = this.handleDisconnectEvent.bind(this);
  }

  get isOpen() {
    return Boolean(this.port);
  }

  async open(baudRate) {
    if (this.port) {
      throw new Error('串口已经打开');
    }

    let port = null;
    try {
      port = await navigator.serial.requestPort();
      await port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 16384,
      });
      this.port = port;
      this.baudRate = baudRate;
      this.portInfo = typeof port.getInfo === 'function' ? port.getInfo() : null;
      this.lineDecoder.reset();
      this.textDecoder = new TextDecoder();
      this.closing = false;
      navigator.serial.addEventListener('disconnect', this.handleDisconnectEvent);
    } catch (error) {
      try {
        if (port) {
          await port.close();
        }
      } catch (_closeError) {
        /* A failed or cancelled open may already have closed the port. */
      }
      this.port = null;
      this.baudRate = null;
      this.portInfo = null;
      throw error;
    }

    return { portInfo: this.portInfo, baudRate };
  }

  startReading() {
    if (!this.port) {
      throw new Error('串口尚未打开');
    }
    if (this.reader) {
      return;
    }
    if (!this.port.readable) {
      throw new Error('串口不可读');
    }

    this.reader = this.port.readable.getReader();
    this.readLoop = this.readSerialLoop(this.reader);
  }

  async readSerialLoop(reader) {
    let failure = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          this.feedDecodedText(this.textDecoder.decode(value, { stream: true }));
        }
      }
    } catch (error) {
      failure = error;
      if (!this.closing) {
        this.onLog('sys', `串口读取中断：${error && error.message ? error.message : '未知错误'}`);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_error) {
        /* The lock may already be gone after cancellation or unplug. */
      }

      if (!this.closing) {
        window.setTimeout(() => {
          this.close({
            message: failure ? '串口连接中断，请检查 USB 连接。' : '串口数据流已结束。',
            isError: true,
            notify: true,
          });
        }, 0);
      }
    }
  }

  feedDecodedText(text) {
    const { lines, overflow } = this.lineDecoder.push(text);
    if (overflow) {
      this.onLog('sys', '接收缓冲区过长，已丢弃未完成的一行。');
    }
    for (const line of lines) {
      this.onLine(line);
    }
  }

  async writeLine(command) {
    if (!this.port || !this.port.writable) {
      throw new Error('串口不可写');
    }

    const writer = this.port.writable.getWriter();
    try {
      await writer.write(this.encoder.encode(`${command}\r\n`));
      this.onLog('tx', command);
    } finally {
      try {
        writer.releaseLock();
      } catch (_error) {
        /* A disconnect can invalidate the writer between write and release. */
      }
    }
  }

  close({ message = '', isError = false, notify = false } = {}) {
    if (!this.port) {
      return Promise.resolve();
    }
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = this.finishClose({ message, isError, notify }).finally(() => {
      this.closePromise = null;
    });
    return this.closePromise;
  }

  async finishClose({ message, isError, notify }) {
    this.closing = true;
    try {
      navigator.serial.removeEventListener('disconnect', this.handleDisconnectEvent);
    } catch (_error) {
      /* Not fatal during unplug cleanup. */
    }

    const reader = this.reader;
    if (reader) {
      try {
        await reader.cancel();
      } catch (_error) {
        /* The browser may already have closed the stream. */
      }
    }

    if (this.readLoop) {
      try {
        await this.readLoop;
      } catch (_error) {
        /* readSerialLoop reports its own errors. */
      }
    }

    const port = this.port;
    this.port = null;
    this.reader = null;
    this.readLoop = null;
    this.baudRate = null;
    this.portInfo = null;

    if (port) {
      try {
        await port.close();
      } catch (_error) {
        /* Unplugged devices cannot always be closed cleanly. */
      }
    }

    this.lineDecoder.reset();
    this.textDecoder = new TextDecoder();
    this.closing = false;

    if (notify) {
      try {
        this.onUnexpectedClose({ message, isError });
      } catch (error) {
        console.error('Unexpected serial close handler failed', error);
      }
    }
  }

  handleDisconnectEvent(event) {
    const disconnectedPort = event.port || event.target;
    if (!this.port || disconnectedPort !== this.port) {
      return;
    }
    this.close({
      message: '串口设备已移除。',
      isError: true,
      notify: true,
    });
  }
}

export function isPortPickerCancellation(error) {
  return Boolean(error) && (error.name === 'NotFoundError' || error.name === 'AbortError');
}

export function friendlySerialError(error) {
  const name = error && error.name ? error.name : '';
  const message = error && error.message ? error.message : String(error || '');
  if (name === 'SecurityError') {
    return '浏览器拒绝了串口访问，请确认页面来自 localhost / HTTPS。';
  }
  if (name === 'InvalidStateError') {
    return '串口已经打开，请先关闭其他串口监视器或刷新页面。';
  }
  if (name === 'NetworkError' || /failed to open|access denied|busy/i.test(message)) {
    return '串口打开失败，设备可能被其他程序占用。';
  }
  return `串口操作失败：${message || '未知错误'}`;
}

export function describePort(info) {
  if (!info || (info.usbVendorId == null && info.usbProductId == null)) {
    return '串口设备';
  }
  const vid = info.usbVendorId == null ? '----' : hex4(info.usbVendorId);
  const pid = info.usbProductId == null ? '----' : hex4(info.usbProductId);
  return `USB VID:${vid} PID:${pid}`;
}
