# GD32F103C8T6 同步 Buck 控制器

12 V 输入、3.3 V 输出的同步 Buck，300 kHz 中心对齐 PWM，电压外环 + 电流内环级联控制，串口输出遥测。
基于 GD32F10x Firmware Library V2.7.0，CMake + Ninja + `arm-none-eabi-gcc` + OpenOCD。

## 目录结构

```
src/
  main.c        初始化 + 100 ms 遥测输出
  control.c     10 kHz 控制中断：电压外环(1 kHz) -> 电流内环，OVP、软启动
  adc_sense.c   ADC0 采样（PA2 电压 / PA3 电流 / VREFINT 校准 VDDA）
  pwm.c         TIMER0_CH0 输出 + TIMER1_CH1 产生 ADC 触发
  uart.c        USART0 115200 printf
  delay.c       SysTick 毫秒延时
include/        对应头文件 + config.h（功率级和采样参数）
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
| PA2 | ADC0_IN2 | 输出电压，分压比 4:1 |
| PA3 | ADC0_IN3 | 电感电流，10 mΩ + INA240A1 (20 V/V) |
| PA9 | USART0_TX | 115200-8-N-1 |
| PA10 | USART0_RX | |

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
- 两级都有抗积分饱和、占空比限幅（45%）和过压保护（set + 1.9 V）

## 构建

```powershell
cmake -S . -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi-gcc.cmake
cmake --build build
```

产物：`build/gd32f103c8t6_blink.elf`、`.hex`、`.bin`。工具链需在 `PATH` 中。

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
| `include/config.h` | `VOUT_SET_MV` | 输出电压设定值 |
| `include/config.h` | `PWM_PERIOD` | 开关周期（120 → 300 kHz） |
| `src/control.c` | `KP_V_Q8_PER_MV` / `KI_V_Q8_PER_MV` | 外环增益 |
| `src/control.c` | `KP_I_Q16_PER_MA` / `KI_I_Q16_PER_MA` | 内环增益 |
| `src/control.c` | `I_REF_MAX_MA` | 电流限幅 |
| `src/control.c` | `DUTY_LIMIT_COUNTS` | 占空比上限 |

## 其他

- 系统时钟 72 MHz，来自 8 MHz HXTAL（`HXTAL_VALUE` 在 CMakeLists 中定义）
- `delay.h` 的 `delay_ms()` 基于 SysTick 1 ms 中断，不要在其他模块重复配置 SysTick
- 控制中断里通过 `g_*` 全局变量镜像状态，可直接用 SWD 读取（地址见 map 文件）
