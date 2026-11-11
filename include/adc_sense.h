#ifndef GD32_ADC_SENSE_H
#define GD32_ADC_SENSE_H

#include <stdint.h>

/* ADC0: PA2 (output voltage) and PA3 (inductor current) plus the internal
   VREFINT on channel 17.  Conversions are started by TIMER1_CH1 at the
   counter valley. */
void adc_init(void);

/* Read one channel.  Blocks until the timer-triggered conversion completes.
   Only call from the control interrupt context. */
uint16_t adc_sample(uint8_t channel, uint32_t sample_time);

/* Re-measure VREFINT and update the VDDA estimate. */
void adc_vrefint_update(void);

/* Latest VDDA estimate in mV (falls back to the nominal 3300 mV). */
uint32_t adc_vdda_mv(void);

#endif /* GD32_ADC_SENSE_H */
