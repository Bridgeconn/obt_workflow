from typing import Optional
from fastapi import Depends, File, UploadFile, HTTPException, APIRouter, Query
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import os
import re
import json
from database import User, Project, Verse, Chapter, Job, Book
# import logging
from fastapi import BackgroundTasks
import auth
import dependency
import crud
from fastapi.responses import StreamingResponse
import subprocess
import tempfile
import shutil
import datetime
from pydantic import EmailStr
from dotenv import load_dotenv
from dependency import logger, LOG_FOLDER
from crud import call_stt_api, call_tts_api
from utils import send_email

load_dotenv()

# logging.basicConfig(level=logging.INFO)


BASE_DIRECTORY = os.getenv("BASE_DIRECTORY")
FRONTEND_URL = os.getenv("FRONTEND_URL")

# Regex pattern for valid verse file formats (ignores extension)
VALID_VERSE_PATTERN = re.compile(r"^\d+_\d+(?:_\d+)?(?:_default)?$")

# Raise an error if the environment variable is not set
if not BASE_DIRECTORY:
    raise ValueError("The environment variable 'BASE_DIRECTORY' is not set.")

# Convert the base directory to a Path object
BASE_DIR = Path(BASE_DIRECTORY)
router = APIRouter()

# UPLOAD_DIR = "Input"
# os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/admin/logs", tags=["Admin"])
async def get_logs(current_user: dict = Depends(auth.get_current_user)):
    """
    Return the main log file. Restricted to admin users.
    """
    logger.info(f"Admin log request initiated by user: {current_user.username}")    
    if current_user.role != "Admin":
        logger.warning(f"Unauthorized access attempt by user: {current_user.username}")
        raise HTTPException(status_code=403, detail="Access denied")
    log_file_path = LOG_FOLDER / "app.log"
    if not log_file_path.exists():
        logger.error("Log file not found")
        raise HTTPException(status_code=404, detail="Log file not found")
    logger.info("Returning log file to admin")
    return FileResponse(log_file_path, media_type="text/plain", filename="app.log")




