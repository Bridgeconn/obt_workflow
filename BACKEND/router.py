from fastapi import  Depends, File, UploadFile, HTTPException,APIRouter,Query
from fastapi.responses import FileResponse
from fastapi.security import  OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pathlib import Path
import zipfile
import os
import json
from database import  User, Project,VerseFile,Chapter,Job,Book
import logging
from fastapi import BackgroundTasks
import auth
import dependency
import crud
from fastapi.responses import StreamingResponse
import subprocess
import shutil
import datetime

logging.basicConfig(level=logging.DEBUG)



router = APIRouter()
# Directory for extracted files
UPLOAD_DIR = "Input"
os.makedirs(UPLOAD_DIR, exist_ok=True)




# Create User API
@router.post("/create-user/")
def create_user(username: str, password: str, db: Session = Depends(dependency.get_db)):
    # Check if the username already exists
    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail=f"Username '{username}' already exists. Please choose a different username."
        )
    # Hash the password and create the user
    hashed_password = auth.get_password_hash(password)
    user = User(username=username, hashed_password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "User created successfully", "user_id": user.user_id}




@router.post("/token/")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(), 
    db: Session = Depends(dependency.get_db)
):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    # Generate access token
    access_token = auth.create_access_token(data={"sub": str(user.user_id)})
    # Update user record with token and last login time
    user.token = access_token
    user.last_login = datetime.datetime.utcnow()
    db.commit()
    db.refresh(user)
    return {"access_token": access_token, "token_type": "bearer"}





@router.post("/logout/")
async def logout(
    db: Session = Depends(dependency.get_db), 
    current_user: User = Depends(auth.get_current_user)
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
        # Temporary extraction path
        temp_extract_path = Path(UPLOAD_DIR) / "temp_extraction"
        temp_extract_path.mkdir(parents=True, exist_ok=True)
        # Extract the ZIP file
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_extract_path)
        # Remove the ZIP file after extraction
        os.remove(zip_path)
        # Search for metadata.json recursively
        metadata_path = None
        for root, dirs, files in os.walk(temp_extract_path):
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
        metadata_info = json.dumps(metadata_content)
        # Create a new project entry
        project = Project(
            name=name,
            owner_id=owner_id,
            script_lang="",
            audio_lang="",
            metadata_info=metadata_info,
        )
        db.add(project)
        db.commit()
        db.refresh(project)

        # Rename the extracted folder to match the project name
        project_extract_path = Path(UPLOAD_DIR) / project.name
        if project_extract_path.exists():
            shutil.rmtree(project_extract_path)  # Clean up if a folder with the same name exists
        shutil.move(str(temp_extract_path), str(project_extract_path))

        # Locate and read versification.json
        versification_path = None
        for root, dirs, files in os.walk(project_extract_path):
            if "versification.json" in files:
                versification_path = Path(root) / "versification.json"
                break
        if not versification_path or not versification_path.exists():
            raise HTTPException(status_code=400, detail="versification.json not found in the ZIP file")

        # Load versification.json
        with open(versification_path, "r", encoding="utf-8") as versification_file:
            versification_data = json.load(versification_file)
        max_verses = versification_data.get("maxVerses", {})


        # Dynamically locate `ingredients` folder
        ingredients_path = None
        for root, dirs, files in os.walk(project_extract_path):
            if "audio" in dirs and "ingredients" in os.listdir(os.path.join(root, "audio")):
                ingredients_path = Path(root) / "audio" / "ingredients"
                break
            elif "text" in dirs and "ingredients" in os.listdir(os.path.join(root, "text")):
                ingredients_path = Path(root) / "text" / "ingredients"
                break
            elif "ingredients" in dirs:
                ingredients_path = Path(root) / "ingredients"
                break

        if not ingredients_path:
            raise HTTPException(status_code=400, detail="ingredients folder not found in the ZIP file")

        # Process books, chapters, and verses in `ingredients`
        for book_dir in ingredients_path.iterdir():
            if book_dir.is_dir():
                book = book_dir.name
                book_max_verses = max_verses.get(book, [])

                # Create a book entry in the database
                book_entry = Book(
                    project_id=project.project_id,
                    book=book,
                    approved=False
                )
                db.add(book_entry)
                db.commit()
                db.refresh(book_entry)

                for chapter_dir in book_dir.iterdir():
                    if chapter_dir.is_dir() and chapter_dir.name.isdigit():
                        chapter_number = int(chapter_dir.name)
                        chapter_max_verses = int(book_max_verses[chapter_number - 1]) if chapter_number <= len(book_max_verses) else 0

                        # Get all available verses in the chapter
                        available_verses = set(
                            int(verse_file.stem.split("_")[1])
                            for verse_file in chapter_dir.iterdir()
                            if verse_file.is_file() and "_" in verse_file.stem
                        )
                        # Determine missing verses
                        expected_verses = set(range(1, chapter_max_verses + 1))
                        missing_verses = list(expected_verses - available_verses)
                        # Store chapter with missing verses in the database
                        chapter = Chapter(
                            # project_id=project.project_id,
                            book_id=book_entry.book_id,
                            # book=book,
                            chapter=chapter_number,
                            approved=False,
                            missing_verses=missing_verses if missing_verses else None,
                        )
                        db.add(chapter)
                        db.commit()
                        db.refresh(chapter)

                        # Add verse records
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
                                        modified=False,
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
            "message": "ZIP file extracted, project and chapters created successfully",
            "project_id": project.project_id,
        }

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="The file is not a valid ZIP archive")
    except Exception as e:
        logging.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/projects/")
