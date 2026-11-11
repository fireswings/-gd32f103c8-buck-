#ifndef GD32_CONFIG_H
#define GD32_CONFIG_H

/* ---- power stage ---- */
#define PWM_PERIOD 120U       /* center-aligned, 72 MHz / (2 * 120) = 300 kHz */
#define VOUT_SET_MV 3300U     /* output voltage setpoint */

/* ---- voltage sense: PA2 = ADC0_IN2, divider 4:1 ---- */
#define VOLTAGE_RATIO 4U

/* ---- current sense: PA3 = ADC0_IN3, INA240A1 ---- */
#define SHUNT_MILLIOHM 10U
#define AMP_GAIN       20U

/* ---- ADC ---- */
#define ADC_FULL_SCALE 4096U
#define ADC_VREF_MV    3300U

#endif /* GD32_CONFIG_H */
