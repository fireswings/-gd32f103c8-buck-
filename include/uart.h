#ifndef GD32_UART_H
#define GD32_UART_H

/* USART0 on PA9 (TX) / PA10 (RX), 115200-8-N-1. */
void uart_init(void);

/* printf-like output, blocking, no heap. */
void uart_printf(const char *fmt, ...);

#endif /* GD32_UART_H */
