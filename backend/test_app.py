from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
app = FastAPI()
@app.options("/headers-test")
async def test(request: Request):
    return JSONResponse(dict(request.headers))
