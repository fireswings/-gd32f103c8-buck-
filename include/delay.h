#ifndef GD32_DELAY_H
#define GD32_DELAY_H

#include "gd32f10x.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Initialize the 1 ms system tick. */
void delay_init(void);

/* HAL-style system tick and millisecond delay. */
uint32_t systick_get_tick(void);
void delay_ms(uint32_t ms);

#ifdef __cplusplus
}
#endif

#endif
