#include "adc_sense.h"
#include "config.h"
#include "control.h"
#include "delay.h"
#include "pwm.h"
#include "uart.h"

#define LOG_PERIOD_MS 100U

int main(void)
{
    control_state_t st;
    uint32_t duty_permille;

    delay_init();
    uart_init();
    adc_init();
    pwm_init();
    control_init();

    uart_printf("\r\nbuck cascade control: 300 kHz PWM, V outer 1 kHz, I inner 10 kHz\r\n");
    uart_printf("setpoint %u mV, Vref = VREFINT-calibrated\r\n", (unsigned)VOUT_SET_MV);

    while (1) {
        control_get_state(&st);

        /* duty_q16 is Q16 counts, 1 count = 100 mV of input */
        duty_permille = ((st.duty_q16 >> 8) * 1000U) / ((uint32_t)PWM_PERIOD << 8);

        uart_printf("V=%lu.%03luV I=%lu.%03luA Iref=%lu.%03luA D=%lu.%lu%% set=%lu.%03luV\r\n",
                    (unsigned long)(st.v_mv / 1000U), (unsigned long)(st.v_mv % 1000U),
                    (unsigned long)(st.i_ma / 1000U), (unsigned long)(st.i_ma % 1000U),
                    (unsigned long)(st.iref_ma / 1000U), (unsigned long)(st.iref_ma % 1000U),
                    (unsigned long)(duty_permille / 10U), (unsigned long)(duty_permille % 10U),
                    (unsigned long)(st.set_mv / 1000U), (unsigned long)(st.set_mv % 1000U));

        delay_ms(LOG_PERIOD_MS);
    }
}
