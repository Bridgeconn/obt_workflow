from fastapi import  Depends, File, UploadFile, HTTPException,APIRouter,Query
from fastapi.responses import FileResponse
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
from fastapi.responses import StreamingResponse
import subprocess
import shutil

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
            "message": "ZIP file extracted, project and verses created successfully",
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
    # Fetch the user's projects
    if project_id:
        # Fetch the specific project for the user
        project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")
    # Prepare the response for a single project
        return {
            "message": "Project retrieved successfully",
            "project": {
                "project_id": project.project_id,
                "name": project.name,
                "script_lang": project.script_lang,
                "audio_lang": project.audio_lang,
                "metadata_info": project.metadata_info,
            },
        }
    else:
        # Fetch all projects for the user
        projects = db.query(Project).filter(Project.owner_id == current_user.user_id).all()

        if not projects:
            raise HTTPException(status_code=404, detail="No projects found for the user.")

        # Prepare the response for all projects
        project_list = [
            {
                "project_id": project.project_id,
                "name": project.name,
                "script_lang": project.script_lang,
                "audio_lang": project.audio_lang,
                "metadata_info": project.metadata_info,
            }
            for project in projects
        ]

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
    Fetch detailed project information for the user, including chapters and verses.
    """
    # Fetch a specific project
    if project_id:
        project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")

        # Fetch chapters for the project
        chapters = db.query(Chapter).filter(Chapter.project_id == project_id).all()

        # Prepare detailed project information
        project_data = {
            "project_id": project.project_id,
            "name": project.name,
            "script_lang": project.script_lang,
            "audio_lang": project.audio_lang,
            # "metadata_info": project.metadata_info,
            "chapters": [
                {
                    "chapter_id": chapter.chapter_id,
                    "book": chapter.book,
                    "chapter": chapter.chapter,
                    "approved": chapter.approved,
                    "verses": [
                        {
                            "verse_id": verse.verse_id,
                            "verse": verse.verse,
                            "name": verse.name,
                            "path": verse.path,
                            "size": verse.size,
                            "format": verse.format,
                            "stt": verse.stt,
                            "text": verse.text,
                            "modified": verse.modified,
                            "tts": verse.tts,
                            "tts_path": verse.tts_path,
                            "stt_msg": verse.stt_msg,
                            "tts_msg": verse.tts_msg,
                        }
                        for verse in db.query(VerseFile).filter(VerseFile.chapter_id == chapter.chapter_id).all()
                    ],
                }
                for chapter in chapters
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

    # Prepare detailed project information for all projects
    project_list = []
    for project in projects:
        chapters = db.query(Chapter).filter(Chapter.project_id == project.project_id).all()
        project_list.append({
            "project_id": project.project_id,
            "name": project.name,
            "script_lang": project.script_lang,
            "audio_lang": project.audio_lang,
            "metadata_info": project.metadata_info,
            "chapters": [
                {
                    "chapter_id": chapter.chapter_id,
                    "book": chapter.book,
                    "chapter": chapter.chapter,
                    "approved": chapter.approved,
                    "verses": [
                        {
                            "verse_id": verse.verse_id,
                            "verse": verse.verse,
                            "name": verse.name,
                            "path": verse.path,
                            "size": verse.size,
                            "format": verse.format,
                            "stt": verse.stt,
                            "text": verse.text,
                            "text_modified": verse.text_modified,
                            "tts": verse.tts,
                            "tts_path": verse.tts_path,
                            "stt_msg": verse.stt_msg,
                            "tts_msg": verse.tts_msg,
                        }
                        for verse in db.query(VerseFile).filter(VerseFile.chapter_id == chapter.chapter_id).all()
                    ],
                }
                for chapter in chapters
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
    # Fetch the project
    # project = db.query(Project).filter(Project.project_id == project_id).first()
    # if not project:
    #     raise HTTPException(status_code=404, detail="Project not found")
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
    # Fetch the project
    # project = db.query(Project).filter(Project.project_id == project_id).first()

    # if not project:
    #     raise HTTPException(status_code=404, detail="Project not found")
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
    """
    Update the 'archive' status of a project.

    Args:
        project_id (int): ID of the project.
        archive (bool): The new archive status (True or False).

    Returns:
        dict: Response message with project details.
    """
    # Fetch the project
    # project = db.query(Project).filter(Project.project_id == project_id).first()

    # if not project:
    #     raise HTTPException(status_code=404, detail="Project not found.")
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
    # project = db.query(Project).filter(Project.project_id == project_id).first()
    # if not project:
    #     raise HTTPException(status_code=404, detail="Project not found")
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
            raise HTTPException(status_code=404, detail="Project not found for the user.")
    
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
    # project = db.query(Project).filter(Project.project_id == project_id).first()
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")

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
    project = db.query(Project).filter(
            Project.owner_id == current_user.user_id,
            Project.project_id == project_id
        ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for user")
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











@router.get("/stream-audio/")
async def stream_audio(
    project_id: int,
    book: str,
    chapter: int,
    verse: int,
    db: Session = Depends(dependency.get_db),
):
    """
    Stream an audio file based on the conditions:
    - If `text_modified` is True, play the `tts_path`.
    - Otherwise, play the input file path.
    Args:
        project_id (int): ID of the project.
        book (str): Book code.
        chapter (int): Chapter number.
        verse (int): The verse number.
    Returns:
        StreamingResponse: Streams the audio file.
    """
    # Validate project
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate chapter
    chapter_entry = db.query(Chapter).filter(
        Chapter.project_id == project_id,
        Chapter.book == book,
        Chapter.chapter == chapter
    ).first()
    if not chapter_entry:
        logging.error(f"Chapter not found for Book: {book}, Chapter: {chapter}")
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Validate verse
    verse_entry = db.query(VerseFile).filter(
        VerseFile.chapter_id == chapter_entry.chapter_id,
        VerseFile.verse == verse
    ).first()
    if not verse_entry:
        logging.error(f"Verse not found for Book: {book}, Chapter: {chapter}, Verse: {verse}")
        raise HTTPException(status_code=404, detail="Verse not found")

    # Determine the file path
    file_path = verse_entry.tts_path if verse_entry.modified else verse_entry.path
    logging.debug(f"Resolved File Path: {file_path}")

    # Validate the file path
    if not file_path or not os.path.exists(file_path) or not os.path.isfile(file_path):
        logging.error(f"File not found: {file_path}")
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Determine media type and process the file
    file_extension = os.path.splitext(file_path)[-1].lower()
    media_type = "audio/mpeg" if file_extension == ".mp3" else "audio/wav"
    audio_file_path = convert_to_wav(file_path) if file_extension == ".wav" else file_path

    # Stream the file content
    def iter_file():
        with open(audio_file_path, "rb") as audio_file:
            while chunk := audio_file.read(1024 * 1024):  # Read in chunks of 1MB
                yield chunk

    return StreamingResponse(iter_file(), media_type=media_type)




def convert_to_wav(file_path: str) -> str:
    """
    Convert MP3 files to WAV, normalize WAV files, and return the processed WAV file path.
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

    # If the file is MP3, convert it to WAV
    if file_extension == ".mp3":
        converted_wav_path = f"{os.path.splitext(file_path)[0]}.wav"
        try:
            # Convert MP3 to WAV using ffmpeg
            subprocess.run(
                ["ffmpeg", "-i", file_path, converted_wav_path, "-y"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            logging.info(f"Converted MP3 to WAV: {converted_wav_path}")
        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to convert MP3 to WAV: {e.stderr.decode()}")
            raise HTTPException(status_code=500, detail="Failed to convert MP3 to WAV")
        return convert_to_wav(converted_wav_path)  # Recursively normalize the WAV file

    # If the file is WAV, normalize it
    if file_extension == ".wav":
        temp_normalized_path = f"{file_path}.normalized.wav"
        try:
            # Normalize the WAV file
            subprocess.run(
                [
                    "ffmpeg", "-i", file_path,
                    "-ar", "44100",
                    "-ac", "2",
                    "-b:a", "192k",
                    temp_normalized_path, "-y"
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            logging.info(f"Normalized WAV file: {temp_normalized_path}")
            os.replace(temp_normalized_path, file_path)
        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to normalize WAV file: {e.stderr.decode()}")
            raise HTTPException(status_code=500, detail="Failed to normalize WAV audio file")
        return file_path

    # If unsupported format
    raise HTTPException(status_code=400, detail=f"Unsupported audio format: {file_extension}")



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
    chapters = db.query(Chapter).filter(Chapter.project_id == project_id, Chapter.book == book).all()
    if not chapters:
        raise HTTPException(status_code=404, detail=f"No chapters found for book {book} in the project.")

    # Retrieve all verses and sort them by chapter and verse number
    verses = db.query(VerseFile, Chapter).join(Chapter, VerseFile.chapter_id == Chapter.chapter_id).filter(
        Chapter.project_id == project_id, Chapter.book == book
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






@router.get("/download-processed-project-zip/")
async def download_processed_project_zip(
    project_id: int,
    db: Session = Depends(dependency.get_db),
    current_user: User = Depends(auth.get_current_user),
):
    # """
    # Generate a zip file with the following steps:
    # 1) Copy the project folder from the Input directory matching the project_id name.
    # 2) Replace audio files in the ingredients/audio folder with edited audios if `text_modified` is True.
    # 3) Replace USFM files in the input folder (ingredients and text folders) based on matching names from the usfm_files folder.
    # 4) Name the zip file based on the project folder name.

    # Args:
    #     project_id (int): ID of the project.

    # Returns:
    #     FileResponse: The zip file containing the updated project folder.
    # """
    # Fetch project details
    project = db.query(Project).filter(
        Project.owner_id == current_user.user_id,
        Project.project_id == project_id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found for the user.")

    project_name = project.name
    input_folder = os.path.join("Input", project_name)  # Path to the specific project folder
    output_folder = "Output"  # Path to output folder
    usfm_folder = "usfm_files"  # Path to the USFM files folder
    temp_folder = f"Temp_{project_name}"  # Temporary folder for zip preparation

    # Validate the existence of the project folder in Input
    if not os.path.exists(input_folder):
        raise HTTPException(status_code=404, detail=f"Project folder '{project_name}' not found in Input.")

    # Prepare the temporary folder
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)  # Clean up if temp folder exists
    shutil.copytree(input_folder, temp_folder)

    # Replace audio files with edited audios in the temp folder
    for root, dirs, files in os.walk(temp_folder):
        if "audio" in root and "ingredients" in root:  # Focus on the audio/ingredients folder
            for file in files:
                if file.endswith(".wav"):  # Only process .wav files
                    # Extract book, chapter, and verse from the file path
                    relative_path = os.path.relpath(root, temp_folder)
                    parts = relative_path.split(os.sep)
                    if len(parts) >= 3:  # Ensure book/chapter structure exists
                        book = parts[-2]  # Get book folder name
                        chapter = parts[-1]  # Get chapter folder name
                        verse_file = db.query(VerseFile).join(Chapter).filter(
                            Chapter.project_id == project_id,
                            Chapter.book == book,
                            Chapter.chapter == int(chapter),
                            VerseFile.name == file,
                            VerseFile.modified.is_(True),
                        ).first()

                        if verse_file:
                            # Path to the edited audio in the Output folder
                            edited_audio_path = os.path.join(output_folder, book, chapter, verse_file.name)

                            if os.path.exists(edited_audio_path):  # Replace with edited audio if it exists
                                destination_path = os.path.join(root, file)
                                shutil.copy2(edited_audio_path, destination_path)
                                logging.info(f"Replaced {file} with edited audio: {edited_audio_path}")

    # Replace USFM files in the `text/ingredients` folder
    text_ingredients_folder = os.path.join(temp_folder, "text-1", "ingredients")
    print("PATH",text_ingredients_folder)

    # Ensure the folder exists
    os.makedirs(temp_folder, exist_ok=True)
    print("Contents of text/ingredients folder before processing:")
    for root, dirs, files in os.walk(temp_folder):
        for text_file in files:
            print(f"File found: {text_file}")

    # Iterate over USFM files in the usfm_files folder
    for usfm_file in os.listdir(usfm_folder):
        if usfm_file.endswith(".usfm"):
            usfm_file_path = os.path.join(usfm_folder, usfm_file)
            print(f"Processing USFM file: {usfm_file}")

            # Check for matching file names in the `text/ingredients` folder
            for root, dirs, files in os.walk(temp_folder):
                for text_file in files:
                    print(f"Comparing with file: {text_file}")
                    if text_file == usfm_file:  # Match based on file name
                        text_usfm_path = os.path.join(root, text_file)
                        print(f"###### Matched file name: {text_file} -> {text_usfm_path}")
                        
                        # Replace the file with the one from usfm_files
                        shutil.copy2(usfm_file_path, text_usfm_path)
                        print(f"Replaced USFM file: {usfm_file} in text/ingredients folder")


    # Prepare the zip file
    zip_file_name = f"{project_name}.zip"
    zip_file_path = os.path.join(".", zip_file_name)
    with zipfile.ZipFile(zip_file_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for root, dirs, files in os.walk(temp_folder):
            for file in files:
                if not file.endswith(".converted.wav"): 
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, temp_folder)  
                    zip_file.write(file_path, arcname)

    # Clean up the temporary folder
    shutil.rmtree(temp_folder)

    # Return the zip file as a downloadable response
    return FileResponse(
        zip_file_path,
        media_type="application/zip",
        filename=zip_file_name,
    )