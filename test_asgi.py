import asyncio
import sys
sys.path.append('.')
from backend.main import app

async def test():
    scope = {
        "type": "http",
        "method": "OPTIONS",
        "headers": [
            (b"origin", b"https://hrefspeak.vercel.app"),
            (b"access-control-request-method", b"GET"),
            (b"access-control-request-private-network", b"true"),
        ]
    }
    
    async def receive():
        return {"type": "http.request"}
        
    async def send(message):
        print("MESSAGE:", message)

    await app(scope, receive, send)

asyncio.run(test())
