#!/usr/bin/env python3
#=============================================================================================================================================
# 📦 Frontier/Tools/ProjectConstruct.py — Standalone Game Project Scaffolding Generator
#=============================================================================================================================================

import os
import sys

def ScaffoldProject(projectName, destinationDir="Projects"):
    projectRoot = os.path.join(destinationDir, projectName)
    
    # Subfolder layout
    subfolders = [
        "Source",
        "Shaders",
        "Content/AudioArchives",
        "Content/FontArchives",
        "Content/GeometryArchives",
        "Content/GraphicArchives",
        "Content/ShaderArchives",
        "Content/LevelArchives",
        "Build"
    ]
    
    print(f"[Frontier Project Generator] Scaffolding Project: {projectName} -> {projectRoot}")
    
    for folder in subfolders:
        path = os.path.join(projectRoot, folder)
        os.makedirs(path, exist_ok=True)
        print(f"  + Created: {folder}")
        
    print(f"[Frontier Project Generator] Project {projectName} scaffolded successfully.")

if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "ConvergenceGTX"
    dest = sys.argv[2] if len(sys.argv) > 2 else "Projects"
    ScaffoldProject(name, dest)
