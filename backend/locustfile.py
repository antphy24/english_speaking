import time
import uuid
import json
import base64
from locust import HttpUser, task, between

class AudioUploadUser(HttpUser):
    # Wait between 6 and 10 seconds between tasks. 
    # This ensures simulated users stay within the 10 requests/minute rate limit.
    wait_time = between(6, 10)

    def on_start(self):
        """
        Executed when a simulated user starts.
        We generate a unique user UUID and a mock JWT to bypass rate limiting based on user ID.
        """
        self.user_uuid = str(uuid.uuid4())
        
        # Create a mock JWT token.
        # Format: header.payload.signature
        header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode('utf-8').rstrip('=')
        payload = base64.urlsafe_b64encode(json.dumps({"sub": self.user_uuid}).encode('utf-8')).decode('utf-8').rstrip('=')
        mock_signature = "mock_signature"
        self.token = f"{header}.{payload}.{mock_signature}"
        
        # Set the default headers for all requests made by this user
        self.client.headers.update({"Authorization": f"Bearer {self.token}"})

    @task
    def submit_and_poll_audio(self):
        """
        Task to submit a dummy audio file and poll for its completion.
        """
        # Create a dummy WAV file in memory (44 bytes standard header + 2500 bytes of silence)
        dummy_wav_content = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00' + b'\x00' * 2500
        files = {
            'file': ('dummy.wav', dummy_wav_content, 'audio/wav')
        }
        
        # 1. POST to /transcribe
        with self.client.post("/transcribe", files=files, catch_response=True) as response:
            if response.status_code != 200:
                response.failure(f"Failed to submit audio. Status code: {response.status_code}")
                return
            
            try:
                data = response.json()
                job_id = data.get("job_id")
                if not job_id:
                    response.failure("No job_id returned in response")
                    return
            except json.JSONDecodeError:
                response.failure("Response was not valid JSON")
                return
                
        # 2. Polling loop
        max_attempts = 60
        attempts = 0
        
        while attempts < max_attempts:
            time.sleep(2.5)
            attempts += 1
            
            # Use name="/job/[job_id]" to group all polling metrics in Locust UI
            with self.client.get(f"/job/{job_id}", name="/job/[job_id]", catch_response=True) as poll_response:
                if poll_response.status_code != 200:
                    poll_response.failure(f"Failed to poll job. Status code: {poll_response.status_code}")
                    return
                
                try:
                    poll_data = poll_response.json()
                    status = poll_data.get("status")
                    
                    if status == "completed":
                        # Mark this poll request as successful and break the loop
                        poll_response.success()
                        return
                    elif status == "failed":
                        # Mark this poll request as failed and break the loop
                        poll_response.failure(f"Job failed for job_id: {job_id}")
                        return
                    elif status in ["queued", "started"]:
                        # The job is still processing. Mark this individual poll request as successful.
                        poll_response.success()
                    else:
                        poll_response.failure(f"Unknown status '{status}' for job_id: {job_id}")
                        return
                        
                except json.JSONDecodeError:
                    poll_response.failure("Poll response was not valid JSON")
                    return
                    
        # If we reach here, we exceeded max attempts. Log a custom failure event.
        self.environment.events.request.fire(
            request_type="GET",
            name="/job/[job_id] (timeout)",
            response_time=0,
            response_length=0,
            exception=TimeoutError(f"Job polling timed out after {max_attempts} attempts for job_id: {job_id}"),
        )
