FROM python:3.12-slim

# Local Redis server (free, runs inside the same container; see supervisord.conf)
RUN apt-get update \
    && apt-get install -y --no-install-recommends redis-server \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /code

# Copy requirements first to leverage Docker cache
COPY requirements.txt /code/requirements.txt

# Install python dependencies
RUN pip install --no-cache-dir -r /code/requirements.txt

# Backup transcriber: download the open-source Whisper model at build time so the
# first student does not wait for a download (used when Groq's free quota runs out).
ENV LOCAL_WHISPER_DIR=/models
RUN mkdir -p /models \
    && python -c "from faster_whisper import WhisperModel; WhisperModel('base.en', device='cpu', compute_type='int8', download_root='/models')" \
    && chmod -R 777 /models

# Copy the rest of the backend files
COPY . /code

# Hugging Face Spaces runs the container as a non-root user; make /code writable
RUN chmod -R 777 /code

# Expose port (Hugging Face Spaces runs on 7860 by default)
EXPOSE 7860

RUN chmod +x /code/start.sh

# Run the start script which starts Redis, the workers and FastAPI
CMD ["./start.sh"]
