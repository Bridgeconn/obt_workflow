from fastapi import FastAPI
import logging
from database import init_db
import router
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)

# Initialize the database
init_db()



# FastAPI app initialization
app = FastAPI(version="1.0.4")


# ToDo: Add CORS when deploying to server to allow only UI origin

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","https://obt-workflow.vercel.app","https://dev-obt-workflow.vercel.app"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include the router
app.include_router(router.router)

@app.get("/")
async def root():
    return {"message": "AI OBT app is running successfully 🚀"}

