#ifndef GD32_CONFIG_H
#define GD32_CONFIG_H

/* ---- power stage ---- */
#define PWM_PERIOD 120U       /* center-aligned, 72 MHz / (2 * 120) = 300 kHz */
#define VOUT_SET_MV 3300U     /* power-on output voltage setpoint */
#define VOUT_MAX_MV 4500U     /* upper limit accepted from the UART command */

/* ---- voltage sense: PA2 = ADC0_IN2 ----
   R1 = 10k from Vout to the pin, R2 = 15k from the pin to GND:
   Vout = Vpin * (R1 + R2) / R2 = Vpin * 25 / 15 = Vpin * 5 / 3.
   Full scale (3.3 V at the pin) is then 5.5 V, so 4.5 V uses ~82 % of the range. */
#define VOLTAGE_RATIO_NUM 5U
#define VOLTAGE_RATIO_DEN 3U

/* ---- current sense: PA3 = ADC0_IN3, INA240A1 ---- */
#define SHUNT_MILLIOHM 10U
#define AMP_GAIN       20U

/* Software over-current trip.  The 10 mOhm shunt dissipates 0.49 W at 7 A. */
#define I_LIMIT_MA 7000U

/* ---- ADC ---- */
#define ADC_FULL_SCALE 4096U
#define ADC_VREF_MV    3300U

#endif /* GD32_CONFIG_H */
