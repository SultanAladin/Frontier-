CXX := g++
CXXFLAGS := -std=c++20 -O3 -Wall -Wextra -Werror -pedantic -DFRONTIER_DEVELOPMENT -pthread
INCLUDES := -I../.. -I.

GAME_SRCS := $(wildcard Source/*.cpp)
GAME_OBJS := $(GAME_SRCS:.cpp=.o)

ENGINE_DIR := ../..
ENGINE_OBJS := \
	$(ENGINE_DIR)/DeviceExchange/VulkanExchange.o \
	$(ENGINE_DIR)/DeviceExchange/ByteSpace.o \
	$(ENGINE_DIR)/DeviceExchange/TaskScheduler.o \
	$(ENGINE_DIR)/DeviceExchange/ExecutionQueue.o \
	$(ENGINE_DIR)/DeviceExchange/VendorClassifier.o \
	$(ENGINE_DIR)/DeviceExchange/OrientationClassifier.o \
	$(ENGINE_DIR)/DeviceExchange/WindowExchange.o \
	$(ENGINE_DIR)/DeviceExchange/InputExchange.o \
	$(ENGINE_DIR)/DeviceExchange/RenderTargetExchange.o \
	$(ENGINE_DIR)/DeviceExchange/DiagnosticMetrics.o \
	$(ENGINE_DIR)/PhysicalDynamics/RigidBodySolver.o \
	$(ENGINE_DIR)/PhysicalDynamics/DeformableSolver.o \
	$(ENGINE_DIR)/PhysicalDynamics/LocomotionSolver.o \
	$(ENGINE_DIR)/PhysicalDynamics/WorldSpace.o \
	$(ENGINE_DIR)/VolumetricDynamics/LevelSetSpace.o \
	$(ENGINE_DIR)/VolumetricDynamics/FluidSolver.o \
	$(ENGINE_DIR)/VolumetricDynamics/ParticleIntegrator.o \
	$(ENGINE_DIR)/GeometricRaster/GeometryStructure.o \
	$(ENGINE_DIR)/GeometricRaster/CameraProjection.o \
	$(ENGINE_DIR)/GeometricRaster/VisibilityProjection.o \
	$(ENGINE_DIR)/GeometricRaster/RasterSequence.o \
	$(ENGINE_DIR)/GeometricRaster/MaterialCodec.o \
	$(ENGINE_DIR)/PhotometricIllumination/ClusteredSpace.o \
	$(ENGINE_DIR)/PhotometricIllumination/DirectIlluminationIntegrator.o \
	$(ENGINE_DIR)/PhotometricIllumination/GlobalIlluminationIntegrator.o \
	$(ENGINE_DIR)/PhotometricIllumination/AtmosphereIntegrator.o \
	$(ENGINE_DIR)/PlatformInterchange/AcousticStructure.o \
	$(ENGINE_DIR)/PlatformInterchange/AcousticIntegrator.o \
	$(ENGINE_DIR)/PlatformInterchange/VoiceExchange.o \
	$(ENGINE_DIR)/PlatformInterchange/OnlineInterchange.o \
	$(ENGINE_DIR)/DisplayPresentation/ThemeStructure.o \
	$(ENGINE_DIR)/DisplayPresentation/VectorCodec.o \
	$(ENGINE_DIR)/DisplayPresentation/FontCodec.o \
	$(ENGINE_DIR)/DisplayPresentation/ControlCentrePanel.o \
	$(ENGINE_DIR)/DisplayPresentation/WorkspacePanel.o \
	$(ENGINE_DIR)/DisplayPresentation/CycleScheduler.o \
	$(ENGINE_DIR)/DisplayPresentation/FidelityClassifier.o \
	$(ENGINE_DIR)/DisplayPresentation/FrontierHost.o

TARGET := bin/Project-Zero

.PHONY: all clean run

all: $(TARGET)

$(TARGET): $(ENGINE_OBJS) $(GAME_OBJS)
	@mkdir -p bin
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^

#    -MMD -MP emits a .d sidecar listing every header each .cpp pulled in, and the include below feeds those
#    back to make. WITHOUT THIS a header-only change (adding a field to a struct, say) rebuilds nothing: the
#    stale .o files keep the OLD struct layout while the new ones use the new one, the link succeeds anyway,
#    and the program segfaults at run time on a corrupted object. That exact failure cost a debugging cycle
#    here — the crash looked like a logic bug in the precipitation solver and was purely a stale object file.
%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) -MMD -MP -c $< -o $@

$(ENGINE_DIR)/%.o: $(ENGINE_DIR)/%.cpp
	$(MAKE) -C $(ENGINE_DIR)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -rf $(GAME_OBJS) $(GAME_OBJS:.o=.d) bin/Project-Zero

-include $(GAME_OBJS:.o=.d)
