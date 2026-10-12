# Project-Drive headless proofs. Frontier.exe remains the sole product windowed host.
.PHONY: all proof sanitize render run
all: proof
proof:
	python3 ../../Tools/Tests/CheckDriveDynamics.py
sanitize:
	python3 ../../Tools/Tests/CheckDriveDynamics.py --sanitize
render:
	python3 ../../Tools/Tests/RunDriveExhibit.py
run: proof render