async def get_user_projects(
    project_id: int = Query(None),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    if project_id:
        # Fetch the specific project and its associated books for the user
        project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")

        # Fetch associated books
        books = db.query(Book).filter(Book.project_id == project.project_id).all()

        # Prepare the response for a single project
        return {
            "message": "Project retrieved successfully",
            "project": {
                "project_id": project.project_id,
                "name": project.name,
                "script_lang": project.script_lang,
                "audio_lang": project.audio_lang,
                "metadata_info": project.metadata_info,
                "books": [
                    {
                        "book_id": book.book_id,
                        "book": book.book,
                        "approved": book.approved,
                    }
                    for book in books
                ],
            },
        }
    else:
        # Fetch all projects and their associated books for the user
        projects = db.query(Project).filter(Project.owner_id == current_user.user_id).all()

        if not projects:
            raise HTTPException(status_code=404, detail="No projects found for the user.")

        # Prepare the response for all projects
        project_list = []
        for project in projects:
            books = db.query(Book).filter(Book.project_id == project.project_id).all()
            project_list.append(
                {
                    "project_id": project.project_id,
                    "name": project.name,
                    "script_lang": project.script_lang,
                    "audio_lang": project.audio_lang,
                    "metadata_info": project.metadata_info,
                    "books": [
                        {
                            "book_id": book.book_id,
                            "book": book.book,
                            "approved": book.approved,
                        }
                        for book in books
                    ],
                }
            )

        return {
            "message": "Projects retrieved successfully",
            "projects": project_list,
        }



@router.get("/project/details")
async def get_user_projects(
    project_id: int = Query(None),
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Fetch detailed project information for the user, including associated books and chapters.
    """
    # Fetch a specific project
    if project_id:
        project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")

        # Fetch books associated with the project
        books = db.query(Book).filter(Book.project_id == project.project_id).all()

        # Prepare detailed project information (up to book and chapter level)
        project_data = {
            "project_id": project.project_id,
            "name": project.name,
            "script_lang": project.script_lang,
            "audio_lang": project.audio_lang,
            "metadata_info": project.metadata_info,
            "books": [
                {
                    "book_id": book.book_id,
                    "book": book.book,
                    "approved": book.approved,
                    "chapters": [
                        {
                            "chapter_id": chapter.chapter_id,
                            "chapter": chapter.chapter,
                            "approved": chapter.approved,
                            "missing_verses": chapter.missing_verses,  # Include missing_verses column
                        }
                        for chapter in db.query(Chapter).filter(Chapter.book_id == book.book_id).all()
                    ],
                }
                for book in books
            ],
        }

        return {
            "message": "Project retrieved successfully",
            "project": project_data,
        }

    # Fetch all projects for the user
    projects = db.query(Project).filter(Project.owner_id == current_user.user_id).all()

    if not projects:
        raise HTTPException(status_code=404, detail="No projects found for the user.")

    # Prepare detailed project information for all projects (up to book and chapter level)
    project_list = []
    for project in projects:
        books = db.query(Book).filter(Book.project_id == project.project_id).all()
        project_list.append({
            "project_id": project.project_id,
            "name": project.name,
            "script_lang": project.script_lang,
            "audio_lang": project.audio_lang,
            "metadata_info": project.metadata_info,
            "books": [
                {
                    "book_id": book.book_id,
                    "book": book.book,
                    "approved": book.approved,
                    "chapters": [
                        {
                            "chapter_id": chapter.chapter_id,
                            "chapter": chapter.chapter,
                            "approved": chapter.approved,
                            "missing_verses": chapter.missing_verses,  # Include missing_verses column
                        }
                        for chapter in db.query(Chapter).filter(Chapter.book_id == book.book_id).all()
                    ],
                }
                for book in books
            ],
        })

    return {
        "message": "Projects retrieved successfully",
        "projects": project_list,
    }





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
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()

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
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
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


@router.put("/projects/{project_id}/archive/")
async def update_project_archive(
    project_id: int,
    archive: bool,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user)
):
    # """
    # Update the 'archive' status of a project.

    # Args:
    #     project_id (int): ID of the project.
    #     archive (bool): The new archive status (True or False).

    # Returns:
    #     dict: Response message with project details.
    # """
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
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



@router.post("/transcribe")
async def transcribe_book(
    project_id: int,
    book_code: str,
    chapter_number: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")
    
     # Fetch the book associated with the project and book_code
    book = (
        db.query(Book)
        .filter(
            Book.project_id == project_id,
            Book.book == book_code
        )
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
    # Validate project
    project = db.query(Project).filter(
        Project.owner_id == current_user.user_id,
        Project.project_id == project_id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")

    # Validate book
    book = (
        db.query(Book)
        .filter(
            Book.project_id == project_id,
            Book.book == book_code
        )
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
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")
    # Validate the book
    book_record = (
        db.query(Book)
        .filter(
            Book.project_id == project_id,
            Book.book == book
        )
        .first()
    )
    if not book_record:
        raise HTTPException(status_code=404, detail="Book not found for the project")

    chapter_record = (
        db.query(Chapter)
        .filter(
            Chapter.book_id == book_record.book_id,
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
    project_id:int,
    verse_id: int,
    modified_text: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    """
    Update the text and set text_modified to True in the VerseFile table for a given verse_id.
    """
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")
    # Fetch the verse record
    verse_record = db.query(VerseFile).filter(VerseFile.verse_id == verse_id).first()

    if not verse_record:
        raise HTTPException(status_code=404, detail="Verse not found")

    # Update the text and set text_modified to True
    verse_record.text = modified_text
    verse_record.modified = True
    db.commit()

    return {
        "message": "Verse text updated successfully",
        "verse_id": verse_id,
        "text": verse_record.text,
        "modified": verse_record.modified
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
    # project = db.query(Project).filter(Project.project_id == project_id).first()
    # if not project:
    #     raise HTTPException(status_code=404, detail="Project not found")
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")
    # Validate the book
    book = (
        db.query(Book)
        .filter(
            Book.project_id == project_id,
            Book.book == book_code
        )
        .first()
    )
    if not book:
        raise HTTPException(status_code=404, detail="Book not found for the project.")

    # Validate the chapter
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

    verses = db.query(VerseFile).filter(
        VerseFile.chapter_id == chapter.chapter_id, VerseFile.modified == True
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


def convert_to_wav(file_path: str) -> str:
    """
    Convert MP3 files to WAV, normalize WAV files, and resample WAV to 48000 Hz if necessary.
    Args:
        file_path (str): Path to the original audio file.
    Returns:
        str: Path to the processed WAV file.
    """
    logging.debug(f"Processing file: {file_path}")

    # Ensure the file exists
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail=f"Audio file not found: {file_path}")

    # Extract file extension
    file_extension = os.path.splitext(file_path)[-1].lower()

    # If the file is WAV, check sample rate and resample to 48000 Hz if needed
    if file_extension == ".wav":
        temp_resampled_path = f"{file_path}.resampled.wav"
        try:
            # Check the current sample rate using ffprobe
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "default=nw=1:nk=1", file_path],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            current_sample_rate = int(probe.stdout.decode().strip())
            logging.debug(f"Current sample rate: {current_sample_rate} Hz")

            # Resample only if not 48000 Hz
            if current_sample_rate != 48000:
                subprocess.run(
                    [
                        "ffmpeg", "-i", file_path,
                        "-ar", "48000", "-ac", "1", "-sample_fmt", "s16",
                        temp_resampled_path, "-y"
                    ],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                logging.info(f"Resampled WAV file to 48000 Hz: {temp_resampled_path}")
                os.replace(temp_resampled_path, file_path)  # Replace the original file with the resampled one
            else:
                logging.info("File already has a sample rate of 48000 Hz. No resampling needed.")
        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to resample WAV file: {e.stderr.decode()}")
            raise HTTPException(status_code=500, detail="Failed to resample WAV audio file")
        return file_path

    # # If the file is MP3, convert it to WAV
    elif file_extension == ".mp3":
        converted_wav_path = f"{os.path.splitext(file_path)[0]}.wav"
        try:
            # Convert MP3 to WAV using ffmpeg
            subprocess.run(
                ["ffmpeg", "-i", file_path, "-ar", "48000", "-ac", "1", "-sample_fmt", "s16", converted_wav_path, "-y"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            logging.info(f"Converted MP3 to WAV: {converted_wav_path}")
        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to convert MP3 to WAV: {e.stderr.decode()}")
            raise HTTPException(status_code=500, detail="Failed to convert MP3 to WAV")
        return converted_wav_path

    # If unsupported format
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format: {file_extension}")


@router.get("/stream-audio/")
async def stream_audio(
    project_id: int,
    book: str,
    chapter: int,
    verse: int,
    db: Session = Depends(dependency.get_db),
):
    """
    Stream an audio file, ensuring proper sample rate and format.
    """
    book_entry = (
        db.query(Book)
        .filter(Book.project_id == project_id, Book.book == book)
        .first()
    )
    if not book_entry:
        raise HTTPException(status_code=404, detail="Book not found")

    # Validate chapter
    chapter_entry = (
        db.query(Chapter)
        .filter(Chapter.book_id == book_entry.book_id, Chapter.chapter == chapter)
        .first()
    )
    if not chapter_entry:
        logging.error(f"Chapter not found for Book: {book}, Chapter: {chapter}")
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Validate and retrieve verse entry
    verse_entry = db.query(VerseFile).filter(
        VerseFile.chapter_id == chapter_entry.chapter_id,
        VerseFile.verse == verse
    ).first()
    if not verse_entry:
        raise HTTPException(status_code=404, detail="Verse not found")

    # Determine the file path
    file_path = verse_entry.tts_path if verse_entry.modified else verse_entry.path

    # Ensure the file is a valid WAV file with the correct sample rate
    try:
        file_path = convert_to_wav(file_path)
    except HTTPException as e:
        logging.error(f"Error converting audio file: {e.detail}")
        raise e

    # Stream the audio file
    def iter_file():
        with open(file_path, "rb") as audio_file:
            while chunk := audio_file.read(1024 * 1024):  # Read in chunks of 1MB
                yield chunk

    return StreamingResponse(iter_file(), media_type="audio/wav")



@router.get("/generate-usfm/")
async def generate_usfm(
    project_id: int,
    book: str,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user)
):
    # """
    # Generate a USFM file based on the project ID and book.
    # Args:
    #     project_id (int): ID of the project.
    #     book (str): Book code.

    # Returns:
    #     FileResponse: USFM file as a response.
    # """
    # Validate project
    project = db.query(Project).filter(
        Project.owner_id == current_user.user_id,
        Project.project_id == project_id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")
    
    # Validate book
    book_entry = (
        db.query(Book)
        .filter(Book.project_id == project_id, Book.book == book)
        .first()
    )
    if not book_entry:
        raise HTTPException(status_code=404, detail=f"Book '{book}' not found in the project.")


    # Load book metadata from the JSON file
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
        raise HTTPException(status_code=404, detail=f"Metadata not found for book {book}.")

    # Fetch metadata for the book
    short_title = book_metadata[book]["short"]["en"]
    abbr = book_metadata[book]["abbr"]["en"]
    long_title = book_metadata[book]["long"]["en"]

    # Fetch chapters and verses for the given book
    chapters = db.query(Chapter).filter(Chapter.book_id == book_entry.book_id).all()
    if not chapters:
        raise HTTPException(status_code=404, detail=f"No chapters found for book {book} in the project.")

    # Retrieve all verses and sort them by chapter and verse number
    verses = db.query(VerseFile, Chapter).join(Chapter, VerseFile.chapter_id == Chapter.chapter_id).filter(
        Chapter.book_id == book_entry.book_id
    ).order_by(Chapter.chapter, VerseFile.verse).all()

    if not verses:
        raise HTTPException(status_code=404, detail=f"No verses found for book {book} in the project.")

    # USFM content generation
    usfm_text = f"\\id {book}\n\\usfm 3.0\n\\ide UTF-8\n\\h {short_title}\n\\toc1 {abbr}\n\\toc2 {short_title}\n\\toc3 {long_title}\n\\mt {abbr}\n"

    current_chapter = None
    for verse, chapter in verses:
        if chapter.chapter != current_chapter:  # Use the actual chapter number
            usfm_text += f"\\c {chapter.chapter}\n\\p\n"
            current_chapter = chapter.chapter
        usfm_text += f"\\v {verse.verse} {verse.text.strip()}\n"

    # Write the USFM content to a temporary file
    usfm_file_path = f"usfm_files/{book}.usfm"
    os.makedirs(os.path.dirname(usfm_file_path), exist_ok=True)
    with open(usfm_file_path, "w", encoding="utf-8") as usfm_file:
        usfm_file.write(usfm_text)

    # Return the USFM file as a response
    return FileResponse(
        usfm_file_path,
        media_type="text/plain",
        filename=f"{book}.usfm",
    )






# @router.get("/download-processed-project-zip/")
# async def download_processed_project_zip(
#     project_id: int,
#     db: Session = Depends(dependency.get_db),
#     current_user: User = Depends(auth.get_current_user),
# ):
#     # """
#     # Generate a zip file with the following steps:
#     # 1) Copy the project folder from the Input directory matching the project_id name.
#     # 2) Replace audio files in the ingredients/audio folder with edited audios if `text_modified` is True.
#     # 3) Replace USFM files in the input folder (ingredients and text folders) based on matching names from the usfm_files folder.
#     # 4) Name the zip file based on the project folder name.

#     # Args:
#     #     project_id (int): ID of the project.

#     # Returns:
#     #     FileResponse: The zip file containing the updated project folder.
#     # """
#     # Fetch project details
#     project = db.query(Project).filter(
#         Project.owner_id == current_user.user_id,
#         Project.project_id == project_id
#     ).first()
#     if not project:
#         raise HTTPException(status_code=404, detail="Project not found for the user.")

#     project_name = project.name
#     input_folder = os.path.join("Input", project_name)  # Path to the specific project folder
#     output_folder = "Output"  # Path to output folder
#     usfm_folder = "usfm_files"  # Path to the USFM files folder
#     temp_folder = f"Temp_{project_name}"  # Temporary folder for zip preparation

#     # Validate the existence of the project folder in Input
#     if not os.path.exists(input_folder):
#         raise HTTPException(status_code=404, detail=f"Project folder '{project_name}' not found in Input.")

#     # Prepare the temporary folder
#     if os.path.exists(temp_folder):
#         shutil.rmtree(temp_folder)  # Clean up if temp folder exists
#     shutil.copytree(input_folder, temp_folder)

#     # Replace audio files with edited audios in the temp folder
#     for root, dirs, files in os.walk(temp_folder):
#         if "audio" in root and "ingredients" in root:  # Focus on the audio/ingredients folder
#             for file in files:
#                 if file.endswith(".wav"):  # Only process .wav files
#                     # Extract book, chapter, and verse from the file path
#                     relative_path = os.path.relpath(root, temp_folder)
#                     parts = relative_path.split(os.sep)
#                     if len(parts) >= 3:  # Ensure book/chapter structure exists
#                         book = parts[-2]  # Get book folder name
#                         chapter = parts[-1]  # Get chapter folder name
#                         verse_file = db.query(VerseFile).join(Chapter).filter(
#                             Chapter.project_id == project_id,
#                             Chapter.book == book,
#                             Chapter.chapter == int(chapter),
#                             VerseFile.name == file,
#                             VerseFile.modified.is_(True),
#                         ).first()

#                         if verse_file:
#                             # Path to the edited audio in the Output folder
#                             edited_audio_path = os.path.join(output_folder, book, chapter, verse_file.name)

#                             if os.path.exists(edited_audio_path):  # Replace with edited audio if it exists
#                                 destination_path = os.path.join(root, file)
#                                 shutil.copy2(edited_audio_path, destination_path)
#                                 logging.info(f"Replaced {file} with edited audio: {edited_audio_path}")

#     # Replace USFM files in the `text/ingredients` folder
#     text_ingredients_folder = os.path.join(temp_folder, "text-1", "ingredients")
#     print("PATH",text_ingredients_folder)

#     # Ensure the folder exists
#     os.makedirs(temp_folder, exist_ok=True)
#     print("Contents of text/ingredients folder before processing:")
#     for root, dirs, files in os.walk(temp_folder):
#         for text_file in files:
#             print(f"File found: {text_file}")

#     # Iterate over USFM files in the usfm_files folder
#     for usfm_file in os.listdir(usfm_folder):
#         if usfm_file.endswith(".usfm"):
#             usfm_file_path = os.path.join(usfm_folder, usfm_file)
#             print(f"Processing USFM file: {usfm_file}")

#             # Check for matching file names in the `text/ingredients` folder
#             for root, dirs, files in os.walk(temp_folder):
#                 for text_file in files:
#                     print(f"Comparing with file: {text_file}")
#                     if text_file == usfm_file:  # Match based on file name
#                         text_usfm_path = os.path.join(root, text_file)
#                         print(f"###### Matched file name: {text_file} -> {text_usfm_path}")
                        
#                         # Replace the file with the one from usfm_files
#                         shutil.copy2(usfm_file_path, text_usfm_path)
#                         print(f"Replaced USFM file: {usfm_file} in text/ingredients folder")


#     # Prepare the zip file
#     zip_file_name = f"{project_name}.zip"
#     zip_file_path = os.path.join(".", zip_file_name)
#     with zipfile.ZipFile(zip_file_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
#         for root, dirs, files in os.walk(temp_folder):
#             for file in files:
#                 if not file.endswith(".converted.wav"): 
#                     file_path = os.path.join(root, file)
#                     arcname = os.path.relpath(file_path, temp_folder)  
#                     zip_file.write(file_path, arcname)

#     # Clean up the temporary folder
#     shutil.rmtree(temp_folder)

#     # Return the zip file as a downloadable response
#     return FileResponse(
#         zip_file_path,
#         media_type="application/zip",
#         filename=zip_file_name,
#     )



@router.get("/download-processed-project-zip/")
async def download_processed_project_zip(
    project_id: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    # Fetch the project
    project = db.query(Project).filter(
        Project.owner_id == current_user.user_id,
        Project.project_id == project_id
    ).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")

    # Source and target directories
    source_dir = Path(UPLOAD_DIR) / project.name
    if not source_dir.exists():
        raise HTTPException(status_code=404, detail="Project directory not found.")
    target_dir = Path("ProcessedProjects") / project.name
    target_dir.mkdir(parents=True, exist_ok=True)

    # Copy metadata.json if it exists, otherwise create an empty one
    metadata_file = source_dir / "metadata.json"
    target_metadata_file = target_dir / "metadata.json"
    if metadata_file.exists():
        shutil.copy(metadata_file, target_metadata_file)
    else:
        # Create an empty metadata.json file if it doesn't exist in the source
        with open(target_metadata_file, "w", encoding="utf-8") as f:
            json.dump({"info": "No metadata available"}, f)

    # Ensure audio and text folders exist in the target directory
    audio_dir = target_dir / "audio"
    text_dir = target_dir / "text"
    audio_dir.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)

    # Search for ingredients folder in the source directory
    ingredients_path = None
    for root, dirs, files in os.walk(source_dir):
        if "ingredients" in dirs:
            ingredients_path = Path(root) / "ingredients"
            break

    # Copy ingredients to audio folder
    if ingredients_path and ingredients_path.is_dir():
        shutil.copytree(ingredients_path, audio_dir / "ingredients", dirs_exist_ok=True)
    else:
        (audio_dir / "ingredients").mkdir(parents=True, exist_ok=True)

    # Ensure text/ingredients folder exists
    text_ingredients_dir = text_dir / "ingredients"
    text_ingredients_dir.mkdir(parents=True, exist_ok=True)

    # Locate books and copy USFM files for each book
    books = db.query(Book).filter(Book.project_id == project.project_id).all()
    for book in books:
        # Locate USFM file for the book
        usfm_file_path = f"usfm_files/{book.book}.usfm"
        if os.path.exists(usfm_file_path):
            shutil.copy(usfm_file_path, text_ingredients_dir / f"{book.book}.usfm")

    # Create a ZIP file of the processed project directory
    zip_file_path = f"{target_dir}.zip"
    with zipfile.ZipFile(zip_file_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                file_path = Path(root) / file
                arcname = file_path.relative_to(target_dir.parent)  # Relative path for the zip file
                zipf.write(file_path, arcname)

    # Serve ZIP file as a downloadable response
    return FileResponse(
        zip_file_path,
        media_type="application/zip",
        filename=f"{project.name}.zip",
    )


