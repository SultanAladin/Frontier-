#============================================================================================================================================
# 📦 Frontier/Makefile — High-Performance Cross-Platform Compilation for Linux
#============================================================================================================================================

CXX := g++
CXXFLAGS := -std=c++20 -O3 -Wall -Wextra -Werror -pedantic -DFRONTIER_DEVELOPMENT -pthread
INCLUDES := -I.

SRCS := \
	Layer0_DeviceExchange/VulkanExchange.cpp \
	Layer0_DeviceExchange/ByteSpace.cpp \
	Layer0_DeviceExchange/TaskScheduler.cpp \
	Layer0_DeviceExchange/ExecutionQueue.cpp \
	Layer0_DeviceExchange/VendorClassifier.cpp \
	Layer0_DeviceExchange/OrientationClassifier.cpp \
	Layer1_PhysicalDynamics/RigidBodySolver.cpp \
	Layer1_PhysicalDynamics/DeformableSolver.cpp \
	Layer1_PhysicalDynamics/LocomotionSolver.cpp \
	Layer2_VolumetricDynamics/LevelSetSpace.cpp \
	Layer2_VolumetricDynamics/FluidSolver.cpp \
	Layer2_VolumetricDynamics/ParticleIntegrator.cpp \
	Layer3_GeometricRaster/GeometryStructure.cpp \
	Layer3_GeometricRaster/VisibilityProjection.cpp \
	Layer3_GeometricRaster/RasterSequence.cpp \
	Layer3_GeometricRaster/MaterialCodec.cpp \
	Layer4_PhotometricIllumination/ClusteredSpace.cpp \
	Layer4_PhotometricIllumination/DirectIlluminationIntegrator.cpp \
	Layer4_PhotometricIllumination/GlobalIlluminationIntegrator.cpp \
	Layer4_PhotometricIllumination/AtmosphereIntegrator.cpp \
	Layer5_PlatformInterchange/AcousticStructure.cpp \
	Layer5_PlatformInterchange/AcousticIntegrator.cpp \
	Layer5_PlatformInterchange/VoiceExchange.cpp \
	Layer5_PlatformInterchange/OnlineInterchange.cpp \
	Layer6_DisplayPresentation/WorkspacePanel.cpp \
	Layer6_DisplayPresentation/CycleScheduler.cpp \
	Layer6_DisplayPresentation/FrontierHost.cpp \
	Layer6_DisplayPresentation/Main.cpp

OBJS := $(SRCS:.cpp=.o)
TARGET := bin/FrontierEngine

.PHONY: all clean run

all: $(TARGET)

$(TARGET): $(OBJS)
	@mkdir -p bin
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^

%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $< -o $@

run: $(TARGET)
	./$(TARGET)

clean:
	rm -rf $(OBJS) bin/FrontierEngine
