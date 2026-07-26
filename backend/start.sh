#!/bin/bash
# Start supervisord to manage RQ workers and the FastAPI server
echo "Starting Supervisord..."
supervisord -c supervisord.conf
