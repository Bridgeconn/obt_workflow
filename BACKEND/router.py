from fastapi import  Depends, File, UploadFile, HTTPException,APIRouter
from fastapi.security import  OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import os
import json
from database import  User, Project,VerseFile,Chapter,Job
import logging
from fastapi import BackgroundTasks
import auth
import dependency
import crud

logging.basicConfig(level=logging.DEBUG)



router = APIRouter()

# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)



# Create User API
@router.post("/create-user/")
def create_user(username: str, password: str, db: Session = Depends(dependency.get_db)):
    hashed_password = auth.get_password_hash(password)
    user = User(username=username, password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "User created successfully", "user_id": user.user_id}

# Login API
@router.post("/token/")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(dependency.get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access_token = auth.create_access_token(data={"sub": str(user.user_id)})
    return {"access_token": access_token, "token_type": "bearer"}





@router.post("/upload-zip/{owner_id}")
async def upload_zip(
    file: UploadFile = File(...),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
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
        # Extract project name
        name = metadata_content.get("identification", {}).get("name", {}).get("en", "Unknown Project")
        # Convert the full metadata.json content back to a JSON string
        metadata_info = json.dumps(metadata_content)
        # Create a new project entry
        project = Project(
            name=name,
            owner_id=owner_id,
            script_lang="",  # Empty field
            audio_lang="",   # Empty field
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

        for book_dir in ingredients_path.iterdir():
            if book_dir.is_dir():
                book = book_dir.name
                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                        chapter_number = int(chapter_dir.name)
                        chapter = Chapter(project_id=project.project_id, book=book, chapter=chapter_number, approved=False)
                        db.add(chapter)
                        db.commit()
                        db.refresh(chapter)

                        for verse_file in chapter_dir.iterdir():
                            if verse_file.is_file() and "_" in verse_file.stem:
                                try:
                                    verse_number = int(verse_file.stem.split("_")[1])
                                    verse = VerseFile(
                                        chapter_id=chapter.chapter_id,
                                        verse=verse_number,
                                        name=verse_file.name,
                                        path=str(verse_file),
                                        size=verse_file.stat().st_size,
                                        format=verse_file.suffix.lstrip("."),
                                        stt=False,
                                        text="",
                                        text_modified=False,
                                        tts=False,
                                        tts_path="",
                                        stt_msg="",
                                        tts_msg=""
                                    )
                                    db.add(verse)
                                except ValueError:
                                    logging.warning(f"Invalid file name format: {verse_file.name}")
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


@router.put("/update-script-lang/{project_id}")
async def update_script_lang(
    project_id: int, 
    script_lang: str, 
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user)
):
    """
    Update the script_lang field in the Project table for a given project_id.
    """
    # Fetch the project
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.script_lang = script_lang
    db.commit()
    db.refresh(project)
    return {
        "message": "Script language updated successfully",
        "project_id": project_id,
        "script_lang": project.script_lang,
    }



@router.put("/update-audio-lang/{project_id}")
async def update_audio_lang(
    project_id: int,
    audio_lang: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user)
):
    """
    Update the audio_lang field in the Project table for a given project_id.
    """
    # Fetch the project
    project = db.query(Project).filter(Project.project_id == project_id).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Update the audio_lang field
    project.audio_lang = audio_lang
    db.commit()
    db.refresh(project)
    return {
        "message": "Audio language updated successfully",
        "project_id": project_id,
        "audio_lang": project.audio_lang,
    }




@router.post("/transcribe")
async def transcribe_book(
    project_id: int,
    book_code: str,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.project_id == project_id,
            Chapter.book == book_code,
            Chapter.chapter == chapter_number,
        )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    
    verses = db.query(VerseFile).filter(VerseFile.chapter_id == chapter.chapter_id).all()
    if not verses:
        raise HTTPException(status_code=404, detail="No verses found for the chapter")
    file_paths = [verse.path for verse in verses]  
    background_tasks.add_task(crud.transcribe_verses, file_paths, db)

    return {
        "message": "Transcription started for all verses in the chapter",
        "project_id": project_id,
        "book_code": book_code,
        "chapter_number": chapter_number,
    }


@router.get("/job-status/{jobid}")
async def get_job_status(jobid: int, db: Session = Depends(dependency.get_db),current_user: User = Depends(auth.get_current_user)):
    """
    API to check the status of a job using the job ID.
    """
    # Query the jobs table for the given jobid
    job = db.query(Job).filter(Job.jobid == jobid).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Fetch status from the local jobs table
    job_status = {
        "jobid": job.jobid,
        "ai_jobid": job.ai_jobid,
        "status": job.status,
    }

    return {"message": "Job status retrieved successfully", "data": job_status}



@router.get("/chapter-status/{project_id}/{book_code}/{chapter_number}")
async def get_chapter_status(
    project_id: int,
    book_code: str,
    chapter_number: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user)
):
    """
    Get the status of each verse in a chapter.
    """
    # Validate project and chapter
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.project_id == project_id,
            Chapter.book == book_code,
            Chapter.chapter == chapter_number,
        )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Retrieve all verses for the chapter
    verses = db.query(VerseFile).filter(VerseFile.chapter_id == chapter.chapter_id).all()

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
        }
        for verse in verses
    ]

    return {
        "message": "Chapter status retrieved successfully",
        "chapter_info": {
            "project_id": project_id,
            "book_code": book_code,
            "chapter_number": chapter_number,
        },
        "data": verse_statuses,
    }



@router.put("/chapter/approve")
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
    chapter_record = (
        db.query(Chapter)
        .filter(
            Chapter.project_id == project_id,
            Chapter.book == book,
            Chapter.chapter == chapter
        )
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
        "approved": chapter_record.approved
    }


@router.put("/verse/update-text")
async def update_verse_text(
    verse_id: int,
    modified_text: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the text and set text_modified to True in the VerseFile table for a given verse_id.
    """
    # Fetch the verse record
    verse_record = db.query(VerseFile).filter(VerseFile.verse_id == verse_id).first()

    if not verse_record:
        raise HTTPException(status_code=404, detail="Verse not found")

    # Update the text and set text_modified to True
    verse_record.text = modified_text
    verse_record.text_modified = True
    db.commit()

    return {
        "message": "Verse text updated successfully",
        "verse_id": verse_id,
        "text": verse_record.text,
        "text_modified": verse_record.text_modified
    }




@router.post("/convert-to-speech")
async def convert_to_speech(
    project_id: int,
    book_code: str,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    API to convert text to speech for all verses in a chapter.
    """
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Fetch the chapters for the given book
    chapter = (
        db.query(Chapter)
        .filter(
            Chapter.project_id == project_id,
            Chapter.book == book_code,
            Chapter.chapter == chapter_number,
        )
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    verses = db.query(VerseFile).filter(
        VerseFile.chapter_id == chapter.chapter_id, VerseFile.text_modified == True
    ).all()

    if not verses:
        return {"message": "No verses with modified text found in the chapter"}
    background_tasks.add_task(
        crud.generate_speech_for_verses, project_id, book_code, verses, project.audio_lang, db
    )

    return {
        "message": "Text-to-speech conversion started for the chapter",
        "project_id": project_id,
        "book_code": book_code,
        "chapter_number": chapter_number,
    }
