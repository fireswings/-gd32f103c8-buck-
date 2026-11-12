#include "protocol.h"

#include <stdint.h>

#include "config.h"
#include "control.h"
#include "uart.h"

#define PROTOCOL_LINE_SIZE 48U

static char *skip_spaces(char *p)
{
    while ((*p == ' ') || (*p == '\t')) {
        p++;
    }
    return p;
}

static char ascii_upper(char c)
{
    if ((c >= 'a') && (c <= 'z')) {
        return (char)(c - ('a' - 'A'));
    }
    return c;
}

static int command_is(const char *cmd, const char *name)
{
    while ((*cmd != '\0') && (*name != '\0')) {
        if (ascii_upper(*cmd) != *name) {
            return 0;
        }
        cmd++;
        name++;
    }
    return (*cmd == '\0') && (*name == '\0');
}

static int parse_mv(const char *text, uint32_t *value)
{
    uint32_t result = 0U;
    int digits = 0;

    while ((*text >= '0') && (*text <= '9')) {
        if (result > 100000U) {
            return 0;
        }
        result = (result * 10U) + (uint32_t)(*text - '0');
        text++;
        digits++;
    }
    if (digits == 0) {
        return 0;
    }
    while ((*text == ' ') || (*text == '\t')) {
        text++;
    }
    if (*text != '\0') {
        return 0;
    }
    *value = result;
    return 1;
}

static void handle_command(char *line)
{
    char *p = skip_spaces(line);
    char *cmd;
    char *arg;
    uint32_t mv;

    if (*p == '\0') {
        return;
    }

    cmd = p;
    while ((*p != '\0') && (*p != ' ') && (*p != '\t')) {
        *p = ascii_upper(*p);
        p++;
    }
    if (*p != '\0') {
        *p = '\0';
        p++;
    }
    p = skip_spaces(p);
    if ((*p == '=') || (*p == ':')) {
        p++;
        p = skip_spaces(p);
    }
    arg = p;

    if (command_is(cmd, "SET")) {
        if (!parse_mv(arg, &mv)) {
            uart_printf("# ERR syntax: SET <mV>\r\n");
            return;
        }
        if (mv > VOUT_MAX_MV) {
            uart_printf("# ERR range: 0..%lu mV\r\n", (unsigned long)VOUT_MAX_MV);
            return;
        }
        (void)control_set_vout_mv(mv);
        uart_printf("# SET %lu mV\r\n", (unsigned long)mv);
    } else if (command_is(cmd, "GET")) {
        uart_printf("# SET %lu mV\r\n", (unsigned long)control_get_vout_mv());
    } else if (command_is(cmd, "PING")) {
        uart_printf("# PONG\r\n");
    } else {
        uart_printf("# ERR unknown command; use SET <mV> or GET\r\n");
    }
}

void protocol_init(void)
{
    uart_printf("\r\nbuck cascade control: 300 kHz PWM, V outer 1 kHz, I inner 10 kHz\r\n");
    uart_printf("setpoint %u mV, commands: SET <0..%u mV>, GET\r\n",
                (unsigned)VOUT_SET_MV, (unsigned)VOUT_MAX_MV);
}

void protocol_poll(void)
{
    char line[PROTOCOL_LINE_SIZE];

    while (uart_read_line(line, sizeof(line)) != 0) {
        handle_command(line);
    }
}

void protocol_send_telemetry(const control_state_t *state)
{
    uint32_t duty_permille;

    /* duty_q16 is Q16 counts, 1 count = 100 mV of input. */
    duty_permille = ((state->duty_q16 >> 8) * 1000U) / ((uint32_t)PWM_PERIOD << 8);

    uart_printf("V=%lu.%03luV I=%lu.%03luA Iref=%lu.%03luA D=%lu.%lu%% set=%lu.%03luV\r\n",
                (unsigned long)(state->v_mv / 1000U), (unsigned long)(state->v_mv % 1000U),
                (unsigned long)(state->i_ma / 1000U), (unsigned long)(state->i_ma % 1000U),
                (unsigned long)(state->iref_ma / 1000U), (unsigned long)(state->iref_ma % 1000U),
                (unsigned long)(duty_permille / 10U), (unsigned long)(duty_permille % 10U),
                (unsigned long)(state->set_mv / 1000U), (unsigned long)(state->set_mv % 1000U));
}
