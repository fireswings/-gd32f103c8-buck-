.syntax unified
.cpu cortex-m3
.thumb

.section .isr_vector,"a",%progbits
.align 2
.global g_pfnVectors
.type g_pfnVectors, %object
g_pfnVectors:
    .word _estack
    .word Reset_Handler
    .word NMI_Handler
    .word HardFault_Handler
    .word MemManage_Handler
    .word BusFault_Handler
    .word UsageFault_Handler
    .word 0, 0, 0, 0
    .word SVC_Handler
    .word DebugMon_Handler
    .word 0
    .word PendSV_Handler
    .word SysTick_Handler
    .word WWDGT_IRQHandler
    .word LVD_IRQHandler
    .word TAMPER_IRQHandler
    .word RTC_IRQHandler
    .word FMC_IRQHandler
    .word RCU_IRQHandler
    .word EXTI0_IRQHandler
    .word EXTI1_IRQHandler
    .word EXTI2_IRQHandler
    .word EXTI3_IRQHandler
    .word EXTI4_IRQHandler
    .word DMA0_Channel0_IRQHandler
    .word DMA0_Channel1_IRQHandler
    .word DMA0_Channel2_IRQHandler
    .word DMA0_Channel3_IRQHandler
    .word DMA0_Channel4_IRQHandler
    .word DMA0_Channel5_IRQHandler
    .word DMA0_Channel6_IRQHandler
    .word ADC0_1_IRQHandler
    .word USBD_HP_CAN0_TX_IRQHandler
    .word USBD_LP_CAN0_RX0_IRQHandler
    .word CAN0_RX1_IRQHandler
    .word CAN0_EWMC_IRQHandler
    .word EXTI5_9_IRQHandler
    .word TIMER0_BRK_IRQHandler
    .word TIMER0_UP_IRQHandler
    .word TIMER0_TRG_CMT_IRQHandler
    .word TIMER0_Channel_IRQHandler
    .word TIMER1_IRQHandler
    .word TIMER2_IRQHandler
    .word TIMER3_IRQHandler
    .word I2C0_EV_IRQHandler
    .word I2C0_ER_IRQHandler
    .word I2C1_EV_IRQHandler
    .word I2C1_ER_IRQHandler
    .word SPI0_IRQHandler
    .word SPI1_IRQHandler
    .word USART0_IRQHandler
    .word USART1_IRQHandler
    .word USART2_IRQHandler
    .word EXTI10_15_IRQHandler
    .word RTC_Alarm_IRQHandler
    .word USBD_WKUP_IRQHandler
    .word 0, 0, 0, 0, 0
    .word EXMC_IRQHandler
.size g_pfnVectors, .-g_pfnVectors

.section .text.Reset_Handler,"ax",%progbits
.weak Reset_Handler
.type Reset_Handler, %function
Reset_Handler:
    ldr r0, =_sdata
    ldr r1, =_edata
    ldr r2, =_sidata
1:
    cmp r0, r1
    bcc 2f
    b 3f
2:
    ldr r3, [r2], #4
    str r3, [r0], #4
    b 1b
3:
    ldr r0, =_sbss
    ldr r1, =_ebss
    movs r2, #0
4:
    cmp r0, r1
    bcc 5f
    b 6f
5:
    str r2, [r0], #4
    b 4b
6:
    bl SystemInit
    bl __libc_init_array
    bl main
7:
    b 7b
.size Reset_Handler, .-Reset_Handler

.section .text.Default_Handler,"ax",%progbits
.weak Default_Handler
.type Default_Handler, %function
Default_Handler:
    b .
.size Default_Handler, .-Default_Handler

.macro weak_handler name
    .weak \name
    .thumb_set \name, Default_Handler
.endm

weak_handler NMI_Handler
weak_handler HardFault_Handler
weak_handler MemManage_Handler
weak_handler BusFault_Handler
weak_handler UsageFault_Handler
weak_handler SVC_Handler
weak_handler DebugMon_Handler
weak_handler PendSV_Handler
weak_handler SysTick_Handler
weak_handler WWDGT_IRQHandler
weak_handler LVD_IRQHandler
weak_handler TAMPER_IRQHandler
weak_handler RTC_IRQHandler
weak_handler FMC_IRQHandler
weak_handler RCU_IRQHandler
weak_handler EXTI0_IRQHandler
weak_handler EXTI1_IRQHandler
weak_handler EXTI2_IRQHandler
weak_handler EXTI3_IRQHandler
weak_handler EXTI4_IRQHandler
weak_handler DMA0_Channel0_IRQHandler
weak_handler DMA0_Channel1_IRQHandler
weak_handler DMA0_Channel2_IRQHandler
weak_handler DMA0_Channel3_IRQHandler
weak_handler DMA0_Channel4_IRQHandler
weak_handler DMA0_Channel5_IRQHandler
weak_handler DMA0_Channel6_IRQHandler
weak_handler ADC0_1_IRQHandler
weak_handler USBD_HP_CAN0_TX_IRQHandler
weak_handler USBD_LP_CAN0_RX0_IRQHandler
weak_handler CAN0_RX1_IRQHandler
weak_handler CAN0_EWMC_IRQHandler
weak_handler EXTI5_9_IRQHandler
weak_handler TIMER0_BRK_IRQHandler
weak_handler TIMER0_UP_IRQHandler
weak_handler TIMER0_TRG_CMT_IRQHandler
weak_handler TIMER0_Channel_IRQHandler
weak_handler TIMER1_IRQHandler
weak_handler TIMER2_IRQHandler
weak_handler TIMER3_IRQHandler
weak_handler I2C0_EV_IRQHandler
weak_handler I2C0_ER_IRQHandler
weak_handler I2C1_EV_IRQHandler
weak_handler I2C1_ER_IRQHandler
weak_handler SPI0_IRQHandler
weak_handler SPI1_IRQHandler
weak_handler USART0_IRQHandler
weak_handler USART1_IRQHandler
weak_handler USART2_IRQHandler
weak_handler EXTI10_15_IRQHandler
weak_handler RTC_Alarm_IRQHandler
weak_handler USBD_WKUP_IRQHandler
weak_handler EXMC_IRQHandler
