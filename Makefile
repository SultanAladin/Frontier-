#============================================================================================================================================
# 📦 Frontier/Makefile — High-Performance Cross-Platform Compilation for Linux
#============================================================================================================================================

include BuildConfiguration/LinuxConfiguration.mk

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
