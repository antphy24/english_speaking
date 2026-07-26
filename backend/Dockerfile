FROM python:3.12-slim

# Set working directory
WORKDIR /code

# Copy requirements first to leverage Docker cache
COPY requirements.txt /code/requirements.txt

# Install python dependencies
RUN pip install --no-cache-dir -r /code/requirements.txt

# Copy the rest of the backend files
COPY . /code

# Expose port (Hugging Face Spaces runs on 7860 by default)
EXPOSE 7860

# Copy the start script and make it executable
COPY start.sh /code/start.sh
RUN chmod +x /code/start.sh

# Run the start script which starts both the workers and FastAPI
CMD ["./start.sh"]
