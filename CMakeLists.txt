cmake_minimum_required(VERSION 3.20)

project(gd32f103c8t6_blink C ASM)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(LINKER_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/ld/gd32f103c8t6.ld")
set(FIRMWARE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/firmware")
set(CMSIS_DIR "${FIRMWARE_DIR}/CMSIS/GD/GD32F10x")
set(PERIPH_DIR "${FIRMWARE_DIR}/GD32F10x_standard_peripheral")

set(PERIPHERAL_SOURCES
    "${PERIPH_DIR}/Source/gd32f10x_adc.c"
    "${PERIPH_DIR}/Source/gd32f10x_gpio.c"
    "${PERIPH_DIR}/Source/gd32f10x_misc.c"
    "${PERIPH_DIR}/Source/gd32f10x_rcu.c"
    "${PERIPH_DIR}/Source/gd32f10x_timer.c"
    "${PERIPH_DIR}/Source/gd32f10x_usart.c"
)

add_executable(${PROJECT_NAME}
    src/main.c
    src/control.c
    src/adc_sense.c
    src/pwm.c
    src/uart.c
    src/delay.c
    startup/startup_gd32f10x_md.S
    "${CMSIS_DIR}/Source/system_gd32f10x.c"
    ${PERIPHERAL_SOURCES}
)

target_include_directories(${PROJECT_NAME} PRIVATE
    "${FIRMWARE_DIR}/CMSIS"
    "${CMSIS_DIR}/Include"
    "${PERIPH_DIR}/Include"
    include
)

target_compile_definitions(${PROJECT_NAME} PRIVATE
    GD32F10X_MD
    GD_ECLIPSE_GCC
    HXTAL_VALUE=8000000U
    __CM3_REV=0x0200
)

target_compile_options(${PROJECT_NAME} PRIVATE
    $<$<COMPILE_LANGUAGE:C>:-mcpu=cortex-m3;-mthumb;-ffunction-sections;-fdata-sections;-fno-common;-Wall;-Wextra;-Wshadow;-Wundef;-Wdouble-promotion;-Wformat=2;-Og;-g3>
    $<$<COMPILE_LANGUAGE:ASM>:-mcpu=cortex-m3;-mthumb;-x;assembler-with-cpp>
)

target_link_options(${PROJECT_NAME} PRIVATE
    -mcpu=cortex-m3
    -mthumb
    "-T${LINKER_SCRIPT}"
    -Wl,--gc-sections
    -Wl,-Map=${PROJECT_NAME}.map
    -Wl,--print-memory-usage
    --specs=nano.specs
    --specs=nosys.specs
)

target_link_libraries(${PROJECT_NAME} PRIVATE c m)
set_target_properties(${PROJECT_NAME} PROPERTIES SUFFIX ".elf")

find_program(ARM_OBJCOPY arm-none-eabi-objcopy REQUIRED)
find_program(ARM_SIZE arm-none-eabi-size REQUIRED)
find_program(OPENOCD openocd REQUIRED)

add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND "${ARM_OBJCOPY}" -O ihex "$<TARGET_FILE:${PROJECT_NAME}>" "${PROJECT_NAME}.hex"
    COMMAND "${ARM_OBJCOPY}" -O binary "$<TARGET_FILE:${PROJECT_NAME}>" "${PROJECT_NAME}.bin"
    COMMAND "${ARM_SIZE}" "$<TARGET_FILE:${PROJECT_NAME}>"
    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
    COMMENT "Creating HEX/BIN images and reporting memory usage"
)

set(OPENOCD_SCRIPTS "" CACHE PATH "Path to OpenOCD scripts directory")
if(NOT OPENOCD_SCRIPTS)
    get_filename_component(OPENOCD_BIN_DIR "${OPENOCD}" DIRECTORY)
    find_path(OPENOCD_SCRIPTS scripts/interface/cmsis-dap.cfg
        HINTS "${OPENOCD_BIN_DIR}/../openocd" "${OPENOCD_BIN_DIR}/../share/openocd" "${OPENOCD_BIN_DIR}/../scripts")
endif()

if(OPENOCD_SCRIPTS)
    add_custom_target(flash
        COMMAND "${OPENOCD}" -s "${OPENOCD_SCRIPTS}"
            -f interface/cmsis-dap.cfg
            -c "transport select swd"
            -c "adapter speed 1000"
            -c "source [find target/stm32f1x.cfg]"
            -c "init"
            -c "reset halt"
            -c "flash write_image erase $<TARGET_FILE:${PROJECT_NAME}>"
            -c "verify_image $<TARGET_FILE:${PROJECT_NAME}>"
            -c "reset run"
            -c "shutdown"
        DEPENDS ${PROJECT_NAME}
        USES_TERMINAL
        COMMENT "Programming GD32F103C8T6 through DAPLink CMSIS-DAP/SWD"
    )
    add_custom_target(erase
        COMMAND "${OPENOCD}" -s "${OPENOCD_SCRIPTS}"
            -f interface/cmsis-dap.cfg
            -c "transport select swd"
            -c "adapter speed 1000"
            -c "source [find target/stm32f1x.cfg]"
            -c "init"
            -c "reset halt"
            -c "flash erase_sector 0 0 last"
            -c "shutdown"
        USES_TERMINAL
        COMMENT "Erasing GD32F103C8T6 flash"
    )
else()
    message(WARNING "OpenOCD scripts directory not found. Set OPENOCD_SCRIPTS to the directory containing interface/ and target/.")
endif()
