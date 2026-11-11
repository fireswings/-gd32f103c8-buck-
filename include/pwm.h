#ifndef GD32_PWM_H
#define GD32_PWM_H

#include <stdint.h>

/* TIMER0_CH0 on PA8: center-aligned 300 kHz.
   TIMER1_CH1 on PA0: one pulse per period at the counter valley, used as the
   ADC trigger and as a scope probe point. */
void pwm_init(void);

/* Update the compare value (0..PWM_PERIOD).  The channel has its shadow
   register enabled, so the new duty is taken over at the next update event. */
void pwm_set_duty(uint16_t counts);

#endif /* GD32_PWM_H */
