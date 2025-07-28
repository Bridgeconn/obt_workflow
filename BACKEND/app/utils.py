from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
from fastapi import FastAPI, APIRouter, Depends, HTTPException
from pydantic import EmailStr
from sqlalchemy.orm import Session
from passlib.context import CryptContext
import os
import logging
from dotenv import load_dotenv
load_dotenv()

# Configure logging
logger = logging.getLogger("fastapi_app")

# # --- Configure your SMTP mail server ---
# conf = ConnectionConfig(
#     MAIL_USERNAME="aiobt@bridgeconn.in",
#     MAIL_PASSWORD="WakeCake97!",
#     MAIL_FROM="aiobt@bridgeconn.in",
#     MAIL_PORT=587,  # Using port 587 for STARTTLS
#     MAIL_SERVER="mailcow.bridgeconn.in",
#     MAIL_FROM_NAME="AIOBT",
#     MAIL_STARTTLS=True,   # True for 587 (STARTTLS)
#     MAIL_SSL_TLS=False,   # False for 587, True for 465
#     USE_CREDENTIALS=True,
#     VALIDATE_CERTS=True,
#     TIMEOUT=60  # Add timeout setting
# )

conf = ConnectionConfig(
    MAIL_USERNAME = os.getenv("MAIL_USERNAME"),
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD"),
    MAIL_FROM = os.getenv("MAIL_FROM"),
    MAIL_PORT = int(os.getenv("MAIL_PORT", 587)),
    MAIL_SERVER = os.getenv("MAIL_SERVER"),
    MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME"),
    MAIL_STARTTLS = os.getenv("MAIL_STARTTLS", "True") == "True",
    MAIL_SSL_TLS = os.getenv("MAIL_SSL_TLS", "False") == "True",
    USE_CREDENTIALS = os.getenv("USE_CREDENTIALS", "True") == "True",
    VALIDATE_CERTS = os.getenv("VALIDATE_CERTS", "True") == "True",
    TIMEOUT = int(os.getenv("TIMEOUT", 60)),
)

# --- Password hashing context ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

async def send_email(subject: str, recipient: str, body: str) -> None:
    """Send email with proper error handling"""
    try:
        message = MessageSchema(
            subject=subject,
            recipients=[recipient],
            body=body,
            subtype="html"
        )
        fm = FastMail(conf)
        await fm.send_message(message)
        logger.info(f"Email sent successfully to {recipient}")
        
    except Exception as e:
        logger.error(f"Failed to send email to {recipient}: {str(e)}")
        raise Exception(f"Email sending failed: {str(e)}")

