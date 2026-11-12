#ifndef GD32_PROTOCOL_H
#define GD32_PROTOCOL_H

#include "control.h"

/* Wire protocol layer: ASCII telemetry plus SET/GET/PING line commands.
   It depends on uart for transport and control for the voltage target, but
   contains no GPIO/ADC/PWM code. */

#define PROTOCOL_TELEMETRY_PERIOD_MS 20U

/* Print the boot banner.  Call after uart_init() and control_init(). */
void protocol_init(void);

/* Consume complete received lines and answer any commands.  Non-blocking;
   call from the main loop. */
void protocol_poll(void);

/* Own the telemetry line format so the wire contract lives in one place. */
void protocol_send_telemetry(const control_state_t *state);

#endif /* GD32_PROTOCOL_H */
