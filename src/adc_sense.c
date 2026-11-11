#include "adc_sense.h"

#include "config.h"
#include "delay.h"
#include "gd32f10x.h"
#include "gd32f10x_adc.h"
#include "gd32f10x_gpio.h"
#include "gd32f10x_rcu.h"

/* VREFINT is nominally 1.20 V; F1-class parts have no factory calibration
   value, so this tracks VDDA rather than giving an absolute reference. */
#define VREFINT_NOMINAL_MV 1200U

volatile uint32_t g_vdda_mv = ADC_VREF_MV;   /* readable over SWD */
volatile uint16_t g_vref_raw;
volatile uint32_t g_adc_fallback;            /* trigger timeouts */

static uint8_t s_adc_channel = 0xFFU;

static uint32_t adc_wait_eoc(uint32_t timeout)
{
    while (RESET == adc_flag_get(ADC0, ADC_FLAG_EOC)) {
        if (0U == timeout--) {
            return 0U;
        }
    }
    return 1U;
}

void adc_init(void)
{
    rcu_periph_clock_enable(RCU_GPIOA);
    rcu_periph_clock_enable(RCU_ADC0);

    /* ADC clock = APB2 / 6 = 12 MHz (must stay below 14 MHz). */
    rcu_adc_clock_config(RCU_CKADC_CKAPB2_DIV6);

    gpio_init(GPIOA, GPIO_MODE_AIN, GPIO_OSPEED_50MHZ, GPIO_PIN_2 | GPIO_PIN_3);

    adc_deinit(ADC0);
    adc_mode_config(ADC_MODE_FREE);
    adc_special_function_config(ADC0, ADC_SCAN_MODE, DISABLE);
    adc_special_function_config(ADC0, ADC_CONTINUOUS_MODE, DISABLE);
    adc_data_alignment_config(ADC0, ADC_DATAALIGN_RIGHT);
    adc_channel_length_config(ADC0, ADC_REGULAR_CHANNEL, 1U);

    /* Regular group triggered by TIMER1_CH1 at the counter valley. */
    adc_external_trigger_config(ADC0, ADC_REGULAR_CHANNEL, ENABLE);
    adc_external_trigger_source_config(ADC0, ADC_REGULAR_CHANNEL,
                                      ADC0_1_EXTTRIG_REGULAR_T1_CH1);

    adc_enable(ADC0);
    delay_ms(1U);
    adc_calibration_enable(ADC0);

    adc_tempsensor_vrefint_enable();
    delay_ms(1U);
    adc_flag_clear(ADC0, ADC_FLAG_EOC);
}

uint16_t adc_sample(uint8_t channel, uint32_t sample_time)
{
    uint16_t value;
    uint8_t changed = (channel != s_adc_channel) ? 1U : 0U;

    adc_regular_channel_config(ADC0, 0U, channel, sample_time);
    s_adc_channel = channel;
    adc_flag_clear(ADC0, ADC_FLAG_EOC);

    if (changed != 0U) {
        /* A conversion of the previous channel may be in flight: drop it. */
        (void)adc_wait_eoc(500U);
        adc_flag_clear(ADC0, ADC_FLAG_EOC);
    }

    if (0U == adc_wait_eoc(500U)) {
        /* Safety net; should never happen with the timer trigger. */
        g_adc_fallback++;
        adc_software_trigger_enable(ADC0, ADC_REGULAR_CHANNEL);
        (void)adc_wait_eoc(2000U);
    }

    value = adc_regular_data_read(ADC0);
    adc_flag_clear(ADC0, ADC_FLAG_EOC);
    return value;
}

void adc_vrefint_update(void)
{
    uint16_t raw = adc_sample(ADC_CHANNEL_17, ADC_SAMPLETIME_239POINT5);
    uint32_t vdda;

    g_vref_raw = raw;
    if (raw != 0U) {
        vdda = ((uint32_t)VREFINT_NOMINAL_MV * ADC_FULL_SCALE + (raw / 2U)) / raw;
    } else {
        vdda = ADC_VREF_MV;
    }
    if ((vdda >= 2500U) && (vdda <= 4000U)) {
        g_vdda_mv = vdda;
    }
}

uint32_t adc_vdda_mv(void)
{
    return g_vdda_mv;
}
