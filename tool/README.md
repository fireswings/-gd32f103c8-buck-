# BuckScope Web 串口工具

零依赖的 Web Serial 波形与输出电压控制页面，配合本仓库的 GD32F103 Buck 固件使用。

## 启动

网页使用 ES Modules，**必须通过 HTTP 服务打开**。在仓库根目录运行：

```powershell
python -m http.server 8000 -d tool
```

然后用 Chrome 或 Edge 打开：

```text
http://localhost:8000/
```

直接双击 `index.html`（`file://`）会因浏览器模块安全策略无法启动，页面会显示启动提示，不会白屏。

浏览器最低要求：支持 Web Serial（Chromium 89+）。没有开发板时可以点击「演示」查看完整交互；演示数据完全在浏览器内生成，不会访问串口。

## 操作

1. 页面上方选择波特率，默认 `115200`。
2. 点击「连接串口」，在浏览器设备选择器中选择 USB 串口。
3. 收到遥测后，波形、电压/电流/功率/占空比和链路统计会实时更新。
4. 在右侧「输出电压」输入目标值，点击「应用输出电压」。页面发送 `SET <mV>`，收到 MCU 的 `# SET ...` 应答后显示确认。
5. 可以冻结显示（后台继续接收）、清空波形、导出 CSV，或打开「原始日志」查看收发内容。

曲线说明：

- 绿色实线：输出电压 Vout（左轴 V）
- 橙色实线：输出电流 Iout（右轴 A）
- 蓝色虚线：MCU 内部的斜坡设定值（左轴 V）

## 串口协议

### 遥测

一条遥测一行，约 50 Hz：

```text
V=3.300V I=0.123A Iref=0.456A D=45.0% set=3.300V
```

解析器按字段名识别，顺序可变，单位可以是 `V`/`mV`、`A`/`mA`、`%`。`Iref`、`D` 等字段缺失时只会绘制已有字段。

### 命令

ASCII 行命令，以 `CRLF` 结尾；页面发送时自动添加。电压单位为 **mV**。

| 发送 | 作用 | 成功应答 |
|---|---|---|
| `SET 3300` | 目标输出电压 3.300 V，范围 0–4500 mV | `# SET 3300 mV` |
| `GET` | 读取当前目标 | `# SET 3300 mV` |
| `PING` | 心跳 | `# PONG` |

错误应答以 `# ERR` 开头。页面也兼容旧固件：只要遥测格式一致仍可绘图，但旧固件不会解析 `SET`，页面会在 1.6 秒后提示未收到确认。

固件在保护动作时会主动插入一行 `# FLT ...`（`OCP` 过流 / `OVP` 过压 / `CLR` 恢复），这类行作为普通提示显示在原始日志里，不影响波形与遥测解析。

当前固件在 `src/protocol.c` 中解析命令，`src/main.c` 只负责调度；`SET` 只改变目标，`src/control.c` 中的软启动斜坡以 1 mV/100 µs 跟踪新目标，`set=` 是斜坡后的实时设定。

## 注意

- 页面允许输入到 4.50 V，但本硬件原始设计输出为 3.3 V。超过 3.60 V 时会显示警告；提高电压前请确认功率级、反馈分压和负载的耐压。
- 串口被其他终端（如串口助手、OpenOCD 的串口输出）占用时无法打开。Web Serial 与普通串口助手同一时间只能有一个占用设备。
- CSV 包含 `timestamp_iso, elapsed_s, voltage_v, current_a, current_ref_a, duty_pct, setpoint_v`，导出的是当前缓存中的全部样本（最多约 20000 点）。
- 页面无外部 CDN、字体或遥测上传；串口数据和 CSV 都留在本机。

## 文件与模块

```text
tool/
  index.html          页面结构
  styles.css          暗色仪器风格与响应式布局
  README.md
  js/
    main.js           启动入口
    app.js            应用状态、DOM 绑定、模式与命令流程
    serial-link.js    Web Serial 传输生命周期
    protocol.js       遥测/应答解析与行缓冲
    scope-chart.js    Canvas 波形、缩放与 tooltip
    demo-source.js    演示信号源
    raw-log.js        有界原始日志
    csv.js            CSV 导出
    config.js         限值、时序与颜色
    utils.js          格式化与通用工具
    boot-guard.js     file:// 启动兼容提示
```

详细分层与编码规则见根目录 [AGENTS.md](../AGENTS.md)。
