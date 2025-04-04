from typing import Optional
from fastapi import Depends, File, UploadFile, HTTPException, APIRouter, Query,BackgroundTasks
from fastapi.responses import FileResponse ,StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import os
import re
from database import User, Project, Verse, Chapter, Job, Book
import logging
import auth
import dependency
import crud
import shutil
import datetime
from pydantic import EmailStr
from dotenv import load_dotenv
from dependency import logger, LOG_FOLDER
from utils import send_email
import json


def current_time():
    return datetime.datetime.now().strftime("%B %d, %Y %I:%M:%S %p")

load_dotenv()

# Configure logging level from .env
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("fastapi_app")


FRONTEND_URL = os.getenv("FRONTEND_URL")
# Regex pattern for valid verse file formats (ignores extension)
VALID_VERSE_PATTERN = re.compile(r"^\d+_\d+(?:_\d+)?(?:_default)?$")
BASE_DIRECTORY = os.getenv("BASE_DIRECTORY")
# Raise an error if the environment variable is not set
if not BASE_DIRECTORY:
    raise ValueError("The environment variable 'BASE_DIRECTORY' is not set.")

# Convert the base directory to a Path object
BASE_DIR = Path(BASE_DIRECTORY)
router = APIRouter()



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
    user = crud.get_user(db, current_user.user_id)
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
    user = crud.get_user(db, current_user.user_id)
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
    user = crud.get_user(db, current_user.user_id)
    return {
        "user_id": user.user_id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "last_login": user.last_login,
        "created_date": user.created_date,
    }






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
    user = crud.get_user(db, user_id)
    # Update the role
    if(role!= None):
        valid_roles = ["Admin", "AI", "User"]
        if role not in ["Admin", "AI", "User"]:
            raise HTTPException(status_code=400, detail=f"Invalid role. Valid roles are: {', '.join(valid_roles)}")
        user.role = role       
    user.active = active
    db.commit()
    db.refresh(user)
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
        # Process the uploaded ZIP file (validate, save, extract)
        temp_extract_path = await crud.process_uploaded_zip(file)
        # Locate metadata.json and read its content
        metadata_content = crud.read_metadata(temp_extract_path)
        # Generate a unique project name
        project_name = crud.generate_unique_project_name(metadata_content, db)
        # Insert the project into the database
        project = crud.create_project_entry(project_name, current_user, db)
        project_id = project.project_id
        # Create required project directories
        input_path, output_path = crud.create_project_folders(project, metadata_content)
        # Move extracted files to the input folder
        crud.move_extracted_files(temp_extract_path, input_path)
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
    try:
        # Step 1: Process the ZIP file (Extract, Validate)
        book_data  = await crud.process_book_zip(
            project_id, file, db, current_user
        )
        # Step 2: Save book data to project (Move, Validate, Store in DB)
        return crud.save_book_to_project(**book_data, db=db)
    except HTTPException as http_exc:
        logger.error(f"HTTP Exception: {http_exc.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while adding the book")

 




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
    # Fetch projects based on role
    projects = crud.fetch_projects_for_role(db, current_user, project_id)
    return {
        "message": "Project(s) retrieved successfully",
        "projects": [crud.get_project_response(db, project) for project in projects],
    }



