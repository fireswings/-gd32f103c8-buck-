# 项目代码规则

本文件是仓库的结构与编码约定，优先级高于 README 中的实现细节。修改代码前先确认改动属于哪一层；不要为了省事绕过现有边界。

## 1. 产品与约束

- 目标硬件：GD32F103C8T6，12 V 输入同步 Buck，默认 3.3 V 输出，300 kHz 中心对齐 PWM。
- 固件：C + GD32F10x 标准外设库，构建系统为 CMake + Ninja。
- 网页：原生 HTML/CSS/JavaScript ES Modules + Canvas，无框架、无 CDN、无构建步骤。
- 串口是唯一的上位机通道：115200-8-N-1，ASCII 行协议，约 50 Hz 遥测。
- 电压目标范围固定为 0–4500 mV。网页允许输入的上限是 4.50 V，并在超过 3.60 V 时警告；`VOUT_MAX_MV` 与 `VOLTAGE.MAX` 必须同步修改。
- 不自动在上位机连接时下发电压。用户必须显式点击“应用输出电压”。
- 安全相关逻辑（软启动、占空比限幅、OVP）属于固件控制域，网页不得假设自己拥有这些保护。

## 2. 固件分层

依赖方向必须自上而下，不能反向依赖：

```text
main.c
  ├─ protocol.c ── uart.c
  ├─ control.c ── adc_sense.c / pwm.c / config.h
  └─ delay.c / hardware init
```

| 层 | 文件 | 职责 |
|---|---|---|
| 集成层 | `src/main.c` | 初始化顺序、主循环调度；不解析协议、不拼接遥测 |
| 协议层 | `src/protocol.c` / `include/protocol.h` | ASCII 命令解析、应答、遥测格式化；只依赖 uart、control 和 config |
| 控制域 | `src/control.c` / `include/control.h` | 电压/电流闭环、软启动、OVP、运行时电压目标 |
| 采样与功率级 | `src/adc_sense.c`、`src/pwm.c`、`src/delay.c` | 硬件驱动，不知道协议和上位机 |
| 传输层 | `src/uart.c` / `include/uart.h` | USART 收发、RX 环形缓冲、行读取；不知道命令语义 |

规则：

- 遥测字符串只能由 `protocol_send_telemetry()` 生成；其他模块不得直接 `uart_printf()` 输出遥测。
- `uart.c` 不得解析 `SET`/`GET`，不得调用 control。
- `protocol.c` 不得直接操作 GPIO、ADC、PWM 或控制中断。
- `main.c` 负责初始化顺序与主循环调度；主循环只调用 `protocol_poll()`、`control_get_state()`、`protocol_send_telemetry()` 和延时。
- ISR 中只做必要的硬件/状态操作，不进行阻塞发送、字符串解析或内存分配。
- 与 ISR 共享的变量使用 `volatile`，并保持 32 位以内的单次读写；复杂结构用快照函数复制。
- 内部函数默认 `static`；模块接口放对应 `.h`。
- 固定常量放 `include/config.h` 或模块内具名宏，不散落魔数。
- 不做动态内存分配。

## 3. 网页分层

```text
index.html
  ├─ styles.css
  └─ js/main.js
       └─ app.js
            ├─ serial-link.js (transport)
            ├─ protocol.js   (wire parsing)
            ├─ scope-chart.js (canvas view)
            ├─ demo-source.js (simulator)
            ├─ raw-log.js     (bounded log view)
            ├─ csv.js         (export)
            └─ config.js / utils.js
```

| 文件 | 职责 |
|---|---|
| `tool/index.html` | 只放结构与文案，不放业务逻辑、不写内联样式 |
| `tool/styles.css` | 所有视觉样式、响应式断点、组件状态 |
| `tool/js/main.js` | 只创建并启动 App |
| `tool/js/app.js` | 组合根：DOM 绑定、应用状态、模式切换、UI 渲染、命令流程 |
| `tool/js/config.js` | 常量、限值、颜色、时序；不得依赖 DOM |
| `tool/js/utils.js` | 无状态工具函数；不得依赖应用状态 |
| `tool/js/protocol.js` | 遥测/应答解析、行缓冲、命令构造；不得访问 DOM 或串口 |
| `tool/js/serial-link.js` | Web Serial 打开/读取/写入/生命周期；不得访问 DOM 或绘图 |
| `tool/js/scope-chart.js` | Canvas 绘制、缩放、命中测试、图表 tooltip |
| `tool/js/demo-source.js` | 模拟信号源；只通过 `onLine` 回调输出协议行，不访问 DOM |
| `tool/js/raw-log.js` | 有界原始日志模型与渲染，不负责串口 |
| `tool/js/csv.js` | 纯导出逻辑与下载触发 |
| `tool/js/boot-guard.js` | 仅做 `file://` 启动兼容提示 |

规则：

- ES Module 之间用显式 `import`/`export`，禁止把对象挂到 `window` 共享状态。
- `serial-link.js`、`demo-source.js`、`protocol.js`、`config.js` 不得直接查询 DOM。
- `scope-chart.js` 只接收 canvas、tooltip 与 `setView()` 数据；不得直接读取串口或修改应用状态。
- `app.js` 是唯一持有应用模式的模块；其他模块用回调上报事件。
- 新增一个独立职责时新增模块；不要把串口、解析、绘图和 DOM 混入同一文件。
- 无外部依赖；不要为了一个小功能引入框架或 CDN。
- `index.html` 必须通过 HTTP 打开，因为使用了 ES Modules。`boot-guard.js` 只用于 `file://` 下给出明确提示。
- 所有串口、设备或用户输入文本必须通过 `textContent` 写入 DOM，禁止 `innerHTML`。
- 所有 DOM 查询集中在 `app.js` 的 `cacheUi()` 或模块构造参数中，不在循环里反复查询（`boot-guard.js` 的启动检查除外）。
- 用户可见文案使用中文；标识符、日志键名和协议字段使用英文。

