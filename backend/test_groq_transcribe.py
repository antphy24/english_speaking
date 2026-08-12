from utils.ai import transcribe_audio_bytes
import urllib.request

# Download a tiny valid sample audio (1 second beep or something)
url = "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
urllib.request.urlretrieve(url, "beep.ogg")

with open("beep.ogg", "rb") as f:
    audio_bytes = f.read()

try:
    text = transcribe_audio_bytes(audio_bytes, "beep.ogg")
    print("Success! Transcript:", text)
except Exception as e:
    import traceback
    traceback.print_exc()

