@echo off
echo Starting 8 RQ Workers for Load Testing...
for /L %%i in (1,1,8) do (
    start "RQ Worker %%i" cmd /k "python worker.py"
)
echo All workers started in separate windows!
