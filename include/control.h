#ifndef GD32_CONTROL_H
#define GD32_CONTROL_H

#include <stdint.h>

typedef struct {
    uint32_t v_mv;      /* measured output voltage */
    uint32_t i_ma;      /* measured inductor current */
    uint32_t iref_ma;   /* current reference from the outer loop */
    uint32_t duty_q16;  /* inner loop output, Q16 counts */
    uint32_t set_mv;    /* ramped setpoint */
} control_state_t;

/* Start the 10 kHz control interrupt: inner current loop every tick,
   voltage outer loop at 1 kHz. */
void control_init(void);

/* Snapshot of the control state for logging. */
void control_get_state(control_state_t *state);

#endif /* GD32_CONTROL_H */
