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

/* Change the target voltage while running.  The soft-start ramp moves the
   internal setpoint toward it; values above VOUT_MAX_MV are rejected. */
int control_set_vout_mv(uint32_t mv);
uint32_t control_get_vout_mv(void);

#endif /* GD32_CONTROL_H */
