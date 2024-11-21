

from fastapi import FastAPI, Depends, File, UploadFile, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import os
import json
from database import SessionLocal, init_db, User, Project,VerseFile
import logging
logging.basicConfig(level=logging.DEBUG)

# Initialize the database
init_db()

# FastAPI app initialization
app = FastAPI()

# Directory for extracted files
UPLOAD_DIR = "extracted_files"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Dependency to get the database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# JWT Configuration
SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

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

# Verify token and retrieve the current user
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        user = db.query(User).filter(User.user_id == user_id).first()
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


# Create User API
@app.post("/create-user/")
def create_user(username: str, password: str, db: Session = Depends(get_db)):
    hashed_password = get_password_hash(password)
    user = User(username=username, password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "User created successfully", "user_id": user.user_id}

# Login API
@app.post("/token/")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access_token = create_access_token(data={"sub": str(user.user_id)})
    return {"access_token": access_token, "token_type": "bearer"}





@app.post("/upload-zip/{owner_id}")
async def upload_zip(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        owner_id = current_user.user_id

        # Ensure the uploaded file is a ZIP file
        if not file.filename.endswith(".zip"):
            raise HTTPException(status_code=400, detail="Uploaded file is not a ZIP file")

        # Save the uploaded ZIP file temporarily
        zip_path = Path(UPLOAD_DIR) / file.filename.replace(" ", "_")
        with open(zip_path, "wb") as buffer:
            buffer.write(await file.read())

        # Extract the ZIP file
        extract_path = Path(UPLOAD_DIR) / zip_path.stem
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_path)

        # Remove the ZIP file after extraction
        os.remove(zip_path)

        # Search for metadata.json recursively
        metadata_path = None
        for root, dirs, files in os.walk(extract_path):
            if "metadata.json" in files:
                metadata_path = Path(root) / "metadata.json"
                break

        if not metadata_path:
            raise HTTPException(status_code=400, detail="metadata.json not found in the ZIP file")

        # Read metadata.json
        with open(metadata_path, "r", encoding="utf-8") as metadata_file:
            metadata_content = json.load(metadata_file)

        # Extract language field from metadata.json
        language_data = metadata_content.get("languages", [{}])[0]
        language = language_data.get("name", {}).get(language_data.get("tag", "unknown"), "unknown")


        # Convert the full metadata.json content back to a JSON string
        metadata_info = json.dumps(metadata_content)

        # Create a new project entry
        project = Project(
            name=zip_path.stem,
            owner_id=owner_id,
            language=language,
            metadata_info=metadata_info
        )
        db.add(project)
        db.commit()
        db.refresh(project)

        # Search for ingredients folder recursively
        ingredients_path = None
        for root, dirs, files in os.walk(extract_path):
            if "ingredients" in dirs:
                ingredients_path = Path(root) / "ingredients"
                break

        if not ingredients_path:
            raise HTTPException(status_code=400, detail="Ingredients folder not found in the ZIP file")

        logging.debug(f"Found ingredients folder: {ingredients_path}")

        # Process the folder structure for verses and files
        for book_dir in ingredients_path.iterdir():
            if book_dir.is_dir():
                book_id = book_dir.name.lower()  # e.g., 'MAT'
                logging.debug(f"Processing book directory: {book_id}")
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                        chapter = int(chapter_dir.name)  # e.g., '1'
                        logging.debug(f"Processing chapter directory: {chapter}")
                        for verse_file in chapter_dir.iterdir():
                            if verse_file.is_file() and "_" in verse_file.stem:
                                try:
                                    # Extract verse number from the filename
                                    verse = int(verse_file.stem.split("_")[1])  # e.g., '1_1.wav' → '1'
                                    logging.debug(f"Processing verse file: {verse_file.name} as verse {verse}")

                                    # Add to ProjectVerse table
                                    project_verse = VerseFile(
                                        project_id=project.project_id,
                                        book_id=book_id,
                                        chapter=chapter,
                                        verse=verse,
                                        name=verse_file.name,
                                        path=str(verse_file),  # Full path
                                        size=verse_file.stat().st_size,  # File size in bytes
                                        format=verse_file.suffix.lstrip(".")  # File extension (e.g., wav, mp3)
                                    )
                                    db.add(project_verse)
                                except (IndexError, ValueError):
                                    logging.warning(f"Invalid verse file format: {verse_file.name}")
                                    continue

        db.commit()

        return {
            "message": "ZIP file extracted, project and verses created successfully",
            "project_id": project.project_id,
        }

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="The file is not a valid ZIP archive")
    except Exception as e:
        logging.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
