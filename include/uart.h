#ifndef GD32_UART_H
#define GD32_UART_H

#include <stdint.h>

/* USART0 on PA9 (TX) / PA10 (RX), 115200-8-N-1. */
void uart_init(void);

/* printf-like output, blocking, no heap. */
void uart_printf(const char *fmt, ...);

/* Pop one complete CR/LF-terminated line from the RX ring.  Returns 1 when a
   line was copied, 0 when no complete line is available. */
int uart_read_line(char *line, uint32_t max_len);

#endif /* GD32_UART_H */
