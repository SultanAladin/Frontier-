#=============================================================================================================================================
# Editor/AuthoringTools/Modelling/SolidArc/CMakeLists.txt
# SolidArc — standalone C++20 CAD / NURBS / B-rep modelling tool.
#
# This folder is intentionally editor-authoring code, not Project-Zero runtime code. It can be built standalone:
#   cmake -S Editor/AuthoringTools/Modelling/SolidArc -B build-solidarc
#   cmake --build build-solidarc --target SolidArc
#=============================================================================================================================================

cmake_minimum_required(VERSION 3.20)
project(SolidArc LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

option(SOLIDARC_BUILD_VERIFICATION "Build SolidArc's C++ verification executables" ON)
option(SOLIDARC_BUILD_VULKAN_APP "Build the standalone GLFW + Vulkan SolidArc editor" OFF)

add_library(SolidArcKernel STATIC
    Kernel/CurveSpecification.cpp
    Kernel/SurfaceSpecification.cpp
    Kernel/TopologySpecification.cpp
    Kernel/SkinSolver.cpp
    Kernel/IntersectionSolver.cpp
    Kernel/FairPatchSolver.cpp
    Kernel/ProfileSolver.cpp
    Kernel/ConstraintSolver.cpp
    Kernel/ConstraintGraph.cpp
    Kernel/MirrorSolver.cpp
    Kernel/BlendSolver.cpp
)
target_include_directories(SolidArcKernel PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

add_library(SolidArcPresentation STATIC
    Presentation/SoftwareRaster.cpp
    Presentation/ScenePresentation.cpp
    Interaction/CameraProjection.cpp
    Interaction/SnapResolution.cpp
    Interaction/InputEvent.cpp
    Interaction/HotkeyChart.cpp
    Interaction/ToolSession.cpp
    Interaction/TransformGizmo.cpp
)
target_link_libraries(SolidArcPresentation PUBLIC SolidArcKernel)
target_include_directories(SolidArcPresentation PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/Presentation)
target_compile_definitions(SolidArcPresentation PUBLIC SOLIDARC_PROOF_FOLDER="${CMAKE_CURRENT_BINARY_DIR}/Proofs")

add_library(SolidArcConsoleKit STATIC
    Document/SceneDocument.cpp
    Document/FigureRecipe.cpp
    Document/UndoSequence.cpp
    Console/CommandCodec.cpp
    Console/ConsoleHost.cpp
    Console/ConsoleInteraction.cpp
    Console/ConsoleSelection.cpp
)
target_link_libraries(SolidArcConsoleKit PUBLIC SolidArcPresentation)
target_include_directories(SolidArcConsoleKit PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

set(FRONTIER_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../..")
add_library(SolidArcEditorModel STATIC
    Editor/SolidArcOutlinerAdapter.cpp
)
target_link_libraries(SolidArcEditorModel PUBLIC SolidArcConsoleKit)
target_include_directories(SolidArcEditorModel PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} "${FRONTIER_REPO_ROOT}")

add_executable(SolidArc Console/SolidArcConsole.cpp)
target_link_libraries(SolidArc PRIVATE SolidArcConsoleKit)

foreach(Target SolidArcKernel SolidArcPresentation SolidArcConsoleKit SolidArcEditorModel SolidArc)
    if(MSVC)
        target_compile_options(${Target} PRIVATE /W4 /permissive- /utf-8)
        target_compile_definitions(${Target} PRIVATE NOMINMAX)
    else()
        target_compile_options(${Target} PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
    endif()
endforeach()

set(SOLIDARC_IMGUI_ROOT "${FRONTIER_REPO_ROOT}/ExternalPackages/imgui")
if(EXISTS "${SOLIDARC_IMGUI_ROOT}/imgui.h")
    add_library(SolidArcEditorUi STATIC
        Editor/SolidArcEditorHost.cpp
        "${FRONTIER_REPO_ROOT}/Engine/Editor/ControlPanel.cpp"
        "${FRONTIER_REPO_ROOT}/Engine/Editor/OutlinerPanel.cpp"
        "${FRONTIER_REPO_ROOT}/Engine/Editor/ViewportPanel.cpp"
        "${FRONTIER_REPO_ROOT}/Engine/Editor/InspectorPanel.cpp"
    )
    target_link_libraries(SolidArcEditorUi PUBLIC SolidArcEditorModel)
    target_include_directories(SolidArcEditorUi PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        "${FRONTIER_REPO_ROOT}"
        "${FRONTIER_REPO_ROOT}/Engine/Editor"
        "${SOLIDARC_IMGUI_ROOT}")
    if(MSVC)
        target_compile_options(SolidArcEditorUi PRIVATE /W4 /permissive- /utf-8)
        target_compile_definitions(SolidArcEditorUi PRIVATE NOMINMAX FRONTIER_DEVELOPMENT)
    else()
        target_compile_options(SolidArcEditorUi PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
        target_compile_definitions(SolidArcEditorUi PRIVATE FRONTIER_DEVELOPMENT)
    endif()
endif()

if(SOLIDARC_BUILD_VULKAN_APP)
    find_package(Vulkan REQUIRED)
    set(SOLIDARC_GLFW_ROOT "${FRONTIER_REPO_ROOT}/ExternalPackages/glfw")
    if(EXISTS "${SOLIDARC_GLFW_ROOT}/CMakeLists.txt")
        set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
        set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
        add_subdirectory("${SOLIDARC_GLFW_ROOT}" "${CMAKE_CURRENT_BINARY_DIR}/solidarc-glfw" EXCLUDE_FROM_ALL)
        set(SOLIDARC_GLFW_TARGET glfw)
    else()
        find_package(glfw3 3.3 CONFIG REQUIRED)
        if(TARGET glfw)
            set(SOLIDARC_GLFW_TARGET glfw)
        elseif(TARGET glfw3::glfw)
            set(SOLIDARC_GLFW_TARGET glfw3::glfw)
        else()
            message(FATAL_ERROR "glfw3 was found but exported neither glfw nor glfw3::glfw")
        endif()
    endif()

    if(NOT EXISTS "${SOLIDARC_IMGUI_ROOT}/imgui.cpp" OR NOT EXISTS "${SOLIDARC_IMGUI_ROOT}/backends/imgui_impl_vulkan.cpp")
        message(FATAL_ERROR "ImGui is required. Run: python Tools/Bootstrap.py --package imgui")
    endif()
    add_library(SolidArcImGuiVulkan STATIC
        "${SOLIDARC_IMGUI_ROOT}/imgui.cpp"
        "${SOLIDARC_IMGUI_ROOT}/imgui_draw.cpp"
        "${SOLIDARC_IMGUI_ROOT}/imgui_tables.cpp"
        "${SOLIDARC_IMGUI_ROOT}/imgui_widgets.cpp"
        "${SOLIDARC_IMGUI_ROOT}/backends/imgui_impl_glfw.cpp"
        "${SOLIDARC_IMGUI_ROOT}/backends/imgui_impl_vulkan.cpp"
    )
    target_include_directories(SolidArcImGuiVulkan PUBLIC
        "${SOLIDARC_IMGUI_ROOT}"
        "${SOLIDARC_IMGUI_ROOT}/backends")
    target_compile_definitions(SolidArcImGuiVulkan PRIVATE GLFW_INCLUDE_NONE)
    target_link_libraries(SolidArcImGuiVulkan PUBLIC ${SOLIDARC_GLFW_TARGET} Vulkan::Vulkan)

    add_executable(SolidArcVulkan "${FRONTIER_REPO_ROOT}/Tools/Build/SolidArcVulkan.cpp")
    target_include_directories(SolidArcVulkan PRIVATE "${FRONTIER_REPO_ROOT}")
    target_link_libraries(SolidArcVulkan PRIVATE SolidArcConsoleKit SolidArcImGuiVulkan)
    if(MSVC)
        target_compile_options(SolidArcVulkan PRIVATE /W4 /permissive- /utf-8)
        target_compile_definitions(SolidArcVulkan PRIVATE NOMINMAX)
        target_compile_options(SolidArcImGuiVulkan PRIVATE /W0 /utf-8)
    else()
        target_compile_options(SolidArcVulkan PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
        target_compile_options(SolidArcImGuiVulkan PRIVATE -w)
    endif()
endif()

if(SOLIDARC_BUILD_VERIFICATION)
    enable_testing()
    file(GLOB SOLIDARC_VERIFICATION_SOURCES CONFIGURE_DEPENDS Verification/*Verification.cpp)
    list(SORT SOLIDARC_VERIFICATION_SOURCES)
    set(SOLIDARC_VERIFICATION_TARGETS)
    foreach(VerificationSource IN LISTS SOLIDARC_VERIFICATION_SOURCES)
        get_filename_component(VerificationName "${VerificationSource}" NAME_WE)
        add_executable(${VerificationName} "${VerificationSource}")
        target_link_libraries(${VerificationName} PRIVATE SolidArcConsoleKit)
        if(MSVC)
            target_compile_options(${VerificationName} PRIVATE /W4 /permissive- /utf-8)
            target_compile_definitions(${VerificationName} PRIVATE NOMINMAX)
        else()
            target_compile_options(${VerificationName} PRIVATE -Wall -Wextra -Wpedantic -Wno-unused-function)
        endif()
        list(APPEND SOLIDARC_VERIFICATION_TARGETS ${VerificationName})
        add_test(NAME ${VerificationName} COMMAND ${VerificationName})
    endforeach()
    add_custom_target(SolidArcVerification DEPENDS ${SOLIDARC_VERIFICATION_TARGETS})
endif()
