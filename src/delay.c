#include "delay.h"

static volatile uint32_t system_tick;

void SysTick_Handler(void)
{
    system_tick++;
}

void delay_init(void)
{
    uint32_t ticks = SystemCoreClock / 1000U;

    if ((ticks == 0U) || (ticks > (SysTick_LOAD_RELOAD_Msk + 1U))) {
        while (1) {
        }
    }

    system_tick = 0U;
    (void)SysTick_Config(ticks);
}

uint32_t systick_get_tick(void)
{
    return system_tick;
}

void delay_ms(uint32_t ms)
{
    uint32_t start_tick = systick_get_tick();

    while ((uint32_t)(systick_get_tick() - start_tick) < ms) {
        __WFI();
    }
}