@router.get("/projects/", tags=["Project"])
async def get_user_projects(
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Retrieve projects:
    - Admin and AI roles can see all projects.
    - Users can only see projects where they are the owner.
    """
    # Fetch projects based on user role
    projects = crud.fetch_projects_for_role(db, current_user)
    # Sort manually since fetch_projects_for_role returns a list
    projects = sorted(projects, key=lambda project: project.created_date, reverse=True)
    return {
        "message": "Projects retrieved successfully",
        "projects": [crud.get_project_summary(db, project, current_user) for project in projects],
    }



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
    project=crud.get_project(project_id,db,current_user)
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
    project=crud.get_project(project_id,db,current_user)
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
    project = crud.get_project(project_id, db, current_user)
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
    book: str,
    chapter: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    logger.info(f"[{current_time()}] Transcription API triggered for project {project_id}, book {book}, chapter {chapter}")
    project = crud.get_project(project_id, db, current_user)   
    # Fetch the book associated with the project and book
    book = crud.get_book(db, project_id, book)
    # Fetch the chapter associated with the book and chapter_number
    chapter = crud.get_chapter(db ,book.book_id,chapter)
    script_lang = crud.get_script_lang(db,project_id, current_user)
    verses = crud.get_verses(db,chapter.chapter_id)
    
    for verse in verses:
        if verse.stt_msg != "Transcription successful":
                logger.info(f"Resetting stt_msg for verse {verse.verse_id}.")
                verse.stt_msg = ""
                verse.stt = False# Resetting stt flag as well
                db.add(verse)
                db.commit()
        
    file_paths = [verse.path for verse in verses]
    crud.is_model_served(script_lang, "stt")
    # Call the separate function to test STT API
    crud.test_stt_api(file_paths, script_lang)
    logger.info(f"[{current_time()}] STT API test successful. Proceeding with transcription.")
    logger.info(f"[{current_time()}] Adding transcription task to background queue")
    background_tasks.add_task(crud.transcribe_verses, file_paths, script_lang, db)
    return {
        "message": "Transcription started for all verses in the chapter",
        "project_id": project_id,
        "book": book,
        "chapter": chapter,
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




@router.get("/project/{project_id}/{book}/{chapter}", tags=["Project"])
async def get_chapter_status(
    project_id: int,
    book: str,
    chapter: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Get the status of each verse in a chapter.
    """
    # Validate project
    project = crud.get_project(project_id, db, current_user)
    book=crud.get_book(db, project_id, book)
    chapter = crud.get_chapter(db ,book.book_id,chapter)
    # Retrieve verse statuses
    verse_statuses = crud.get_verse_statuses(db, chapter.chapter_id)
    return {
        "message": "Chapter status retrieved successfully",
        "chapter_info": {
            "project_id": project_id,
            "book": book,
            "chapter_id": chapter.chapter_id,
            "chapter_number": chapter,
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
    project = crud.get_project(project_id, db, current_user)
    # Validate the book
    book = crud.get_book(db, project_id, book)
    chapter = crud.get_chapter(db ,book.book_id,chapter)
    # Update the approved column
    chapter.approved = approve
    db.commit()
    return {
        "message": "Chapter approval status updated",
        "project_id": project_id,
        "book": book,
        "chapter": chapter,
        "approved": chapter.approved,
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
    logger.info(f"[{current_time()}] 🟢 TTS API triggered for Chapter ID {chapter_id}")
    chapter, book, project = crud.get_chapter_book_project(db, chapter_id, current_user)

    # Fetch modified verses
    verses = crud.get_modified_verses(db, chapter_id)
    if not verses:
        return {"message": "No verses with modified text found in the chapter"}
    # Determine the output audio format
    output_format = crud.get_output_format(verses)
    # Validate TTS model availability
    crud.validate_tts_model(project.audio_lang)
    # Test TTS API with one verse before background processing
    crud.test_tts_api(verses, project.audio_lang, output_format)
    logger.info(f"[{current_time()}] ⏳ Adding TTS conversion task for Chapter {chapter.chapter} to background queue")
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
        "book": book.book,
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
    file_path = verse_entry.tts_path or verse_entry.path

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
    project = crud.get_project(project_id, db, current_user)
    book_obj = crud.get_book(db, project_id, book)
    book= book_obj.book 
    book_id = book_obj.book_id
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
    # # Locate versification.json  
    versification_data = crud.load_versification()   
    book_metadata = crud.load_metadata()
    book_info = crud.fetch_book_metadata(book, book_metadata)

    # Validate if the book exists in metadata
    
    # Fetch chapters and verses
    chapters = db.query(Chapter).filter(Chapter.book_id == book_id).all()
    chapter_map = {chapter.chapter: chapter for chapter in chapters}
    # Generate USFM content
    usfm_text = crud.generate_usfm_content(book, book_info, chapter_map, versification_data, db)
    return crud.save_and_return_usfm_file(project, book, usfm_text)





@router.get("/download-processed-project-zip/", tags=["Project"])
async def download_processed_project_zip(
    project_id: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
): 
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if current_user.role not in ["AI", "Admin"]  and project.owner_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Access denied. Only the project owner or users with the AI role can download the ZIP file")
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
    final_dir, zip_path =crud.prepare_project_for_zipping(project)
    # Create and return the ZIP file
    return crud.create_zip_and_return_response(final_dir, zip_path, project.name)