## 4. 协议契约

遥测（每约 20 ms 一行，单位 V/A/%）：

```text
V=3.300V I=0.123A Iref=0.456A D=45.0% set=3.300V
```

命令（CRLF 或 LF 结尾，ASCII，电压单位为 mV）：

| 命令 | 作用 | 应答 |
|---|---|---|
| `SET 3300` | 设置目标输出电压 0–4500 mV | `# SET 3300 mV` |
| `GET` | 读取目标电压 | `# SET <mV> mV` |
| `PING` | 心跳 | `# PONG` |
| 错误 | 语法或范围错误 | `# ERR ...` |

修改协议时必须同时完成：

1. 更新 `src/protocol.c` 与对应网页解析/命令代码。
2. 更新 `README.md`、`tool/README.md` 的协议表。
3. 检查 50 Hz 下的 UART 带宽，保持低于 115200 baud 的约 50%。
4. 保留对旧遥测格式的只读兼容；不要静默改动字段含义。
5. 验证 SET 应答、错误路径、无应答超时。

单位和精度规则：

- 固件内部电压状态使用 mV；线路遥测 `V=`/`set=` 使用 V。
- 网页命令边界使用整数 mV；内部样本以 V、A、% 存放。
- 不要在 UI、CSV、tooltip 之间变换单位；统一在解析/命令边界转换一次。

## 5. 状态与并发规则

- 应用状态集中保存在 `BuckScopeApp`：模式、样本、暂停、待确认命令、串口信息。
- `SerialLink` 只负责传输状态，不向上层暴露内部 reader/writer。
- `ScopeChart` 只保存视图状态（samples 引用、时间窗、暂停点、series 开关），不保存业务模式。
- `DemoSource` 只保存模拟器内部状态；通过回调输出与真实固件相同格式的行。
- 每个串口样本的 `t` 必须严格递增，使用 `performance.now()`；墙体时间只用于日志/CSV。
- `SET` 在等待应答期间必须禁用重复发送，并设置 1.6 s 超时提示。
- 新样本最多保留 20000 个；原始日志最多 600 条；日志刷新频率不超过 4 Hz。
- 串口断开、取消、超时都要清理待确认命令，并保留已采样本用于查看和导出。
- 不得在接收回调里同步重绘整页；图表通过 rAF 合并刷新。

## 6. C 语言风格

- 4 空格缩进；大括号与语句同行。
- 函数与变量 `snake_case`；类型后缀 `_t`；宏大写。
- 头文件使用 include guard；不要 include 不必要的库。
- 固定宽度类型优先使用 `<stdint.h>`；输出格式化使用 `unsigned long` 显式转换，避免架构差异。
- 每个函数只做一件事；硬件访问、协议、控制分离。
- 新增/修改代码不得引入新警告；已知的厂商头文件与链接器警告除外。不得靠关闭 warning 掩盖问题。
- 注释使用简洁英文；协议/安全决策在头文件或 README 说明。

## 7. JavaScript 风格

- 2 空格缩进；单引号；分号；命名 `camelCase`，类 `PascalCase`，常量 `UPPER_SNAKE_CASE`。
- 优先小函数、显式参数、无隐藏全局副作用。
- 状态对象与回调在构造时注入；模块不自行读取全局应用对象。
- DOM 元素必须在初始化时缓存；动态文本必须 `textContent`。
- 浮点显示统一走 `utils.js` 的格式化函数；坐标/绘图内部保留全精度。
- 失败路径必须有中文可理解提示；不得用 `alert()`。
- 颜色、限值、时序放 `config.js`；不要散落魔法数。
- 不引入依赖、构建器或压缩步骤。修改后仍可通过静态服务器直接运行。

## 8. 测试与交付

固件改动后至少执行：

```powershell
cmake -S . -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi-gcc.cmake
cmake --build build
```

- 构建必须成功，记录 Flash/RAM 使用量。
- 若改动协议、控制或 ISR，说明是否在真实板卡上验证；未验证不得声称已验证。
- 检查新增/修改文件无新的编译警告。

网页改动后至少执行：

1. 在仓库根目录启动 `python -m http.server 8000 -d tool`，用 Chrome/Edge 打开 `http://localhost:8000/`。
2. 使用“演示”验证：波形、Hover tooltip、冻结/继续、清空、原始日志、CSV 导出。
3. 使用 mock Web Serial 或真实设备验证：连接、遥测、SET 应答、断开、设备移除。
4. 检查 1440 / 820 / 390 px 宽度无水平溢出。
5. 检查控制台无 JavaScript 异常、无 404。
6. 用 `file://` 打开时确认 `boot-guard.js` 显示 HTTP 启动提示，而不是空白页面。

检查项清单：

- [ ] 协议两侧与文档同步
- [ ] 无新增全局状态/依赖
- [ ] 设备文本转义安全
- [ ] 串口错误与命令超时路径
- [ ] 0–4500 mV 边界与 >3.60 V 警告
- [ ] 构建/浏览器验证结果如实报告

## 9. 文档规则

- 用户运行方式、协议表、硬件连接放 `README.md` / `tool/README.md`。
- 详细分层边界与编码规则只维护在本文件，不在其它 README 复制规则文本；README 可以保留简短目录说明。
- 修改行为时同步更新相关文档；不能只改代码。
- 规则本身变动时，先修改本文件，再按新规则调整代码。
