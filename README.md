# GD32F103C8T6 同步 Buck 控制器

12 V 输入、3.3 V 输出的同步 Buck，300 kHz 中心对齐 PWM，电压外环 + 电流内环级联控制，串口输出遥测并支持运行时改输出电压。
基于 GD32F10x Firmware Library V2.7.0，CMake + Ninja + `arm-none-eabi-gcc` + OpenOCD。

## 目录结构

```
src/
  main.c        初始化与主循环调度
  protocol.c    ASCII 命令解析、应答与遥测格式化
  control.c     10 kHz 控制中断：电压外环(1 kHz) -> 电流内环，OVP、软启动
  adc_sense.c   ADC0 采样（PA2 电压 / PA3 电流 / VREFINT 校准 VDDA）
  pwm.c         TIMER0_CH0 输出 + TIMER1_CH1 产生 ADC 触发
  uart.c        USART0 115200 printf + 中断接收命令行
  delay.c       SysTick 毫秒延时
include/        对应头文件 + config.h（功率级和采样参数）
tool/
  index.html    页面结构
  styles.css    视觉样式与响应式布局
  js/           串口、协议解析、Canvas 波形、UI 组合等 ES 模块
AGENTS.md       项目结构、协议和编码规则
firmware/       GD32F10x 固件库（CMSIS + standard peripheral）
cmake/          交叉编译工具链文件
ld/             链接脚本
startup/        启动文件
```

## 硬件连接

| 引脚 | 功能 | 说明 |
|---|---|---|
| PA8 | TIMER0_CH0 | 高边 PWM，中心对齐 300 kHz |
| PA0 | TIMER1_CH1 | ADC 触发脉冲（示波器探测点） |
| PA2 | ADC0_IN2 | 输出电压，分压比 1.67:1（10 kΩ / 15 kΩ） |
| PA3 | ADC0_IN3 | 电感电流，10 mΩ + INA240A1 (20 V/V) |
| PA9 | USART0_TX | 115200-8-N-1 遥测输出 |
| PA10 | USART0_RX | 115200-8-N-1 命令输入 |

## 串口协议

MCU 每 20 ms（约 50 Hz）输出一行遥测：

```text
V=3.300V I=0.123A Iref=0.456A D=45.0% set=3.300V
```

上位机发送 ASCII 行命令（CRLF 或 LF 结尾）：

| 命令 | 说明 | 应答 |
|---|---|---|
| `SET 3300` | 设置目标输出电压，单位 mV，范围 0–4500 | `# SET 3300 mV` |
| `GET` | 读取当前目标电压 | `# SET <mV> mV` |
| `PING` | 链路心跳 | `# PONG` |
| 错误命令 | — | `# ERR ...` |

`SET` 只修改目标值。内部设定值仍按 1 mV/100 µs 的斜率软启动/软停止，避免阶跃冲击功率级。
`set=` 遥测字段是**已斜坡跟踪**的回路设定值，不会瞬间跳到新目标。

保护动作会主动上报一行 `# FLT ...`（不影响遥测格式，旧上位机忽略即可）：

| 上报 | 含义 |
|---|---|
| `# FLT OCP` | 电流超过 `I_LIMIT_MA`（默认 7 A），跳闸 |
| `# FLT OVP` | 电压超过设定值 + 700 mV 并持续 2 ms，跳闸 |
| `# FLT CLR` | 2 s 冷却结束，重新软启动 |

跳闸后 PWM 立即关闭并锁存 2 s，随后从 0 V 重新软启动；故障持续时会周期性重试。

## 控制结构

```
V_set -> 外环 PI (1 kHz) -> I_ref -> 内环 PI (10 kHz) -> 占空比 -> PA8
          ^                            ^
        PA2 电压                    PA3 电流（谷底采样）
```

- PWM 中心对齐，`ARR = 120` → 72 MHz / (2×120) = 300 kHz，高电平以 CNT=0 为中心
- ADC 由 `TIMER1_CH1` 在 CNT≈0 处硬件触发，电流用 1.5 周期采样窗口取导通中点（= 平均电流）
- 电压经 200 Hz 一阶低通后进入外环，避免环路在 1.6 kHz 的 LC 谐振点上有增益
- 内环带 `Vout/100` 前馈，抵消输出电压对电感电流斜率的影响
- 两级都有抗积分饱和、占空比限幅（45%）和过压保护（当前斜坡设定 + 1.9 V，最高 5.2 V）

## 构建

```powershell
cmake -S . -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi-gcc.cmake
cmake --build build
```

产物：`build/gd32f103c8t6_blink.elf`、`.hex`、`.bin`。工具链需在 `PATH` 中。

## Web 串口工具

`tool/` 内是一个零依赖的 Web Serial 页面，可实时绘制 Vout、Iout、回路设定值，并通过 `SET` 命令修改输出电压。
网页使用 ES Modules，必须通过 HTTP 服务打开：

```powershell
python -m http.server 8000 -d tool
# 浏览器访问 http://localhost:8000/
```

连接串口后选择 115200 波特率。页面还会显示 MCU 返回的 `#` 开头应答；若没有硬件，可以点击「演示」查看波形和命令交互。
详细说明见 `tool/README.md`；代码结构与开发规则见 `AGENTS.md`。

## 烧录

DAPLink 通过 SWD 连接（SWDIO/SWCLK/GND + 共地），然后：

```powershell
cmake --build build --target flash     # 烧录
cmake --build build --target erase     # 全片擦除
```

若 OpenOCD 找不到脚本目录，配置时加 `-DOPENOCD_SCRIPTS="<openocd>/scripts"`。

## 参数调整

| 位置 | 宏 | 含义 |
|---|---|---|
| `include/config.h` | `VOUT_SET_MV` | 上电默认输出电压设定值 |
| `include/config.h` | `VOUT_MAX_MV` | 上位机命令允许的最大电压（4500 mV） |
| `include/config.h` | `PWM_PERIOD` | 开关周期（120 → 300 kHz） |
| `src/control.c` | `KP_V_Q8_PER_MV` / `KI_V_Q8_PER_MV` | 外环增益 |
| `src/control.c` | `KP_I_Q16_PER_MA` / `KI_I_Q16_PER_MA` | 内环增益 |
| `src/control.c` | `I_REF_MAX_MA` | 电流限幅 |
| `src/control.c` | `DUTY_LIMIT_COUNTS` | 占空比上限 |

## 其他

- 系统时钟 72 MHz，来自 8 MHz HXTAL（`HXTAL_VALUE` 在 CMakeLists 中定义）
- `delay.h` 的 `delay_ms()` 基于 SysTick 1 ms 中断，不要在其他模块重复配置 SysTick
- 控制中断里通过 `g_*` 全局变量镜像状态，可直接用 SWD 读取（地址见 map 文件）
