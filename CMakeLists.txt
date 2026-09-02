#============================================================================================================================================
# 📦 Frontier/CMakeLists.txt — Cross-Platform CMake Configuration for Windows (MSVC) & Linux (GCC/Clang)
#============================================================================================================================================

cmake_minimum_required(VERSION 3.20)
project(FrontierEngine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Platform-specific compiler configurations
if(MSVC)
    add_compile_options(/W4 /WX /permissive- /Zc:preprocessor /MD$<$<CONFIG:Debug>:d>)
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS NOMINMAX WIN32_LEAN_AND_MEAN)
else()
    add_compile_options(-Wall -Wextra -Werror -pedantic)
endif()

add_compile_definitions(FRONTIER_DEVELOPMENT)

set(FRONTIER_SOURCES
    Layer0_DeviceExchange/VulkanExchange.h
    Layer0_DeviceExchange/VulkanExchange.cpp
    Layer0_DeviceExchange/ByteSpace.h
    Layer0_DeviceExchange/ByteSpace.cpp
    Layer0_DeviceExchange/TaskScheduler.h
    Layer0_DeviceExchange/TaskScheduler.cpp
    Layer0_DeviceExchange/ExecutionQueue.h
    Layer0_DeviceExchange/ExecutionQueue.cpp
    Layer0_DeviceExchange/VendorClassifier.h
    Layer0_DeviceExchange/VendorClassifier.cpp
    Layer0_DeviceExchange/OrientationClassifier.h
    Layer0_DeviceExchange/OrientationClassifier.cpp

    Layer1_PhysicalDynamics/RigidBodyStructure.h
    Layer1_PhysicalDynamics/RigidBodySolver.h
    Layer1_PhysicalDynamics/RigidBodySolver.cpp
    Layer1_PhysicalDynamics/DeformableStructure.h
    Layer1_PhysicalDynamics/DeformableSolver.h
    Layer1_PhysicalDynamics/DeformableSolver.cpp
    Layer1_PhysicalDynamics/LocomotionSolver.h
    Layer1_PhysicalDynamics/LocomotionSolver.cpp

    Layer2_VolumetricDynamics/LevelSetSpace.h
    Layer2_VolumetricDynamics/LevelSetSpace.cpp
    Layer2_VolumetricDynamics/FluidSolver.h
    Layer2_VolumetricDynamics/FluidSolver.cpp
    Layer2_VolumetricDynamics/ParticleStructure.h
    Layer2_VolumetricDynamics/ParticleIntegrator.h
    Layer2_VolumetricDynamics/ParticleIntegrator.cpp

    Layer3_GeometricRaster/GeometryStructure.h
    Layer3_GeometricRaster/GeometryStructure.cpp
    Layer3_GeometricRaster/VisibilityProjection.h
    Layer3_GeometricRaster/VisibilityProjection.cpp
    Layer3_GeometricRaster/RasterSequence.h
    Layer3_GeometricRaster/RasterSequence.cpp
    Layer3_GeometricRaster/MaterialCodec.h
    Layer3_GeometricRaster/MaterialCodec.cpp

    Layer4_PhotometricIllumination/ClusteredSpace.h
    Layer4_PhotometricIllumination/ClusteredSpace.cpp
    Layer4_PhotometricIllumination/DirectIlluminationIntegrator.h
    Layer4_PhotometricIllumination/DirectIlluminationIntegrator.cpp
    Layer4_PhotometricIllumination/GlobalIlluminationIntegrator.h
    Layer4_PhotometricIllumination/GlobalIlluminationIntegrator.cpp
    Layer4_PhotometricIllumination/AtmosphereIntegrator.h
    Layer4_PhotometricIllumination/AtmosphereIntegrator.cpp

    Layer5_PlatformInterchange/AcousticStructure.h
    Layer5_PlatformInterchange/AcousticStructure.cpp
    Layer5_PlatformInterchange/AcousticIntegrator.h
    Layer5_PlatformInterchange/AcousticIntegrator.cpp
    Layer5_PlatformInterchange/VoiceExchange.h
    Layer5_PlatformInterchange/VoiceExchange.cpp
    Layer5_PlatformInterchange/OnlineInterchange.h
    Layer5_PlatformInterchange/OnlineInterchange.cpp

    Layer6_DisplayPresentation/WorkspacePanel.h
    Layer6_DisplayPresentation/WorkspacePanel.cpp
    Layer6_DisplayPresentation/CycleScheduler.h
    Layer6_DisplayPresentation/CycleScheduler.cpp
    Layer6_DisplayPresentation/FrontierHost.h
    Layer6_DisplayPresentation/FrontierHost.cpp
    Layer6_DisplayPresentation/Main.cpp
)

add_executable(FrontierEngine ${FRONTIER_SOURCES})
target_include_directories(FrontierEngine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

if(NOT MSVC)
    target_link_libraries(FrontierEngine PRIVATE pthread)
endif()
