@echo off
rem NX Studio Code - safe graphics launcher (old GPUs / broken or missing drivers).
rem Disables GPU acceleration and GPU compositing. Slower, but starts on very old graphics hardware.
setlocal
"%~dp0..\@@NAME@@.exe" --disable-gpu --disable-gpu-compositing %*
endlocal
