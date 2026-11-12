#include "uart.h"

#include <stdarg.h>
#include <stdio.h>

#include "gd32f10x.h"
#include "gd32f10x_gpio.h"
#include "gd32f10x_misc.h"
#include "gd32f10x_rcu.h"
#include "gd32f10x_usart.h"

#define UART_BAUDRATE 115200U

/* Commands are short ASCII lines.  The ISR only queues bytes; parsing and
   all responses happen in the main loop so uart_printf is never re-entered. */
#define UART_RX_RING_SIZE 128U
#define UART_LINE_SIZE    48U

static volatile uint8_t s_rx_ring[UART_RX_RING_SIZE];
static volatile uint16_t s_rx_head;
static volatile uint16_t s_rx_tail;

static char s_line[UART_LINE_SIZE];
static uint16_t s_line_len;
static uint8_t s_line_overflow;

static void uart_send_byte(uint8_t data)
{
    while (RESET == usart_flag_get(USART0, USART_FLAG_TBE)) {
    }
    usart_data_transmit(USART0, data);
}

void USART0_IRQHandler(void)
{
    if (RESET != usart_interrupt_flag_get(USART0, USART_INT_FLAG_RBNE)) {
        uint8_t data = (uint8_t)usart_data_receive(USART0);
        uint16_t next = (uint16_t)((s_rx_head + 1U) % UART_RX_RING_SIZE);

        if (next != s_rx_tail) {
            s_rx_ring[s_rx_head] = data;
            s_rx_head = next;
        }
        /* On a full ring the newest byte is dropped; the current line will
           normally still be terminated and parsed, or rejected as too long. */
    }
}

void uart_init(void)
{
    rcu_periph_clock_enable(RCU_GPIOA);
    rcu_periph_clock_enable(RCU_USART0);

    gpio_init(GPIOA, GPIO_MODE_AF_PP, GPIO_OSPEED_50MHZ, GPIO_PIN_9);
    gpio_init(GPIOA, GPIO_MODE_IN_FLOATING, GPIO_OSPEED_50MHZ, GPIO_PIN_10);

    usart_deinit(USART0);
    usart_baudrate_set(USART0, UART_BAUDRATE);
    usart_word_length_set(USART0, USART_WL_8BIT);
    usart_stop_bit_set(USART0, USART_STB_1BIT);
    usart_parity_config(USART0, USART_PM_NONE);
    usart_hardware_flow_rts_config(USART0, USART_RTS_DISABLE);
    usart_hardware_flow_cts_config(USART0, USART_CTS_DISABLE);
    usart_receive_config(USART0, USART_RECEIVE_ENABLE);
    usart_transmit_config(USART0, USART_TRANSMIT_ENABLE);
    usart_enable(USART0);

    usart_interrupt_enable(USART0, USART_INT_RBNE);
    nvic_irq_enable(USART0_IRQn, 2U, 0U);
}

int uart_read_line(char *line, uint32_t max_len)
{
    while (s_rx_tail != s_rx_head) {
        char c = (char)s_rx_ring[s_rx_tail];
        s_rx_tail = (uint16_t)((s_rx_tail + 1U) % UART_RX_RING_SIZE);

        if (c == '\n') {
            uint32_t i;

            s_line[s_line_len] = '\0';
            s_line_len = 0U;
            if (s_line_overflow != 0U) {
                s_line_overflow = 0U;
                continue;
            }
            if (s_line[0] == '\0') {
                continue;
            }
            for (i = 0U; (i + 1U < max_len) && (s_line[i] != '\0'); i++) {
                line[i] = s_line[i];
            }
            line[i] = '\0';
            return 1;
        }
        if ((c == '\r') || (c == '\0')) {
            continue;
        }
        if (s_line_len < (UART_LINE_SIZE - 1U)) {
            s_line[s_line_len++] = c;
        } else {
            s_line_overflow = 1U;
        }
    }
    return 0;
}

void uart_printf(const char *fmt, ...)
{
    char buf[128];
    va_list args;
    int len;
    int i;

    va_start(args, fmt);
    len = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    if (len <= 0) {
        return;
    }
    if (len > (int)sizeof(buf) - 1) {
        len = (int)sizeof(buf) - 1;
    }
    for (i = 0; i < len; i++) {
        uart_send_byte((uint8_t)buf[i]);
    }
}
