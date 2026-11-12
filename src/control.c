#include "control.h"

#include "adc_sense.h"
#include "config.h"
#include "gd32f10x.h"
#include "gd32f10x_adc.h"
#include "gd32f10x_misc.h"
#include "gd32f10x_rcu.h"
#include "gd32f10x_timer.h"
#include "pwm.h"

/* ---------------- control loop ---------------- */

#define CTRL_HZ        10000U
#define CTRL_PERIOD_US (1000000U / CTRL_HZ)
#define OVP_MARGIN_MV  1900U     /* trip at the ramped setpoint + 1.9 V */
#define OVP_ABS_MAX_MV 5200U     /* but never allow the trip point above 5.2 V */
#define SOFTSTART_MV   1U        /* 1 mV per tick -> ~330 ms full-scale ramp */

/* Outer voltage loop: V -> I_ref (mA).  Runs at CTRL_HZ / V_LOOP_DIV. */
#define V_LOOP_DIV     10U
#define KP_V_Q8_PER_MV 128       /* 0.5 mA/mV */
#define KI_V_Q8_PER_MV 16        /* Q8 mA per mV per outer tick */
#define I_REF_MAX_MA   6000U

/* Inner current loop: I -> duty.  Q16 duty counts, 1 count = 100 mV. */
#define KP_I_Q16_PER_MA 197      /* ~3 duty counts per A */
#define KI_I_Q16_PER_MA 10

/* Hard duty limit keeps the open-loop ceiling near 4.5 V. */
#define DUTY_LIMIT_COUNTS 54U
#define DUTY_MAX_Q16      ((uint32_t)DUTY_LIMIT_COUNTS << 16)

/* ---------------- state (also readable over SWD) ---------------- */
volatile uint32_t g_v_mv;
volatile uint32_t g_i_ma;
volatile uint32_t g_i_ref_ma;
volatile uint32_t g_set_mv;
volatile uint32_t g_v_target_mv = VOUT_SET_MV;
volatile uint32_t g_duty_q16;
volatile uint32_t g_duty_counts;
volatile uint16_t g_v_raw;
volatile uint16_t g_i_raw;
volatile uint32_t g_ctrl_ticks;
volatile uint32_t g_ovp_count;

static int32_t s_i_ref_q8;     /* outer integrator, Q8 mA */
static int32_t s_i_integ_q16;  /* inner integrator, Q16 counts */
static int32_t s_applied_q16;
static int32_t s_v_filt_mv;

