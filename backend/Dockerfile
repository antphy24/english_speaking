FROM python:3.9-slim

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

# Run FastAPI application
CMD ["python", "main.py"]
