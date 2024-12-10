from fastapi import FastAPI
import logging
from database import init_db
import router
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.DEBUG)

# Initialize the database
init_db()



# FastAPI app initialization
app = FastAPI()


# ToDo: Add CORS when deploying to server to allow only UI origin

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include the router
app.include_router(router.router)



