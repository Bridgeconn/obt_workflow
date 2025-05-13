
from database import SessionLocal
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Ensure the log folder exists
LOG_FOLDER = Path("../logs")  
LOG_FOLDER.mkdir(parents=True, exist_ok=True)

# Configure logging
def setup_logging():
    logger = logging.getLogger("fastapi_app")
    logger.setLevel(logging.INFO)

    # Rotating file handler for log rotation
    file_handler = RotatingFileHandler(
        filename=LOG_FOLDER / "app.log",  # Base log filename
        maxBytes=10_000_000,  # 10MB per file
        backupCount=19,  # Keep 19 backups (20 total files)
        encoding="utf-8",
    )

    # Formatter for logs
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    file_handler.setFormatter(formatter)

    # Stream handler for console output
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    # Add handlers to logger
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)

    return logger
 
logger = setup_logging()



# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()