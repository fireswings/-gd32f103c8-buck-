#include "pwm.h"

#include "config.h"
#include "gd32f10x.h"
#include "gd32f10x_gpio.h"
#include "gd32f10x_rcu.h"
#include "gd32f10x_timer.h"

/* TIMER1_CH1 compare value.  OC1REF rises when the counter falls through
   CCR-1, so 22 puts the ADC trigger 21 counts (292 ns) before the valley.
   With the ~2 ADCCLK trigger latency plus the 1.5-cycle aperture, the
   sample-and-hold lands on CNT = 0.  CCR = 1 or 2 does not produce a usable
   trigger edge on this part. */
#define ADC_TRIGGER_CCR 22U

static void pwm_timer_config(void)
{
    timer_parameter_struct timer_initpara;
    timer_oc_parameter_struct timer_ocintpara;

    timer_struct_para_init(&timer_initpara);
    timer_initpara.prescaler = 0U;
    timer_initpara.alignedmode = TIMER_COUNTER_CENTER_BOTH;
    timer_initpara.period = PWM_PERIOD;
    timer_init(TIMER0, &timer_initpara);

    timer_channel_output_struct_para_init(&timer_ocintpara);
    timer_ocintpara.outputstate = TIMER_CCX_ENABLE;
    timer_ocintpara.ocpolarity = TIMER_OC_POLARITY_HIGH;
    timer_channel_output_config(TIMER0, TIMER_CH_0, &timer_ocintpara);
    timer_channel_output_mode_config(TIMER0, TIMER_CH_0, TIMER_OC_MODE_PWM0);
    timer_channel_output_shadow_config(TIMER0, TIMER_CH_0, TIMER_OC_SHADOW_ENABLE);
    timer_channel_output_pulse_value_config(TIMER0, TIMER_CH_0, 0U);

    /* Advanced timer: CCHP.POEN must be set or the output stays idle. */
    timer_primary_output_config(TIMER0, ENABLE);
}

static void adc_trigger_timer_config(void)
{
    timer_parameter_struct timer_initpara;
    timer_oc_parameter_struct timer_ocintpara;

    timer_struct_para_init(&timer_initpara);
    timer_initpara.prescaler = 0U;
    timer_initpara.alignedmode = TIMER_COUNTER_CENTER_BOTH;
    timer_initpara.period = PWM_PERIOD;
    timer_init(TIMER1, &timer_initpara);

    timer_channel_output_struct_para_init(&timer_ocintpara);
    timer_ocintpara.outputstate = TIMER_CCX_ENABLE;
    timer_ocintpara.ocpolarity = TIMER_OC_POLARITY_HIGH;
    timer_channel_output_config(TIMER1, TIMER_CH_1, &timer_ocintpara);
    timer_channel_output_mode_config(TIMER1, TIMER_CH_1, TIMER_OC_MODE_PWM0);
    timer_channel_output_shadow_config(TIMER1, TIMER_CH_1, TIMER_OC_SHADOW_ENABLE);
    timer_channel_output_pulse_value_config(TIMER1, TIMER_CH_1, ADC_TRIGGER_CCR);
}

void pwm_init(void)
{
    rcu_periph_clock_enable(RCU_GPIOA);
    rcu_periph_clock_enable(RCU_TIMER0);
    rcu_periph_clock_enable(RCU_TIMER1);

    /* PA8 = TIMER0_CH0, PA0 = TIMER1_CH1 (ADC trigger / scope probe). */
    gpio_init(GPIOA, GPIO_MODE_AF_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_8);
    gpio_init(GPIOA, GPIO_MODE_AF_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_0);

    pwm_timer_config();
    adc_trigger_timer_config();

    /* Start both back to back so they stay locked to the same clock. */
    timer_enable(TIMER0);
    timer_enable(TIMER1);
}

void pwm_set_duty(uint16_t counts)
{
    if (counts > PWM_PERIOD) {
        counts = PWM_PERIOD;
    }
    TIMER_CH0CV(TIMER0) = counts;
}
