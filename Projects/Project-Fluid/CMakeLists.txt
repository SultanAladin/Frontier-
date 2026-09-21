# Project Fluid is intentionally isolated from the legacy engine executable: its
# CPU mirror always builds, while the interactive target is enabled when a Vulkan
# SDK, GLFW and glslc are installed.

add_library(ProjectFluidCore STATIC
    Source/SpectralOcean.cpp
    Source/SpectralOcean.h
)
target_include_directories(ProjectFluidCore PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/Source)
target_compile_features(ProjectFluidCore PUBLIC cxx_std_20)

add_executable(Project-Fluid-CPU Source/CpuMirrorMain.cpp)
target_link_libraries(Project-Fluid-CPU PRIVATE ProjectFluidCore)

option(FRONTIER_BUILD_PROJECT_FLUID_VULKAN "Build the interactive Project Fluid Vulkan window" ON)
if(FRONTIER_BUILD_PROJECT_FLUID_VULKAN)
    find_package(Vulkan QUIET)
    find_package(glfw3 QUIET)
    find_program(PROJECT_FLUID_GLSLC NAMES glslc HINTS "$ENV{VULKAN_SDK}/Bin" "$ENV{VULKAN_SDK}/bin")

    if(Vulkan_FOUND AND PROJECT_FLUID_GLSLC AND (TARGET glfw OR TARGET glfw3::glfw))
        set(FLUID_SHADER_DIR ${CMAKE_CURRENT_BINARY_DIR}/Shaders)
        file(MAKE_DIRECTORY ${FLUID_SHADER_DIR})
        set(FLUID_SURFACE_SPV ${FLUID_SHADER_DIR}/OceanSurface.comp.spv)
        set(FLUID_PRESENT_SPV ${FLUID_SHADER_DIR}/OceanPresent.comp.spv)
        add_custom_command(OUTPUT ${FLUID_SURFACE_SPV}
            COMMAND ${PROJECT_FLUID_GLSLC} -O ${CMAKE_CURRENT_SOURCE_DIR}/Shaders/OceanSurface.comp -o ${FLUID_SURFACE_SPV}
            DEPENDS Shaders/OceanSurface.comp VERBATIM)
        add_custom_command(OUTPUT ${FLUID_PRESENT_SPV}
            COMMAND ${PROJECT_FLUID_GLSLC} -O ${CMAKE_CURRENT_SOURCE_DIR}/Shaders/OceanPresent.comp -o ${FLUID_PRESENT_SPV}
            DEPENDS Shaders/OceanPresent.comp VERBATIM)
        add_custom_target(ProjectFluidShaders DEPENDS ${FLUID_SURFACE_SPV} ${FLUID_PRESENT_SPV})

        add_executable(Project-Fluid Source/VulkanFluidMain.cpp)
        add_dependencies(Project-Fluid ProjectFluidShaders)
        target_link_libraries(Project-Fluid PRIVATE ProjectFluidCore Vulkan::Vulkan)
        if(TARGET glfw)
            target_link_libraries(Project-Fluid PRIVATE glfw)
        else()
            target_link_libraries(Project-Fluid PRIVATE glfw3::glfw)
        endif()
        target_compile_definitions(Project-Fluid PRIVATE
            PROJECT_FLUID_SURFACE_SPV="${FLUID_SURFACE_SPV}"
            PROJECT_FLUID_PRESENT_SPV="${FLUID_PRESENT_SPV}"
        )
    else()
        message(STATUS "Project-Fluid window disabled: install Vulkan headers/loader, glslc and GLFW3. Project-Fluid-CPU remains available.")
    endif()
endif()

include(CTest)
if(BUILD_TESTING)
    add_test(NAME ProjectFluidCpuMirror COMMAND Project-Fluid-CPU)
endif()