# Create User API
@router.post("/user/signup/", tags=["User"])
def user_signup(
    username: str,
    password: str,
    email: EmailStr,
    db: Session = Depends(dependency.get_db),
):
    logger.info(f"Signup request initiated for username: {username}, email: {email}")
    # Validate input fields
    if not username or not email or not password:
        logger.error("Signup failed: Missing fields")
        raise HTTPException(
            status_code=400,
            detail="All fields (username, email, password) are required.",
        )
    # Check if the username already exists
    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        logger.warning(f"Signup failed: Username '{username}' already exists")
        raise HTTPException(
            status_code=400,
            detail=f"Username '{username}' already exists. Please choose a different username.",
        )
    # Check if the email already exists
    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        logger.warning(f"Signup failed: Email '{email}' already exists")
        raise HTTPException(
            status_code=400,
            detail=f"Email '{email}' already exists. Please use a different email.",
        )
    # Hash the password and create the user
    hashed_password = auth.get_password_hash(password)
    new_user = User(username=username, email=email, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    logger.info(f"User created successfully: {username}")
    return {"message": "User created successfully", "user_id": new_user.user_id}


@router.put("/user/updatePassword/", tags=["User"])
async def update_password(
    current_password: str,
    new_password: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Change the password for the logged-in user.
    """
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify current password
    if not auth.verify_password(current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Update to the new password
    user.hashed_password = auth.get_password_hash(new_password)
    db.commit()
    db.refresh(user)
    return {"message": "Password updated successfully"}


@router.post("/token", tags=["User"])
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(dependency.get_db),
):
    logger.info(f"Login attempt for username: {form_data.username}")
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        logger.warning(f"Login failed for username: {form_data.username}")
        raise HTTPException(status_code=401, detail="Invalid username or password")
    # Generate access token
    access_token = auth.create_access_token(data={"sub": str(user.user_id)})
    # Update user record with token and last login time
    user.token = access_token
    user.last_login = datetime.datetime.utcnow()
    db.commit()
    db.refresh(user)
    logger.info(f"Login successful for username: {form_data.username}")
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "message": "Login successful",
    }
    
    
@router.post("/user/forgot_password/", tags=["User"])
async def forgot_password(email: EmailStr, db: Session = Depends(dependency.get_db)):
    """
    Generate a password reset link and send it to the user's email using SendGrid.
    """
    logger.info(f"Forgot password request initiated for email: {email}")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        logger.warning(f"Forgot password failed: Email '{email}' not found")
        raise HTTPException(status_code=404, detail="Email not registered")

    # Generate reset token
    reset_token = auth.create_reset_token(email)
    reset_link = f"{FRONTEND_URL}/reset-password?token={reset_token}"

    # Email body
    email_body = f"""
        <html>
        <body>
            <h4>Hello {user.username},</h4>
            <p>We received a request to reset your password. You can reset your password by clicking the link below:</p>
            
            <p><strong><a href="{reset_link}">Reset Password</a></strong></p>
            
            <p>Alternatively, you can copy and paste this link into your browser:</p>
            
            <blockquote>{reset_link}</blockquote>

            <p>If you didn’t request a password reset, please ignore this email.</p>
            
            <footer>
                <small>If you need help, please reach out to our support team.</small>
            </footer>
        </body>
        </html>
    """

    # Send the email
    send_email(
        subject="Password Reset Request",
        recipient=email,
        body=email_body,
    )

    logger.info(f"Password reset email sent to {email}")
    return {"message": "Password reset email sent successfully"}

@router.post("/user/reset_password/", tags=["User"])
async def reset_password(
    token: str,
    new_password: str,
    db: Session = Depends(dependency.get_db),
):
    """
    Reset the user's password using the reset token.
    """
    logger.info("Password reset request initiated")
    email = auth.verify_reset_token(token)
    if not email:
        logger.error("Password reset failed: Invalid or expired token")
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        logger.error(f"Password reset failed: User not found for email {email}")
        raise HTTPException(status_code=404, detail="User not found")

    # Update the password
    user.hashed_password = auth.get_password_hash(new_password)
    db.commit()
    db.refresh(user)

    logger.info(f"Password successfully reset for user: {email}")
    return {"message": "Password reset successfully"}



@router.post("/user/logout/", tags=["User"])
async def logout(
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Logout the user by removing the token from the database.
    """
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Remove the token from the database
    user.token = None
    db.commit()
    return {"message": "Successfully logged out"}


@router.get("/user/", tags=["User"])
async def get_user_details(
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Fetch the details of the currently logged-in user.
    """
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "user_id": user.user_id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "last_login": user.last_login,
        "created_date": user.created_date,
    }


# Users Details (Only Admin)
@router.get("/users/", tags=["User"])
async def get_all_users(
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Fetch the details of all users. Only accessible by Admins.
    """
    # Ensure the current user is an Admin
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=403, detail="Only admins can access this endpoint"
        )
    # Fetch all users
    users = db.query(User).all()

    # Format the response
    users_data = [
        {
            "user_id": user.user_id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "last_login": user.last_login,
            "token": user.token,
            "active": user.active,
            "created_date": user.created_date,
        }
        for user in users
    ]

    return users_data


@router.put("/user/", tags=["User"])
async def update_user(
    user_id: int,
    role: Optional[str] = None,
    active: Optional[bool] = True,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the role or status of a user.
    Only users with the 'Admin' role can perform this action.
    """
    # Ensure the current user has an Admin role
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can update user data")
    
    # if not role or not active:
    #     raise HTTPException(status_code=400, detail="Both role and active status must be provided")

    # Fetch the user whose role is to be updated
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update the role
    if(role!= None):
        valid_roles = ["Admin", "AI", "User"]
        if role not in ["Admin", "AI", "User"]:
            raise HTTPException(status_code=400, detail=f"Invalid role. Valid roles are: {', '.join(valid_roles)}")
        user.role = role
        
    user.active = active

    db.commit()
    db.refresh(user)

    # return {"message": f"Role updated successfully to '{role}' for user ID {user_id}"}
    return {
        "message": "User updated successfully.",
        "user_id": user.user_id,
    }


@router.post("/projects", tags=["Project"])
async def upload_zip(
    file: UploadFile = File(...),
    db: Session = Depends(dependency.get_db),
    current_user: dict = Depends(auth.get_current_user),
):
    """
    Upload a ZIP file, create a project entry, and store the files in the appropriate folder structure.
    """
    try:
        # Ensure the uploaded file is a ZIP file
        if not file.filename.endswith(".zip"):
            raise HTTPException(
                status_code=400, detail="Uploaded file is not a ZIP file"
            )
 
        # Save the uploaded ZIP file temporarily
        temp_zip_path = BASE_DIR / "temp" / file.filename.replace(" ", "_")
        temp_zip_path.parent.mkdir(parents=True, exist_ok=True)
 
        with open(temp_zip_path, "wb") as buffer:
            buffer.write(await file.read())
 
        # Extract the ZIP file to a temporary directory
        temp_extract_path = BASE_DIR / "temp" / "extracted"
        temp_extract_path.mkdir(parents=True, exist_ok=True)
 
        with zipfile.ZipFile(temp_zip_path, "r") as zip_ref:
            zip_ref.extractall(temp_extract_path)
        # Remove the ZIP file after extraction
        os.remove(temp_zip_path)
        # Search for metadata.json
        metadata_path = next(temp_extract_path.rglob("metadata.json"), None)
        if not metadata_path:
            raise HTTPException(
                status_code=400, detail="Please upload Scribe's - Scripture Burrito validated zip file"
            )
 
        # Read metadata.json
        with open(metadata_path, "r", encoding="utf-8") as metadata_file:
            metadata_content = json.load(metadata_file)
        # Extract project name and metadata info
        base_name = metadata_content.get("identification", {}).get("name", {}).get("en", "Unknown Project")
 
        # Create unique project name for the database if duplicates exist
        existing_projects = db.query(Project).filter(Project.name.like(f"{base_name}%")).all()
        if existing_projects:
            count = 1
            similar_names = [proj.name for proj in existing_projects]
            while f"{base_name}({count})" in similar_names:
                count += 1
            project_name = f"{base_name}({count})"
        else:
            project_name = base_name
 
        # Insert the project into the database
        project = Project(
            name=project_name,
            owner_id=current_user.user_id,
            script_lang="",
            audio_lang="",
        )
        db.add(project)
        db.commit()
        db.refresh(project)
 
        # Use the project_id for folder creation
        project_id = project.project_id
        project_base_path = BASE_DIR / str(project_id)
        input_path = project_base_path / "input" / base_name  # Use base_name here
        output_path = project_base_path / "output" / base_name
 
        # Move extracted files to the input folder
        input_path.mkdir(parents=True, exist_ok=True)
        for item in temp_extract_path.iterdir():
            shutil.move(str(item), str(input_path))
        shutil.rmtree(temp_extract_path)
        # Ensure the output directory exists
        output_path.mkdir(parents=True, exist_ok=True)
 
        # Process the project files (e.g., books, chapters, verses)
        result = crud.process_project_files(input_path, output_path, db, project)
 
        return {
            "message": "Project uploaded successfully",
            "project_id": project_id,
            "result": result,
        }
 
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400, detail="The file is not a valid ZIP archive"
        )
    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/projects/{project_id}/add-book", tags=["Project"])
async def add_new_book_zip(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(dependency.get_db),
    current_user: dict = Depends(auth.get_current_user),
):
    """
    Add a new book to a project from a ZIP file. Check for missing verses and delete chapters with zero verses.
 
    Args:
    - project_id: The ID of the project to which the book is added.
    - file: The uploaded ZIP file containing the book structure.
    """
    temp_extract_path = None
    try:
        # Check if the project exists
        project = (
        db.query(Project).filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        ).first()
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Locate versification.json
        versification_path= "versification.json"
        if not versification_path:
            logger.error("versification.json not found .")
            raise HTTPException(status_code=400, detail="versification.json not found")
        # Read versification.json
        with open(versification_path, "r", encoding="utf-8") as versification_file:
            versification_data = json.load(versification_file)
        valid_books = set(versification_data.get("maxVerses", {}).keys())
        # Extract book name from file
        book_name = file.filename.rsplit(".", 1)[0]

        # Validate book name
        if book_name not in valid_books:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid book code: {book_name}",
            )
        # Ensure the uploaded file is a ZIP file
        if not file.filename.endswith(".zip"):
            raise HTTPException(status_code=400, detail="Uploaded file is not a ZIP file")
 
        # Paths for temporary storage
        temp_zip_path = BASE_DIR / "temp" / file.filename.replace(" ", "_")
        temp_extract_path = BASE_DIR / "temp" / "extracted_book"
 
        # Create temporary directories
        temp_zip_path.parent.mkdir(parents=True, exist_ok=True)
        temp_extract_path.mkdir(parents=True, exist_ok=True)
 
        # Save the uploaded ZIP file
        with open(temp_zip_path, "wb") as buffer:
            buffer.write(await file.read())
 
        # Extract the ZIP file
        try:
            with zipfile.ZipFile(temp_zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_extract_path)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="The file is not a valid ZIP archive")
 
        # Remove the ZIP file after extraction
        temp_zip_path.unlink()
        
        book_name = file.filename.rsplit(".", 1)[0]
        # Verify and normalize the extracted structure
        extracted_items = list(temp_extract_path.iterdir())
 
        print("Debug: Extracted items in temp_extract_path:")
        for item in extracted_items:
            print(f" - {item} (Directory: {item.is_dir()})")
 
        if len(extracted_items) == 1 and extracted_items[0].is_dir() and extracted_items[0].name.isdigit():
            # Case: Direct single chapter folder in the ZIP root
            logger.info(f"Detected single chapter folder directly in ZIP root: {extracted_items[0]}")
            book_folder = temp_extract_path
        elif len(extracted_items) == 1 and extracted_items[0].is_dir():
            # Case: Single folder encapsulating everything
            primary_folder = extracted_items[0]
            inner_items = list(primary_folder.iterdir())
            print(f"Primary folder contents: {[item.name for item in inner_items]}")
 
            if all(item.is_dir() and item.name.isdigit() for item in inner_items):
                # Encapsulating folder directly contains chapter folders
                logger.info(f"Detected encapsulating folder with chapters: {primary_folder}")
                book_folder = primary_folder
            elif len(inner_items) == 1 and inner_items[0].is_dir() and inner_items[0].name.isdigit():
                # Encapsulating folder contains a single chapter folder
                logger.info(f"Detected single chapter folder inside book folder: {inner_items[0]}")
                book_folder = primary_folder
            else:
                logger.error("Unexpected structure inside primary folder.")
                raise HTTPException(status_code=400, detail="Invalid book folder structure")
        elif all(item.is_dir() and item.name.isdigit() for item in extracted_items):
            # Case: Multiple chapter folders in the root of the ZIP
            logger.info("Detected multiple chapter folders directly in the ZIP root.")
            book_folder = temp_extract_path
        else:
            logger.error("Unexpected structure in the extracted ZIP file.")
            raise HTTPException(status_code=400, detail="Invalid book folder structure")
 
        # Check if the book already exists in the project
        existing_book = (
            db.query(Book)
            .filter(Book.project_id == project_id, Book.book == book_name)
            .first()
        )
        
        if existing_book:
            # Perform chapter-level checks for the existing book
            added_chapters, skipped_chapters, incompartible_verses = crud.process_chapters(book_folder, project, existing_book, db,book_name)
            shutil.rmtree(temp_extract_path, ignore_errors=True)
            return {
                "message": "Book already exists. Additional chapters processed.",
                "book": book_name,
                "added_chapters": added_chapters,
                "skipped_chapters": skipped_chapters,
                "incompartible_verses": incompartible_verses
            }
        else:
            # Add a new book and process chapters
 
            book_entry = Book(
                project_id=project_id,
                book=book_name,
            )
            db.add(book_entry)
            db.commit()
            db.refresh(book_entry)
 
        # Dynamically locate the ingredients folder
        base_name = project.name.split("(")[0].strip()
        project_root_path = BASE_DIR / str(project_id) / "input" / base_name
        
        ingredients_path = None
 
        # Check for ingredients folder in root or audio
        if (project_root_path / "ingredients").exists():
            ingredients_path = project_root_path / "ingredients"
        elif (project_root_path / "audio" / "ingredients").exists():
            ingredients_path = project_root_path / "audio" / "ingredients"
        else:
            # Create ingredients path if not present
            ingredients_path = project_root_path / "ingredients"
            ingredients_path.mkdir(parents=True, exist_ok=True)
 
        # Move the book folder into the ingredients folder
        target_book_path = ingredients_path / book_name
        if target_book_path.exists():
            shutil.rmtree(temp_extract_path, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Book folder already exists in ingredients")
 
        shutil.move(str(book_folder), str(target_book_path))
        
        max_verses_data = versification_data.get("maxVerses", {})
        
        # Get maximum chapters for the book
        max_chapters = len(max_verses_data[book_name])
 
        book_max_verses = max_verses_data.get(book_name, [])
        
        # Initialize has_valid_chapters to track valid chapters
        has_valid_chapters = False
        
        incompartible_verses = []
        # Filter out invalid chapters first
        for chapter_dir in target_book_path.iterdir():
            if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                chapter_number = int(chapter_dir.name)
                if chapter_number > max_chapters:
                    logger.error(f"Invalid chapter {chapter_number}: Exceeds maximum allowed chapters ({max_chapters})")
                    shutil.rmtree(target_book_path, ignore_errors=True)
                    db.delete(book_entry)
                    db.commit()
                    raise HTTPException(
                        status_code=400,
                        detail=f"{book_name} should have {max_chapters} chapter(s) but found chapter {chapter_number}. "
                            "Please upload the ZIP file with proper chapter count"
                    )
                    
                chapter_max_verses = (
                    int(book_max_verses[chapter_number - 1])
                    if chapter_number <= len(book_max_verses)
                    else 0
                )
 
                # Get all available verses in the chapter
                available_verses = set(
                    int(verse_digits.group(1))
                    for verse_file in chapter_dir.iterdir()
                    if verse_file.is_file() and "_" in verse_file.stem
                    for verse_digits in [re.match(r"^(\d+)", verse_file.stem.split("_")[1])]
                    if verse_digits
                )
                
                print(f"available verses in chapter {chapter_number}", available_verses)
 
                # If no verses are found, delete the empty chapter folder
                if not available_verses:
                    logger.info(f"Empty chapter detected: {chapter_dir}, deleting it.")
                    shutil.rmtree(chapter_dir)
                    continue
                
                # Validate verses
                if available_verses and max(available_verses) > chapter_max_verses:
                    logger.error(
                        f"{book_name}: Chapter {chapter_number} should have {chapter_max_verses} verses "
                        f"but {max(available_verses)} verses found"
                    )
                    # Clean up and raise immediate error
                    shutil.rmtree(target_book_path, ignore_errors=True)
                    db.delete(book_entry)
                    db.commit()
                    raise HTTPException(
                        status_code=400,
                        detail=f"{book_name}: Chapter {chapter_number} has only {chapter_max_verses} verses "
                            f"but {max(available_verses)} verses found. "
                            "Please upload the ZIP file with correct verse count."
                    )
                 
        # Process the book structure (chapters and verses)
        for chapter_dir in target_book_path.iterdir():
            if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                chapter_number = int(chapter_dir.name)
                
                chapter_max_verses = (
                    int(book_max_verses[chapter_number - 1])
                    if chapter_number <= len(book_max_verses)
                    else 0
                )
 
                # Process verses, tracking and removing duplicates
                verse_files = {}
                for verse_file in chapter_dir.iterdir():
                    if not verse_file.is_file():
                        continue  # Skip directories
                    verse_filename = verse_file.stem
                    if not VALID_VERSE_PATTERN.match(verse_filename):
                        logger.info(f"Skipping invalid verse file: {verse_file.name}")
                        print("Skipping invalid verse file:", verse_file.name)
                        incompartible_verses.append(verse_filename)
                        continue

                    try:
                        parts = verse_file.stem.split("_")
                        
                        # Ensure first part matches chapter number
                        if not (parts[0].isdigit() and int(parts[0]) == chapter_number):
                            continue
                        
                        # Extract verse number
                        if len(parts) >= 2 and parts[1].isdigit():
                            verse_number = int(parts[1])
                        else:
                            logger.warning(f"Skipping malformed verse file: {verse_file.name}")
                            continue
                            
                            
                        # Determine file priority
                        if len(parts) == 2:  # Basic format like 1_1.mp3
                            priority = 2
                        elif "default" in parts:  # Contains 'default'
                            priority = 1
                        else:  # Any other format (takes)
                            priority = 0
                                
                        # Add or replace based on priority
                        if verse_number not in verse_files:
                            verse_files[verse_number] = {
                                'file': verse_file,
                                'priority': priority
                            }
                        elif priority > verse_files[verse_number]['priority']:
                            logger.info(f"Removing lower priority verse file: {verse_files[verse_number]['file']}")
                            os.remove(verse_files[verse_number]['file'])
                            verse_files[verse_number] = {
                                'file': verse_file,
                                'priority': priority
                            }
                        else:
                            logger.info(f"Removing duplicate verse file: {verse_file}")
                            os.remove(verse_file)
                            
                           
                    except (ValueError, IndexError):
                        logger.warning(f"Invalid file name format: {verse_file.name}")
                        continue

                # Finalize verse files after prioritization
                selected_files = {verse: data['file'] for verse, data in verse_files.items()}
                
                # Get available verses after duplicate removal
                available_verses = set(selected_files.keys())
 
                # Determine missing verses
                expected_verses = set(range(1, chapter_max_verses + 1))
                missing_verses = list(expected_verses - available_verses)
 
                # Create chapter entry in the database
                chapter_entry = Chapter(
                    book_id=book_entry.book_id,
                    chapter=chapter_number,
                    approved=False,
                    missing_verses=missing_verses if missing_verses else None,
                )
                db.add(chapter_entry)
                db.commit()
                db.refresh(chapter_entry)
                has_valid_chapters = True
                # Add verse records
                for verse_number, verse_file in selected_files.items():
                    verse = Verse(
                        chapter_id=chapter_entry.chapter_id,
                        verse=verse_number,
                        name=verse_file.name,
                        path=str(verse_file),
                        size=verse_file.stat().st_size,
                        format=verse_file.suffix.lstrip("."),
                        stt=False,
                        text="",
                        modified=False,
                        tts=False,
                        tts_path="",
                        stt_msg="",
                        tts_msg="",
                    )
                    db.add(verse)
        
        # After processing all chapters, check if there were any valid chapters
        if not has_valid_chapters:
            logger.error(f"No valid chapters with verses found for book: {book_name}. Removing the book folder.")
            shutil.rmtree(target_book_path, ignore_errors=True)
            db.delete(book_entry)
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"No verse data found in book: {book_name}",
            )
        db.commit()
 
        # Clean up the temporary extraction folder
        if temp_extract_path:
            shutil.rmtree(temp_extract_path, ignore_errors=True)
 
        return {"message": "Book added successfully", "book_id": book_entry.book_id, "book": book_name, "incompartible_verses": incompartible_verses}
 
    except HTTPException as http_exc:
        logger.error(f"HTTP Exception: {http_exc.detail}")
         # Cleanup temporary extraction folder
        if temp_extract_path:
            shutil.rmtree(temp_extract_path, ignore_errors=True)
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
         # Cleanup temporary extraction folder
        if temp_extract_path:
            shutil.rmtree(temp_extract_path, ignore_errors=True)
        raise HTTPException(status_code=500, detail="An error occurred while adding the book")
 


@router.get("/projects/", tags=["Project"])
async def get_user_projects(
    # project_id: int = Query(None),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Retrieve projects:
    - Admin and AI roles can see all projects.
    - Users can only see projects where they are the owner.
    """
    if current_user.role in ["Admin", "AI"]:
        # Fetch all projects
        projects = db.query(Project).order_by(Project.created_date.desc()).all()

        if not projects:
            raise HTTPException(status_code=404, detail="No projects found.")
        # Prepare the response for all projects
        project_list = []
        for project in projects:
            books = (
                db.query(Book).filter(Book.project_id == project.project_id).all()
            )
            owner = db.query(User).filter(User.user_id == project.owner_id).first()
            project_list.append(
                {
                    "project_id": project.project_id,
                    "name": project.name,
                    "script_lang": project.script_lang,
                    "audio_lang": project.audio_lang,
                    "owner_id": project.owner_id,
                    "user_name": owner.username if owner else None,
                    "archive": project.archive,
                    "created_date": project.created_date,
                    "books": [
                        {
                            "book_id": book.book_id,
                            "book": book.book,
                            # "approved": book.approved,
                            "approved" : (
                                False  # Default for empty chapters
                                if not db.query(Chapter)
                                    .filter(Chapter.book_id == book.book_id)
                                    .first()
                                else all(
                                    chapter.approved
                                    for chapter in db.query(Chapter)
                                        .filter(Chapter.book_id == book.book_id)
                                        .all()
                                    )
                            ),
                        }
                        for book in books
                    ],
                }
            )

        return {
            "message": "Projects retrieved successfully",
            "projects": project_list,
        }

    elif current_user.role == "User":
        # Users can only view their own projects
        # Fetch all projects for the user
        projects = (
            db.query(Project)
            .filter(Project.owner_id == current_user.user_id)
            .order_by(Project.created_date.desc())
            .all()
        )

        if not projects:
            raise HTTPException(
                status_code=404, detail="No projects found for the user."
            )

        # Prepare the response for all projects
        project_list = []
        for project in projects:
            books = (
                db.query(Book).filter(Book.project_id == project.project_id).all()
            )
            project_list.append(
                {
                    "project_id": project.project_id,
                    "name": project.name,
                    "script_lang": project.script_lang,
                    "audio_lang": project.audio_lang,
                    "owner_id": project.owner_id,
                    "user_name": current_user.username,
                    "archive": project.archive,
                    "created_date": project.created_date,
                    "books": [
                        {
                            "book_id": book.book_id,
                            "book": book.book,
                            # "approved": book.approved,
                            "approved" : (
                                False  # Default for empty chapters
                                if not db.query(Chapter)
                                    .filter(Chapter.book_id == book.book_id)
                                    .first()
                                else all(
                                    chapter.approved
                                    for chapter in db.query(Chapter)
                                        .filter(Chapter.book_id == book.book_id)
                                        .all()
                                    )
                            ),
                        }
                        for book in books
                    ],
                }
            )
        return {
            "message": "Projects retrieved successfully",
            "projects": project_list,
        }

    else:
        raise HTTPException(status_code=403, detail="Access denied.")


@router.get("/project/details", tags=["Project"])
async def get_project_details(
    project_id: int = Query(None),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Fetch detailed project information for the user, including associated books and chapters.
    - Admin and AI roles can view all projects.
    - Regular users can only view their own projects.
    """

    def get_project_response(project):
        # Fetch the owner details
        owner = db.query(User).filter(User.user_id == project.owner_id).first()

        # Fetch books associated with the project
        books = db.query(Book).filter(Book.project_id == project.project_id).all()

        # Prepare detailed project information (up to book and chapter level)
        return {
            "project_id": project.project_id,
            "name": project.name,
            "owner_id": project.owner_id,
            "user_name": owner.username if owner else None,
            "script_lang": project.script_lang,
            "audio_lang": project.audio_lang,
            "archive": project.archive,
            "books": [
                {
                    "book_id": book.book_id,
                    "book": book.book,
                    "approved": (
                    bool(chapters := db.query(Chapter)
                        .filter(Chapter.book_id == book.book_id)
                        .all())
                        and all(chapter.approved for chapter in chapters)
                ),
                    "chapters": [
                        {
                            "chapter_id": chapter.chapter_id,
                            "chapter": chapter.chapter,
                            "approved": chapter.approved,
                            "missing_verses": chapter.missing_verses,
                        }
                        for chapter in db.query(Chapter)
                        .filter(Chapter.book_id == book.book_id)
                        .all()
                    ],
                }
                for book in books
            ],
        }

    if current_user.role in ["Admin", "AI"]:
        # Admin and AI roles: Can view all projects
        if project_id:
            # Fetch the specific project
            project = db.query(Project).filter(Project.project_id == project_id).first()

            if not project:
                raise HTTPException(status_code=404, detail="Project not found.")

            # Return the detailed project response
            return {
                "message": "Project retrieved successfully",
                "project": get_project_response(project),
            }
        else:
            # Fetch all projects
            projects = db.query(Project).all()

            if not projects:
                raise HTTPException(status_code=404, detail="No projects found.")

            # Prepare the response for all projects
            project_list = [get_project_response(project) for project in projects]

            return {
                "message": "Projects retrieved successfully",
                "projects": project_list,
            }

    elif current_user.role == "User":
        # Regular users: Can only view their own projects
        if project_id:
            # Fetch the specific project for the user
            project = (
                db.query(Project)
                .filter(
                    Project.owner_id == current_user.user_id,
                    Project.project_id == project_id,
                )
                .first()
            )

            if not project:
                raise HTTPException(
                    status_code=404, detail="Project not found for the user."
                )

            # Return the detailed project response
            return {
                "message": "Project retrieved successfully",
                "project": get_project_response(project),
            }
        else:
            # Fetch all projects for the user
            projects = (
                db.query(Project).filter(Project.owner_id == current_user.user_id).all()
            )

            if not projects:
                raise HTTPException(
                    status_code=404, detail="No projects found for the user."
                )

            # Prepare the response for all projects
            project_list = [get_project_response(project) for project in projects]

            return {
                "message": "Projects retrieved successfully",
                "projects": project_list,
            }

    else:
        raise HTTPException(status_code=403, detail="Access denied.")


@router.put("/projects/{project_id}/script_language/{script_lang}", tags=["Project"])
async def update_script_lang(
    project_id: int,
    script_lang: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the script_lang field in the Project table for a given project_id.
    """
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")
    project.script_lang = script_lang
    db.commit()
    db.refresh(project)
    return {
        "message": "Script language updated successfully",
        "project_id": project_id,
        "script_lang": project.script_lang,
    }


@router.put("/projects/{project_id}/audio_language/{audio_lang}", tags=["Project"])
async def update_audio_lang(
    project_id: int,
    audio_lang: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the audio_lang field in the Project table for a given project_id.
    """
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")

    # Update the audio_lang field
    project.audio_lang = audio_lang
    db.commit()
    db.refresh(project)
    return {
        "message": "Audio language updated successfully",
        "project_id": project_id,
        "audio_lang": project.audio_lang,
    }


@router.put("/projects/{project_id}/archive/", tags=["Project"])
async def update_project_archive(
    project_id: int,
    archive: bool,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    # """
    # Update the 'archive' status of a project.

    # Args:
    #     project_id (int): ID of the project.
    #     archive (bool): The new archive status (True or False).

    # Returns:
    #     dict: Response message with project details.
    # """
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")

    # Update the archive status
    project.archive = archive
    db.commit()
    db.refresh(project)

    return {
        "message": "Project archive status updated successfully",
        "project": {
            "project_id": project.project_id,
            "name": project.name,
            "archive": project.archive,
        },
    }


@router.post("/project/chapter/stt", tags=["Project"])
async def convert_to_text(
    project_id: int,
    book_code: str,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")
    # Fetch the book associated with the project and book_code
    book = (
        db.query(Book)
        .filter(Book.project_id == project_id, Book.book == book_code)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the project.")

    # Fetch the chapter associated with the book and chapter_number
    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.book_id == book.book_id,
            Chapter.chapter == chapter_number,
        )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found for the book.")
    script_lang = project.script_lang
    if not script_lang:
        raise HTTPException(
            status_code=400, detail="Script language is not defined for the project."
        )
    verses = db.query(Verse).filter(Verse.chapter_id == chapter.chapter_id).all()
    if not verses:
        raise HTTPException(status_code=404, detail="No verses found for the chapter")
    
    for verse in verses:
        if verse.stt_msg != "Transcription successful":
                logger.debug(f"Resetting stt_msg for verse {verse.verse_id}.")
                verse.stt_msg = ""
                verse.stt = False# Resetting stt flag as well
                db.add(verse)
                db.commit()
        
    file_paths = [verse.path for verse in verses]
    test_result = call_stt_api(file_paths[0], script_lang)
    if "error" in test_result:
        raise HTTPException(status_code=400, detail=test_result["error"])
    background_tasks.add_task(crud.transcribe_verses, file_paths, script_lang, db)
    return {
        "message": "Transcription started for all verses in the chapter",
        "project_id": project_id,
        "book_code": book_code,
        "chapter_number": chapter_number,
        "script_lang": script_lang,
    }


@router.get("/job-status/{job_id}", tags=["Project"])
async def get_job_status(
    job_id: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    API to check the status of a job using the job ID.
    """
    # Query the jobs table for the given job_id
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Fetch status from the local jobs table
    job_status = {
        "job_id": job.job_id,
        "ai_jobid": job.ai_jobid,
        "status": job.status,
    }
    return {"message": "Job status retrieved successfully", "data": job_status}


@router.get("/project/{project_id}/{book_code}/{chapter_number}", tags=["Project"])
async def get_chapter_status(
    project_id: int,
    book_code: str,
    chapter_number: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Get the status of each verse in a chapter.
    """
    # Validate project
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")
    # Validate book
    book = (
        db.query(Book)
        .filter(Book.project_id == project_id, Book.book == book_code)
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the project")
    # Validate chapter
    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.book_id == book.book_id,
            Chapter.chapter == chapter_number,
        )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    # Retrieve all verses for the chapter
    verses = db.query(Verse).filter(Verse.chapter_id == chapter.chapter_id).all()
    if not verses:
        return {"message": "No verses found for the chapter", "data": []}
    # Prepare the response with verse statuses
    verse_statuses = [
        {
            "verse_id": verse.verse_id,
            "verse_number": verse.verse,
            "stt": verse.stt,
            "stt_msg": verse.stt_msg,
            "text": verse.text,
            "tts": verse.tts,
            "tts_path": verse.tts_path,
            "modified": verse.modified,
            "size": verse.size,
            "format": verse.format,
            "path": verse.path,
            "name": verse.name,
            "tts_msg": verse.tts_msg,
        }
        for verse in verses
    ]
    return {
        "message": "Chapter status retrieved successfully",
        "chapter_info": {
            "project_id": project_id,
            "book_code": book_code,
            "chapter_id": chapter.chapter_id,
            "chapter_number": chapter_number,
            "approved": chapter.approved,
        },
        "data": verse_statuses,
    }


@router.put("/chapter/approve", tags=["Project"])
async def update_chapter_approval(
    project_id: int,
    book: str,
    chapter: int,
    approve: bool,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the approved column in the Chapter table for a given project_id, book, and chapter.
    """
    # Fetch the chapter record
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")
    # Validate the book
    book_record = (
        db.query(Book).filter(Book.project_id == project_id, Book.book == book).first()
    )
    if not book_record:
        raise HTTPException(status_code=404, detail="Book not found for the project")
    chapter_record = (
        db.query(Chapter)
        .filter(Chapter.book_id == book_record.book_id, Chapter.chapter == chapter)
        .first()
    )
    if not chapter_record:
        raise HTTPException(status_code=404, detail="Chapter not found")
    # Update the approved column
    chapter_record.approved = approve
    db.commit()

    return {
        "message": "Chapter approval status updated",
        "project_id": project_id,
        "book": book,
        "chapter": chapter,
        "approved": chapter_record.approved,
    }


@router.put("/project/verse/{verse_id}", tags=["Project"])
async def update_verse_text(
    verse_id: int,
    verse_text: str = Query(...),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the text of a verse and mark it as modified based on verse_id.
    """
    # Fetch the verse record
    verse_record = db.query(Verse).filter(Verse.verse_id == verse_id).first()
    if not verse_record:
        raise HTTPException(status_code=404, detail="Verse not found.")
 
    # Use back joins to fetch the book and project
    chapter = (
        db.query(Chapter).filter(Chapter.chapter_id == verse_record.chapter_id).first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found for the verse.")
 
    book = db.query(Book).filter(Book.book_id == chapter.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the chapter.")
 
    project = db.query(Project).filter(Project.project_id == book.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the book.")
 
    # Validate the user is the owner of the project
    if project.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=403, detail="You do not have access to this project."
        )
 
    # Update the text and mark it as modified
    verse_record.text = verse_text
    verse_record.modified = True
 
    # Check and reset TTS status if necessary
    if verse_record.tts:
        # Delete the TTS file if it exists
        if verse_record.tts_path and os.path.exists(verse_record.tts_path):
            try:
                os.remove(verse_record.tts_path)
                logger.info(f"Deleted TTS file at path: {verse_record.tts_path}")
            except Exception as e:
                logger.warning(f"Failed to delete TTS file at path {verse_record.tts_path}: {str(e)}")
    
    # Reset TTS-related fields
        verse_record.tts = False
        verse_record.tts_msg = ""
        verse_record.tts_path = ""
 
    # Mark the chapter as not approved
    chapter.approved = False
    db.add(chapter)
    db.commit()
 
    return {
        "message": "Verse text updated successfully.",
        "verse_id": verse_id,
        "text": verse_record.text,
        "modified": verse_record.modified,
    }


@router.put("/project/chapter/{chapter_id}/tts", tags=["Project"])
async def convert_to_speech(
    chapter_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    API to convert text to speech for all verses in a chapter, using chapter_id.
    """
    # Fetch the chapter and validate it
    chapter = db.query(Chapter).filter(Chapter.chapter_id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    # Use back joins to fetch the book and project
    book = db.query(Book).filter(Book.book_id == chapter.book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    project = db.query(Project).filter(Project.project_id == book.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    # Validate the user is the owner of the project
    if project.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=403, detail="You do not have access to this project."
        )

    # Fetch modified verses for the chapter
    verses = (
        db.query(Verse)
        .filter(Verse.chapter_id == chapter_id, Verse.modified == True)
        .all()
    )
    if not verses:
        return {"message": "No verses with modified text found in the chapter"}
        
    # Get the file extension from the first verse in the chapter
    output_format = None
    if verses[0].path:
        output_format = verses[0].path.split(".")[-1]
    if not output_format:
        raise HTTPException(
            status_code=400,
            detail="Unable to determine the output format from the verse path.",
        )
    # Check if the TTS model is served before starting the task
    test_text = "Test text"
    test_result = call_tts_api(test_text, project.audio_lang,output_format)
    if "error" in test_result:
        raise HTTPException(status_code=400, detail=test_result["error"])

    # Start the text-to-speech generation task
    background_tasks.add_task(
        crud.generate_speech_for_verses,
        project.project_id,
        book.book,
        verses,
        project.audio_lang,
        db,
        output_format
    )

    return {
        "message": "Text-to-speech conversion started for the chapter",
        "project_id": project.project_id,
        "book_code": book.book,
        "chapter_number": chapter.chapter,
    }


@router.get("/project/verse/audio", tags=["Project"])
async def stream_audio(
    verse_id: int,
    db: Session = Depends(dependency.get_db),
):
    """
    Stream an audio file, ensuring proper sample rate and format for WAV files.
    MP3 files are streamed directly without conversion.
    """
    # Validate and retrieve the verse entry
    verse_entry = db.query(Verse).filter(Verse.verse_id == verse_id).first()
    if not verse_entry:
        raise HTTPException(status_code=404, detail="Verse not found")
    # Determine the file path
    file_path = verse_entry.tts_path if verse_entry.modified else verse_entry.path

    # Ensure the file exists
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    # Determine the file extension
    file_extension = os.path.splitext(file_path)[-1].lower()
    # Process WAV files: Validate and resample if needed
    if file_extension == ".wav":
        media_type = "audio/wav"
    elif file_extension == ".mp3":
        # Stream MP3 files directly
        media_type = "audio/mpeg"
    else:
        raise HTTPException(
            status_code=400, detail=f"Unsupported audio format: {file_extension}"
        )

    # Stream the audio file
    def iter_file():
        with open(file_path, "rb") as audio_file:
            while chunk := audio_file.read(1024 * 1024):  # Read in chunks of 1MB
                yield chunk

    return StreamingResponse(iter_file(), media_type=media_type)


@router.get("/generate-usfm/", tags=["Project"])
async def generate_usfm(
    project_id: int,
    book: str,
    chapter: int = None,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Generate a USFM file for a book or specific chapter, replacing missing chapters or verses with placeholders.
    """
    # Validate project
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")

    # Validate book
    book_entry = (
        db.query(Book).filter(Book.project_id == project_id, Book.book == book).first()
    )
    if not book_entry:
        raise HTTPException(
            status_code=404, detail=f"Book '{book}' not found in the project."
        )

    project_id = project.project_id
    project_base_path = BASE_DIR / str(project_id)
    input_path = project_base_path / "input"

    # Load `versification.json`
    project_input_path = next(input_path.iterdir(), None)
    if not project_input_path or not project_input_path.is_dir():
        logger.error("Project directory not found under input path.")
        raise HTTPException(
            status_code=400, detail="Project directory not found under input path"
        )
    # Locate versification.json
    versification_path = next(project_input_path.rglob("versification.json"), None)
    if not versification_path:
        logger.error("versification.json not found in the project folder.")
        raise HTTPException(
            status_code=400, detail="versification.json not found in the project folder"
        )
    # Read versification.json
    with open(versification_path, "r", encoding="utf-8") as versification_file:
        versification_data = json.load(versification_file)
    max_verses = versification_data.get("maxVerses", {}).get(book, [])
    if not max_verses:
        raise HTTPException(
            status_code=404, detail=f"Versification data not found for book '{book}'."
        )

    # Load book metadata
    METADATA_FILE = "metadatainfo.json"
    try:
        with open(METADATA_FILE, "r", encoding="utf-8") as file:
            book_metadata = json.load(file)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Metadata file not found.")
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid metadata JSON format.")

    # Validate if the book exists in metadata
    if book not in book_metadata:
        raise HTTPException(
            status_code=404, detail=f"Metadata not found for book {book}."
        )

    # Fetch metadata for the book
    short_title = book_metadata[book]["short"]["en"]
    abbr = book_metadata[book]["abbr"]["en"]
    long_title = book_metadata[book]["long"]["en"]

    # Fetch chapters and verses
    chapters = db.query(Chapter).filter(Chapter.book_id == book_entry.book_id).all()
    chapter_map = {chapter.chapter: chapter for chapter in chapters}

    # Prepare USFM content
    usfm_text = (
        f"\\id {book}\n\\usfm 3.0\n\\ide UTF-8\n"
        f"\\h {short_title}\n\\toc1 {abbr}\n\\toc2 {short_title}\n\\toc3 {long_title}\n\\mt {abbr}\n"
    )
    for chapter_number, num_verses in enumerate(max_verses, start=1):
        try:
            num_verses = int(num_verses)  # Convert num_verses to an integer
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid verse count '{num_verses}' for chapter {chapter_number} in book '{book}'",
            )

        usfm_text += f"\\c {chapter_number}\n\\p\n"

        if chapter_number in chapter_map:
            # Chapter exists, fetch verses
            chapter = chapter_map[chapter_number]
            verses = (
                db.query(Verse).filter(Verse.chapter_id == chapter.chapter_id).all()
            )
            verse_map = {verse.verse: verse.text for verse in verses}

            for verse_number in range(1, num_verses + 1):
                verse_text = verse_map.get(verse_number, "...")
                usfm_text += f"\\v {verse_number} {verse_text}\n"
        else:
            # Add placeholder verses for missing chapters
            for verse_number in range(1, num_verses + 1):
                usfm_text += f"\\v {verse_number} ...\n"

    base_name = project.name.split("(")[0].strip()
    # Save USFM file
    project_output_path = (
        BASE_DIR / str(project_id) / "output" / base_name / "text-1" / "ingredients"
    )
    os.makedirs(project_output_path, exist_ok=True)

    usfm_file_path = project_output_path / f"{book}.usfm"
    with open(usfm_file_path, "w", encoding="utf-8") as usfm_file:
        usfm_file.write(usfm_text)

    return FileResponse(
        usfm_file_path,
        media_type="text/plain",
        filename=f"{book}.usfm",
    )


@router.get("/download-processed-project-zip/", tags=["Project"])
async def download_processed_project_zip(
    project_id: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    project = (
        db.query(Project)
        .filter(
            Project.owner_id == current_user.user_id, Project.project_id == project_id
        )
        .first()
    )
 
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    
     # Step 2: Fetch all books in the project
    books = db.query(Book).filter(Book.project_id == project_id).all()
    if not books:
        raise HTTPException(
            status_code=404, detail="No books found for the project."
        )
 
    # Step 3: Generate USFM files for all books
    for book in books:
        try:
            # Call the `generate_usfm` function for each book
            await generate_usfm(
                project_id=project_id,
                book=book.book,
                db=db,
                current_user=current_user,
            )
        except HTTPException as e:
            # Log the error and proceed with the next book
            logger.error(f"Failed to generate USFM for book '{book.book}': {e.detail}")
 
 
    # Construct directories using the base name
    base_name = project.name.split("(")[0].strip()
    base_dir = Path(BASE_DIRECTORY) / str(project.project_id)
    input_dir = base_dir / "input" / base_name
    output_dir = base_dir / "output" / base_name
 
    final_dir = base_dir / project.name
    zip_path = f"{final_dir}.zip"
    # Cleanup logic: Remove existing folders or zip files with the same name
    if final_dir.exists():
        shutil.rmtree(final_dir, ignore_errors=True)
        logger.info(f"Removed existing directory: {final_dir}")
    if os.path.exists(zip_path):
        os.remove(zip_path)
        logger.info(f"Removed existing zip file: {zip_path}")
 
    if not input_dir.exists() or not output_dir.exists():
        raise HTTPException(
            status_code=404, detail=f"Input or output directory not found for project: {project_id}."
        )
 
    # Create a temporary directory
    with tempfile.TemporaryDirectory(dir=base_dir) as temp_dir_path:
        temp_dir = Path(temp_dir_path)
        temp_audio_dir = temp_dir / "audio" / "ingredients"
        temp_text_dir = temp_dir / "text-1" / "ingredients"
 
        temp_audio_dir.mkdir(parents=True, exist_ok=True)
        temp_text_dir.mkdir(parents=True, exist_ok=True)
 
        # Step 2: Copy the output folder into the temporary directory
        shutil.copytree(output_dir, temp_dir / "output", dirs_exist_ok=True)
 
        # Step 3: Process audio files
        input_audio_dir = input_dir / "audio" / "ingredients"
        if not input_audio_dir.exists():
            input_audio_dir = input_dir / "ingredients"
 
        for book_dir in input_audio_dir.iterdir():
            if book_dir.is_dir():
                temp_book_dir = temp_audio_dir / book_dir.name
                temp_book_dir.mkdir(parents=True, exist_ok=True)
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir():
                        temp_chapter_dir = temp_book_dir / chapter_dir.name
                        temp_chapter_dir.mkdir(parents=True, exist_ok=True)
 
                        output_chapter_dir = (
                            output_dir
                            / "audio"
                            / "ingredients"
                            / book_dir.name
                            / chapter_dir.name
                        )
                        output_files = (
                            {
                                f.stem: f
                                for f in output_chapter_dir.iterdir()
                                if f.is_file()
                            }
                            if output_chapter_dir.exists()
                            else {}
                        )
 
                        for input_file in chapter_dir.iterdir():
                            if input_file.is_file():
                                # Use the output file if it exists, otherwise retain the input file
                                output_file = output_files.get(input_file.stem)
                                if output_file:
                                    shutil.copy(
                                        output_file, temp_chapter_dir / output_file.name
                                    )
                                else:
                                    shutil.copy(
                                        input_file, temp_chapter_dir / input_file.name
                                    )
 
        for additional_file in input_audio_dir.iterdir():
            if additional_file.is_file() and additional_file.suffix in {".json", ".md"}:
                # Copy the file to both temp_audio_dir and temp_text_dir
                shutil.copy(additional_file, temp_audio_dir / additional_file.name)
                shutil.copy(additional_file, temp_text_dir / additional_file.name)
 
        # Step 4: Handle text files
        input_text_dir = input_dir / "text-1" / "ingredients"
        output_text_dir = output_dir / "text-1" / "ingredients"
 
        # Step 4.1: By default, copy all USFM files from output directory to the temporary directory
        if output_text_dir.exists():
            for output_file in output_text_dir.iterdir():
                if output_file.suffix == ".usfm" and output_file.is_file():
                    shutil.copy(output_file, temp_text_dir / output_file.name)
 
        if input_text_dir.exists():
            temp_text_files = {
                f.stem: f for f in temp_text_dir.iterdir() if f.is_file()
            }
 
            for input_file in input_text_dir.iterdir():
                if input_file.suffix == ".usfm" and input_file.is_file():
                    # Overwrite or copy files to temporary directory as per conditions
                    if input_file.stem in temp_text_files:
                        # Skip copying, retain the temporary directory's file
                        continue
                    else:
                        # Copy the file from input to the temp directory
                        shutil.copy(input_file, temp_text_dir / input_file.name)
 
        # Step 5: Copy metadata
        metadata_file = input_dir / "metadata.json"
        if metadata_file.exists():
            metadata_text_dir = temp_dir / "text-1"
            metadata_text_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy(metadata_file, temp_dir / "metadata.json")
            shutil.copy(metadata_file, metadata_text_dir / "metadata.json")
 
        # Step 6: Remove unnecessary directories
        shutil.rmtree(temp_dir / "output", ignore_errors=True)
        # Step 7: Rename and zip the directory
        final_dir = base_dir / project.name
        shutil.move(temp_dir, final_dir)
 
        zip_path = f"{final_dir}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(final_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(final_dir)
                    zipf.write(file_path, arcname)
 
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=f"{project.name}.zip",
        )