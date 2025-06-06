
from fastapi import FastAPI, Depends, File,  HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import  User
import dependency
from fastapi import  Depends, HTTPException



# JWT Configuration
SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


# Utility functions for password hashing
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

# Utility function for creating JWT tokens
def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_reset_token(email: str, expires_delta: timedelta = None) -> str:
    """
    Generate a password reset token with the user's email encoded.
    """
    to_encode = {"sub": email}
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))  # Token valid for 15 minutes
    to_encode.update({"exp": expire})
    reset_token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return reset_token

def verify_reset_token(token: str) -> str:
    """
    Decode and validate the password reset token.
    Returns the email if the token is valid.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=400, detail="Invalid token")
        return email
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=400, detail="Invalid token")


def get_current_user(
    token: str = Depends(oauth2_scheme), 
    db: Session = Depends(dependency.get_db)
) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = int(payload.get("sub"))
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = db.query(User).filter(User.user_id == user_id).first()
        if not user or user.token != token:  # Ensure token matches
            raise HTTPException(status_code=401, detail="Invalid user or token")

        if not user.active:
            raise HTTPException(status_code=401, detail="Inactive user")    
        
        # check if token is expired 
        if datetime.utcnow() > user.last_login + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES):
            raise HTTPException(status_code=401, detail="Token expired")

        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")