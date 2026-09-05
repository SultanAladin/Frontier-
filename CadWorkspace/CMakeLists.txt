#=============================================================================================================================================
# CadWorkspace/CMakeLists.txt — Standalone CAD editor: kernel, interaction, presentation (software + Vulkan), console host
#   Builds with no engine dependency and no external packages. Linux: cmake -B build -G Ninja && cmake --build build && ctest --test-dir build
#=============================================================================================================================================

cmake_minimum_required(VERSION 3.20)
project(CadWorkspace LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

if(MSVC)
    add_compile_options(/W4 /WX /permissive- /utf-8)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Werror -Wno-unused-function)
endif()

# ─── Kernel: pure geometry, zero dependencies ───────────────────────────────────────────────────────────────────────────────────────────────
add_library(CadKernel STATIC
    Kernel/CurveSpecification.cpp
    Kernel/SurfaceSpecification.cpp
)
target_include_directories(CadKernel PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# ─── Verification: console proofs, one executable per phase, registered with ctest ──────────────────────────────────────────────────────────
enable_testing()

add_executable(KernelVerification Verification/KernelVerification.cpp)
target_link_libraries(KernelVerification PRIVATE CadKernel)
add_test(NAME KernelVerification COMMAND KernelVerification)