static void control_tick(void)
{
    uint32_t i_raw;
    uint32_t v_raw;
    uint32_t v_mv;
    uint32_t ovp_mv;
    int32_t i_ma;
    int32_t i_err;
    int32_t duty_q16;
    int32_t ff_q16;

    /* Soft start/stop: 1 mV per 100 us tick toward the live target. */
    if (g_set_mv < g_v_target_mv) {
        g_set_mv += SOFTSTART_MV;
        if (g_set_mv > g_v_target_mv) {
            g_set_mv = g_v_target_mv;
        }
    } else if (g_set_mv > g_v_target_mv) {
        if ((g_set_mv - g_v_target_mv) <= SOFTSTART_MV) {
            g_set_mv = g_v_target_mv;
        } else {
            g_set_mv -= SOFTSTART_MV;
        }
    }

    /* Current first: it is sampled at the CNT = 0 trigger, i.e. in the middle
       of the high-side on-time, which is the average switch current. */
    i_raw = adc_sample(ADC_CHANNEL_3, ADC_SAMPLETIME_1POINT5);
    g_i_raw = (uint16_t)i_raw;
    i_ma = (int32_t)((((uint32_t)i_raw * adc_vdda_mv()) / ADC_FULL_SCALE) *
                     (1000U / (SHUNT_MILLIOHM * AMP_GAIN)));
    g_i_ma = (uint32_t)i_ma;

    v_raw = adc_sample(ADC_CHANNEL_2, ADC_SAMPLETIME_55POINT5);
    g_v_raw = (uint16_t)v_raw;
    /* One division keeps the fractional divider ratio (4.3) exact. */
    v_mv = ((v_raw * adc_vdda_mv()) * VOLTAGE_RATIO_NUM) /
           (ADC_FULL_SCALE * VOLTAGE_RATIO_DEN);
    g_v_mv = v_mv;

    /* Over-voltage protection, referred to the ramped setpoint so that a
       downward voltage change is not mistaken for an over-voltage event.
       The absolute clamp retains protection when the target is near 4.5 V. */
    ovp_mv = g_set_mv + OVP_MARGIN_MV;
    if (ovp_mv > OVP_ABS_MAX_MV) {
        ovp_mv = OVP_ABS_MAX_MV;
    }
    if (v_mv > ovp_mv) {
        g_ovp_count++;
        s_i_ref_q8 = 0;
        s_i_integ_q16 = 0;
        g_i_ref_ma = 0U;
        g_duty_q16 = 0U;
        g_duty_counts = 0U;
        pwm_set_duty(0U);
        return;
    }

    /* One-pole low pass (~200 Hz): neither loop may have gain at the 1.6 kHz
       LC resonance of this power stage. */
    s_v_filt_mv += (((int32_t)v_mv - s_v_filt_mv) >> 3);

    /* ---------- outer loop: voltage -> current reference ---------- */
    if ((g_ctrl_ticks % V_LOOP_DIV) == 0U) {
        int32_t verr = (int32_t)g_set_mv - s_v_filt_mv;
        int32_t iref;

        s_i_ref_q8 += verr * KI_V_Q8_PER_MV;
        if (s_i_ref_q8 < 0) {
            s_i_ref_q8 = 0;
        } else if (s_i_ref_q8 > (int32_t)(I_REF_MAX_MA << 8)) {
            s_i_ref_q8 = (int32_t)(I_REF_MAX_MA << 8);
        }

        iref = (s_i_ref_q8 >> 8) + ((verr * KP_V_Q8_PER_MV) / 256);
        if (iref < 0) {
            iref = 0;
        } else if (iref > (int32_t)I_REF_MAX_MA) {
            iref = (int32_t)I_REF_MAX_MA;
        }
        g_i_ref_ma = (uint32_t)iref;
    }

    /* ---------- inner loop: current -> duty ---------- */
    ff_q16 = (s_v_filt_mv * 65536) / 100;   /* Vout / 100 mV per count */
    i_err = (int32_t)g_i_ref_ma - i_ma;

    duty_q16 = ff_q16 + s_i_integ_q16 + (i_err * KP_I_Q16_PER_MA);
    if (duty_q16 > (int32_t)DUTY_MAX_Q16) {
        duty_q16 = (int32_t)DUTY_MAX_Q16;
    } else if (duty_q16 < 0) {
        duty_q16 = 0;
    } else {
        /* Conditional integration: no wind-up while the duty is clamped. */
        s_i_integ_q16 += i_err * KI_I_Q16_PER_MA;
        if (s_i_integ_q16 < -(int32_t)DUTY_MAX_Q16) {
            s_i_integ_q16 = -(int32_t)DUTY_MAX_Q16;
        } else if (s_i_integ_q16 > (int32_t)DUTY_MAX_Q16) {
            s_i_integ_q16 = (int32_t)DUTY_MAX_Q16;
        }
    }

    /* Slew limit: at most 1 count per tick, so the duty never steps hard. */
    if (duty_q16 > (s_applied_q16 + 65536)) {
        duty_q16 = s_applied_q16 + 65536;
    } else if (duty_q16 < (s_applied_q16 - 65536)) {
        duty_q16 = s_applied_q16 - 65536;
    }
    if (duty_q16 < 0) {
        duty_q16 = 0;
    }
    s_applied_q16 = duty_q16;
    g_duty_q16 = (uint32_t)duty_q16;

    g_duty_counts = (uint32_t)duty_q16 >> 16;
    pwm_set_duty((uint16_t)g_duty_counts);
}

void TIMER2_IRQHandler(void)
{
    if (RESET != timer_interrupt_flag_get(TIMER2, TIMER_INT_FLAG_UP)) {
        timer_interrupt_flag_clear(TIMER2, TIMER_INT_FLAG_UP);
        g_ctrl_ticks++;

        control_tick();

        if ((g_ctrl_ticks % 1000U) == 0U) {
            adc_vrefint_update();
        }
    }
}

void control_init(void)
{
    timer_parameter_struct para;

    rcu_periph_clock_enable(RCU_TIMER2);
    timer_deinit(TIMER2);
    timer_struct_para_init(&para);
    para.prescaler = (SystemCoreClock / 1000000U) - 1U;   /* 1 MHz */
    para.period = CTRL_PERIOD_US - 1U;                    /* 100 us */
    timer_init(TIMER2, &para);

    timer_interrupt_enable(TIMER2, TIMER_INT_UP);
    nvic_irq_enable(TIMER2_IRQn, 1U, 0U);
    timer_enable(TIMER2);
}

void control_get_state(control_state_t *state)
{
    state->v_mv = g_v_mv;
    state->i_ma = g_i_ma;
    state->iref_ma = g_i_ref_ma;
    state->duty_q16 = g_duty_q16;
    state->set_mv = g_set_mv;
}

int control_set_vout_mv(uint32_t mv)
{
    if (mv > VOUT_MAX_MV) {
        return 0;
    }
    g_v_target_mv = mv;
    return 1;
}

uint32_t control_get_vout_mv(void)
{
    return g_v_target_mv;
}
