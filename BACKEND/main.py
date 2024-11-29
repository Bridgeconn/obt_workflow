from fastapi import FastAPI
import logging
from database import init_db
import router

logging.basicConfig(level=logging.DEBUG)

# Initialize the database
init_db()

# FastAPI app initialization
app = FastAPI()

# Include the router
app.include_router(router.router)



