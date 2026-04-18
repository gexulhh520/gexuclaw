from contextlib import asynccontextmanager

from fastapi import FastAPI

from .schemas import BrowserExecuteRequest, BrowserExecuteResponse, BrowserHealthResponse
from .service import BrowserServiceRuntime

runtime = BrowserServiceRuntime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await runtime.shutdown()


app = FastAPI(
    title="GexuLaw Browser Service",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=BrowserHealthResponse)
async def healthcheck():
    return {
        "status": "ok",
        "service": "browser-service",
    }


@app.post("/browser/execute", response_model=BrowserExecuteResponse)
async def execute_browser_operation(request: BrowserExecuteRequest):
    result = await runtime.execute(request.operation, request.args)
    return result.to_dict()
