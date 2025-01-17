from passlib.context import CryptContext
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from fastapi import HTTPException
from dotenv import load_dotenv
import os

load_dotenv()

SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
MAIL_FROM = os.getenv("MAIL_FROM", "noreply@yourdomain.com")

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Utility functions for password hashing
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def send_email(subject: str, recipient: str, body: str) -> None:
    """
    Sends an email using SendGrid.
    """
    message = Mail(
        from_email=MAIL_FROM,
        to_emails=recipient,
        subject=subject,
        html_content=body,
    )
    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        sg.send(message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email could not be sent: {str(e)}")
