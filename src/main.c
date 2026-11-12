#include "adc_sense.h"
#include "control.h"
#include "delay.h"
#include "protocol.h"
#include "pwm.h"
#include "uart.h"

int main(void)
{
    control_state_t st;

    delay_init();
    uart_init();
    adc_init();
    pwm_init();
    control_init();
    protocol_init();

    while (1) {
        protocol_poll();

        control_get_state(&st);
        protocol_send_telemetry(&st);

        delay_ms(PROTOCOL_TELEMETRY_PERIOD_MS);
    }
}
